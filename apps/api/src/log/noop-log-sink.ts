import { Injectable } from '@nestjs/common';
import { LogRecord, LogSink } from './log-sink';

/** LOG_KAFKA_ENABLED=false 时的兜底实现：什么都不做。 */
@Injectable()
export class NoopLogSink implements LogSink {
  emit(_record: LogRecord): void {
    // 有意为之：关闭 Kafka 时不产生任何副作用
  }
}
