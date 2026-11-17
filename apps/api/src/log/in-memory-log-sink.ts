import { Injectable } from '@nestjs/common';
import { LogKind, LogRecord, LogSink } from './log-sink';

/** 测试替身：把日志留在内存里，供单测/e2e 断言。 */
@Injectable()
export class InMemoryLogSink implements LogSink {
  readonly records: LogRecord[] = [];

  emit(record: LogRecord): void {
    this.records.push(record);
  }

  clear(): void {
    this.records.length = 0;
  }

  findByKind(kind: LogKind): LogRecord[] {
    return this.records.filter((r) => r.kind === kind);
  }

  findEvents(): string[] {
    return this.records.filter((r) => r.kind === 'trace').map((r) => r.event ?? '');
  }
}
