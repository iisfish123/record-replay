import { Inject, Injectable } from '@nestjs/common';
import { LogEvent } from './log-events';
import { LOG_SINK, LogRecord, LogSink } from './log-sink';
import { getTraceId } from './trace-context';

/** 「用户提问 → 生成视频回答」全链路埋点。 */
@Injectable()
export class TaskTracer {
  constructor(@Inject(LOG_SINK) private readonly sink: LogSink) {}

  created(taskId: string, personaId: string, question: string): void {
    this.emit({
      event: LogEvent.TaskCreated,
      stage: 'pending',
      taskId,
      personaId,
      msg: `任务已创建: ${taskId}`,
      meta: { questionChars: question.length },
    });
  }

  answered(taskId: string, personaId: string, durationMs: number, answerChars: number): void {
    this.emit({
      event: LogEvent.TaskAnswered,
      stage: 'answering',
      taskId,
      personaId,
      durationMs,
      msg: `LLM 回答完成: ${answerChars} 字, ${durationMs}ms`,
      meta: { answerChars },
    });
  }

  ttsDone(taskId: string, personaId: string, durationMs: number, audioBytes: number): void {
    this.emit({
      event: LogEvent.TaskTtsDone,
      stage: 'tts',
      taskId,
      personaId,
      durationMs,
      msg: `语音合成完成: ${audioBytes} 字节, ${durationMs}ms`,
      meta: { audioBytes },
    });
  }

  renderSubmitted(taskId: string, personaId: string, durationMs: number, remoteTaskId: string): void {
    this.emit({
      event: LogEvent.TaskRenderSubmitted,
      stage: 'rendering',
      taskId,
      personaId,
      durationMs,
      msg: `口型任务已提交: ${remoteTaskId}, ${durationMs}ms`,
      meta: { remoteTaskId },
    });
  }

  renderPolled(taskId: string, personaId: string, round: number, remoteStatus: string): void {
    this.emit({
      event: LogEvent.TaskRenderPolled,
      stage: 'rendering',
      taskId,
      personaId,
      msg: `第 ${round} 次轮询: ${remoteStatus}`,
      meta: { round, remoteStatus },
    });
  }

  videoReady(taskId: string, personaId: string, totalDurationMs: number): void {
    this.emit({
      event: LogEvent.TaskVideoReady,
      stage: 'done',
      taskId,
      personaId,
      totalDurationMs,
      msg: `视频生成完成，总耗时 ${totalDurationMs}ms`,
    });
  }

  failed(taskId: string, personaId: string, stage: string, error: string, totalDurationMs: number, stack?: string): void {
    this.emit({
      level: 'error',
      event: LogEvent.TaskFailed,
      stage,
      taskId,
      personaId,
      totalDurationMs,
      stack,
      msg: `任务失败于 ${stage}: ${error}`,
    });
  }

  private emit(partial: Omit<LogRecord, 'ts' | 'level' | 'kind' | 'traceId'> & { level?: LogRecord['level'] }): void {
    this.sink.emit({
      ts: new Date().toISOString(),
      level: partial.level ?? 'info',
      kind: 'trace',
      traceId: getTraceId(),
      msg: partial.msg,
      userId: partial.userId,
      personaId: partial.personaId,
      taskId: partial.taskId,
      durationMs: partial.durationMs,
      stack: partial.stack,
      event: partial.event,
      stage: partial.stage,
      totalDurationMs: partial.totalDurationMs,
      meta: partial.meta,
    });
  }
}
