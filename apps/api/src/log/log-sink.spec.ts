import { InMemoryLogSink } from './in-memory-log-sink';
import { NoopLogSink } from './noop-log-sink';
import { LogRecord } from './log-sink';

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

describe('InMemoryLogSink', () => {
  it('按顺序保存所有 emit 的记录', () => {
    const sink = new InMemoryLogSink();
    sink.emit(makeRecord({ msg: 'a' }));
    sink.emit(makeRecord({ msg: 'b' }));
    expect(sink.records.map((r) => r.msg)).toEqual(['a', 'b']);
  });

  it('findByKind 只返回指定 kind 的记录', () => {
    const sink = new InMemoryLogSink();
    sink.emit(makeRecord({ kind: 'access' }));
    sink.emit(makeRecord({ kind: 'error' }));
    sink.emit(makeRecord({ kind: 'trace', event: 'task.created' }));
    expect(sink.findByKind('trace')).toHaveLength(1);
  });

  it('findEvents 按顺序返回 trace 事件的 event 字段', () => {
    const sink = new InMemoryLogSink();
    sink.emit(makeRecord({ kind: 'trace', event: 'task.created' }));
    sink.emit(makeRecord({ kind: 'trace', event: 'task.answered' }));
    expect(sink.findEvents()).toEqual(['task.created', 'task.answered']);
  });

  it('clear 清空记录', () => {
    const sink = new InMemoryLogSink();
    sink.emit(makeRecord());
    sink.clear();
    expect(sink.records).toHaveLength(0);
  });
});

describe('NoopLogSink', () => {
  it('emit 不抛异常也不保留任何东西', () => {
    const sink = new NoopLogSink();
    expect(() => sink.emit(makeRecord())).not.toThrow();
  });
});
