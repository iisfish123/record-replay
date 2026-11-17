import { Injectable, OnApplicationShutdown } from '@nestjs/common';
import { Kafka } from 'kafkajs';
import { LogKind, LogRecord, LogSink } from './log-sink';

export const TOPIC_BY_KIND: Record<LogKind, string> = {
  access: 'rr.api.access',
  error: 'rr.api.error',
  trace: 'rr.task.trace',
  app: 'rr.api.access',
};

export interface KafkaLogSinkOptions {
  brokers: string[];
  clientId: string;
  flushIntervalMs: number;
  batchMax: number;
  queueMax: number;
}

/** 抽象出 producer 便于单测注入替身，也让 kafkajs 只出现在本文件。 */
export interface ProducerLike {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  send(args: { topic: string; acks?: number; messages: Array<{ key?: string; value: string }> }): Promise<void>;
}

function createKafkaProducer(options: KafkaLogSinkOptions): ProducerLike {
  const kafka = new Kafka({ clientId: options.clientId, brokers: options.brokers });
  const producer = kafka.producer({ idempotent: true, maxInFlightRequests: 1 });
  return {
    connect: () => producer.connect(),
    disconnect: () => producer.disconnect(),
    send: (args) => producer.send(args as never).then(() => undefined),
  };
}

/**
 * 唯一接触 Kafka 的 LogSink 实现。
 * emit() 只入队（同步非阻塞），真正的发送在定时器里批量做；Kafka 抖动不影响业务。
 */
@Injectable()
export class KafkaLogSink implements LogSink, OnApplicationShutdown {
  private readonly queue: LogRecord[] = [];
  private readonly producer: ProducerLike;
  private readonly timer: NodeJS.Timeout;
  private sending = false;
  private connected = false;

  constructor(
    private readonly options: KafkaLogSinkOptions,
    producer?: ProducerLike,
  ) {
    this.producer = producer ?? createKafkaProducer(options);
    this.timer = setInterval(() => {
      void this.flush().catch(() => undefined);
    }, options.flushIntervalMs);
    this.timer.unref?.();
  }

  emit(record: LogRecord): void {
    this.queue.push(record);
    while (this.queue.length > this.options.queueMax) {
      this.queue.shift();
      process.stderr.write('[KafkaLogSink] 队列溢出，已丢弃最旧的日志\n');
    }
    if (this.queue.length >= this.options.batchMax) {
      void this.flush().catch(() => undefined);
    }
  }

  queueSize(): number {
    return this.queue.length;
  }

  async flush(): Promise<void> {
    if (this.sending || this.queue.length === 0) return;
    this.sending = true;
    try {
      await this.ensureConnected();
      while (this.queue.length > 0) {
        const batch = this.queue.splice(0, this.options.batchMax);
        const grouped = new Map<string, LogRecord[]>();
        for (const record of batch) {
          const topic = TOPIC_BY_KIND[record.kind];
          const list = grouped.get(topic);
          if (list) list.push(record);
          else grouped.set(topic, [record]);
        }
        for (const [topic, records] of grouped) {
          await this.producer.send({
            topic,
            acks: -1,
            messages: records.map((r) => ({ key: r.traceId, value: JSON.stringify(r) })),
          });
        }
      }
    } catch (err: any) {
      // 有意为之：日志可以丢，业务不能停。只告警不重试不阻塞。
      process.stderr.write(`[KafkaLogSink] 发送失败，丢弃本批日志: ${err?.message ?? err}\n`);
    } finally {
      this.sending = false;
    }
  }

  async onApplicationShutdown(): Promise<void> {
    clearInterval(this.timer);
    await this.flush();
    try {
      await this.producer.disconnect();
    } catch {
      // 退出阶段忽略断开异常
    }
  }

  private async ensureConnected(): Promise<void> {
    if (this.connected) return;
    await this.producer.connect();
    this.connected = true;
  }
}
