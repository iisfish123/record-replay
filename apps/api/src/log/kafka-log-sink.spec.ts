import { KafkaLogSink, KafkaLogSinkOptions, ProducerLike, TOPIC_BY_KIND } from './kafka-log-sink';
import { LogRecord } from './log-sink';

function makeOptions(overrides: Partial<KafkaLogSinkOptions> = {}): KafkaLogSinkOptions {
  return {
    brokers: ['127.0.0.1:9093'],
    clientId: 'test',
    flushIntervalMs: 60_000, // 默认关掉定时器，避免测试期间被动 flush
    batchMax: 200,
    queueMax: 1000,
    ...overrides,
  };
}

function makeProducer(): ProducerLike & { sent: any[]; connect: jest.Mock } {
  const sent: any[] = [];
  return {
    sent,
    connect: jest.fn().mockResolvedValue(undefined),
    disconnect: jest.fn().mockResolvedValue(undefined),
    send: jest.fn(async (args: any) => {
      sent.push(args);
    }) as any,
  } as any;
}

function makeRecord(overrides: Partial<LogRecord> = {}): LogRecord {
  return {
    ts: '2026-11-17T08:30:12.345Z',
    level: 'info',
    kind: 'access',
    traceId: 'T-1',
    msg: 'hello',
    ...overrides,
  };
}

describe('KafkaLogSink', () => {
  it('emit 只入队，不同步发送', async () => {
    const producer = makeProducer();
    const sink = new KafkaLogSink(makeOptions(), producer);
    sink.emit(makeRecord());
    await new Promise((r) => setTimeout(r, 20));
    expect(producer.send).not.toHaveBeenCalled();
    await sink.onApplicationShutdown();
  });

  it('到 flush 间隔后自动批量发送', async () => {
    const producer = makeProducer();
    const sink = new KafkaLogSink(makeOptions({ flushIntervalMs: 10 }), producer);
    sink.emit(makeRecord());
    await new Promise((r) => setTimeout(r, 60));
    expect(producer.send).toHaveBeenCalledTimes(1);
    expect(producer.sent[0].messages).toHaveLength(1);
    await sink.onApplicationShutdown();
  });

  it('队列达到 batchMax 时立即 flush', async () => {
    const producer = makeProducer();
    const sink = new KafkaLogSink(makeOptions({ batchMax: 3 }), producer);
    sink.emit(makeRecord({ msg: 'a' }));
    sink.emit(makeRecord({ msg: 'b' }));
    expect(producer.send).not.toHaveBeenCalled();
    sink.emit(makeRecord({ msg: 'c' }));
    await new Promise((r) => setTimeout(r, 20));
    expect(producer.send).toHaveBeenCalledTimes(1);
    expect(producer.sent[0].messages).toHaveLength(3);
    await sink.onApplicationShutdown();
  });

  it('kind 决定 topic 路由', async () => {
    const producer = makeProducer();
    const sink = new KafkaLogSink(makeOptions({ batchMax: 3 }), producer);
    sink.emit(makeRecord({ kind: 'access' }));
    sink.emit(makeRecord({ kind: 'error' }));
    sink.emit(makeRecord({ kind: 'trace' }));
    await new Promise((r) => setTimeout(r, 20));
    expect(producer.sent.map((a) => a.topic).sort()).toEqual(
      [TOPIC_BY_KIND.access, TOPIC_BY_KIND.error, TOPIC_BY_KIND.trace].sort(),
    );
    await sink.onApplicationShutdown();
  });

  it('traceId 作为 message key，value 是 JSON 字符串', async () => {
    const producer = makeProducer();
    const sink = new KafkaLogSink(makeOptions({ batchMax: 1 }), producer);
    sink.emit(makeRecord({ traceId: 'T-key', msg: 'kv' }));
    await new Promise((r) => setTimeout(r, 20));
    const message = producer.sent[0].messages[0];
    expect(message.key).toBe('T-key');
    expect(JSON.parse(message.value)).toMatchObject({ traceId: 'T-key', msg: 'kv' });
    await sink.onApplicationShutdown();
  });

  it('发送时 acks = -1', async () => {
    const producer = makeProducer();
    const sink = new KafkaLogSink(makeOptions({ batchMax: 1 }), producer);
    sink.emit(makeRecord());
    await new Promise((r) => setTimeout(r, 20));
    expect(producer.sent[0].acks).toBe(-1);
    await sink.onApplicationShutdown();
  });

  it('超过 queueMax 丢最旧的记录，且不抛异常', () => {
    const producer = makeProducer();
    const sink = new KafkaLogSink(makeOptions({ queueMax: 3 }), producer);
    expect(() => {
      for (let i = 0; i < 10; i++) sink.emit(makeRecord({ msg: `m${i}` }));
    }).not.toThrow();
    expect(sink.queueSize()).toBe(3);
  });

  it('send 抛错时不影响 emit，也不让 flush 冒泡异常', async () => {
    const producer = makeProducer();
    (producer.send as jest.Mock).mockRejectedValue(new Error('broker 挂了'));
    const sink = new KafkaLogSink(makeOptions({ batchMax: 1 }), producer);
    sink.emit(makeRecord());
    await expect(sink.flush()).resolves.toBeUndefined();
    expect(() => sink.emit(makeRecord())).not.toThrow();
    await sink.onApplicationShutdown();
  });

  it('onApplicationShutdown 清掉定时器并 flush 残留', async () => {
    const producer = makeProducer();
    const sink = new KafkaLogSink(makeOptions(), producer);
    sink.emit(makeRecord({ msg: 'leftover' }));
    await sink.onApplicationShutdown();
    expect(producer.sent[0].messages[0].value).toContain('leftover');
    expect(producer.disconnect).toHaveBeenCalled();
  });
});
