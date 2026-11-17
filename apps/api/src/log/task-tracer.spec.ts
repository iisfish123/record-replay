import { InMemoryLogSink } from './in-memory-log-sink';
import { TaskTracer } from './task-tracer';
import { runWithTrace } from './trace-context';

describe('TaskTracer', () => {
  it('created：发出 task.created / stage=pending，携带 question 长度', () => {
    const sink = new InMemoryLogSink();
    runWithTrace('T-t', () => new TaskTracer(sink).created('task-1', 'p-1', '你好世界'));
    expect(sink.findByKind('trace')[0]).toMatchObject({
      level: 'info',
      kind: 'trace',
      traceId: 'T-t',
      event: 'task.created',
      stage: 'pending',
      taskId: 'task-1',
      personaId: 'p-1',
    });
    expect((sink.findByKind('trace')[0].meta as any).questionChars).toBe(4);
  });

  it('answered：stage=answering，带 durationMs 与 answerChars', () => {
    const sink = new InMemoryLogSink();
    runWithTrace('T-t', () => new TaskTracer(sink).answered('task-1', 'p-1', 1234, 42));
    expect(sink.findByKind('trace')[0]).toMatchObject({
      event: 'task.answered',
      stage: 'answering',
      durationMs: 1234,
    });
    expect((sink.findByKind('trace')[0].meta as any).answerChars).toBe(42);
  });

  it('ttsDone：stage=tts，带 durationMs 与 audioBytes', () => {
    const sink = new InMemoryLogSink();
    runWithTrace('T-t', () => new TaskTracer(sink).ttsDone('task-1', 'p-1', 800, 20480));
    expect(sink.findByKind('trace')[0]).toMatchObject({
      event: 'task.tts.done',
      stage: 'tts',
      durationMs: 800,
    });
    expect((sink.findByKind('trace')[0].meta as any).audioBytes).toBe(20480);
  });

  it('renderSubmitted：stage=rendering，带 remoteTaskId', () => {
    const sink = new InMemoryLogSink();
    runWithTrace('T-t', () => new TaskTracer(sink).renderSubmitted('task-1', 'p-1', 300, 'remote-9'));
    expect(sink.findByKind('trace')[0]).toMatchObject({
      event: 'task.render.submitted',
      stage: 'rendering',
      durationMs: 300,
    });
    expect((sink.findByKind('trace')[0].meta as any).remoteTaskId).toBe('remote-9');
  });

  it('renderPolled：stage=rendering，带 round 与 remoteStatus', () => {
    const sink = new InMemoryLogSink();
    runWithTrace('T-t', () => new TaskTracer(sink).renderPolled('task-1', 'p-1', 2, 'processing'));
    expect(sink.findByKind('trace')[0]).toMatchObject({
      event: 'task.render.polled',
      stage: 'rendering',
    });
    expect((sink.findByKind('trace')[0].meta as any)).toMatchObject({ round: 2, remoteStatus: 'processing' });
  });

  it('videoReady：stage=done，带 totalDurationMs', () => {
    const sink = new InMemoryLogSink();
    runWithTrace('T-t', () => new TaskTracer(sink).videoReady('task-1', 'p-1', 45000));
    expect(sink.findByKind('trace')[0]).toMatchObject({
      event: 'task.video.ready',
      stage: 'done',
      totalDurationMs: 45000,
    });
  });

  it('failed：level=error，带失败阶段、总耗时与堆栈', () => {
    const sink = new InMemoryLogSink();
    runWithTrace('T-t', () =>
      new TaskTracer(sink).failed('task-1', 'p-1', 'tts', 'TTS 调用失败', 5000, 'Error: TTS 调用失败\n  at x'),
    );
    const record = sink.findByKind('trace')[0];
    expect(record).toMatchObject({
      level: 'error',
      event: 'task.failed',
      stage: 'tts',
      totalDurationMs: 5000,
      taskId: 'task-1',
    });
    expect(record.stack).toContain('TTS 调用失败');
  });

  it('traceId 取自 AsyncLocalStorage，无需入参', () => {
    const sink = new InMemoryLogSink();
    runWithTrace('T-from-als', () => new TaskTracer(sink).videoReady('task-1', 'p-1', 1));
    expect(sink.findByKind('trace')[0].traceId).toBe('T-from-als');
  });
});
