import { ConsoleLogger, Inject, Injectable, LogLevel } from '@nestjs/common';
import { LOG_SINK, LogSink } from './log-sink';
import { getTraceId } from './trace-context';

/** 把 Nest 自身的日志也复制一份到 LogSink（kind = 'app'）。 */
@Injectable()
export class AppLoggerService extends ConsoleLogger {
  constructor(@Inject(LOG_SINK) private readonly sink: LogSink) {
    super();
  }

  log(message: unknown, context?: string): void {
    super.log(message, context);
    this.emit('info', message, context);
  }

  warn(message: unknown, context?: string): void {
    super.warn(message, context);
    this.emit('warn', message, context);
  }

  error(message: unknown, stack?: string, context?: string): void {
    super.error(message, stack, context);
    this.emit('error', message, context, stack);
  }

  debug(message: unknown, context?: string): void {
    super.debug(message, context);
  }

  verbose(message: unknown, context?: string): void {
    super.verbose(message, context);
  }

  /** 供 main.ts 传 logLevels 用，透传给 ConsoleLogger。 */
  setLogLevels(levels: LogLevel[]): void {
    super.setLogLevels(levels);
  }

  private emit(level: 'info' | 'warn' | 'error', message: unknown, context?: string, stack?: string): void {
    this.sink.emit({
      ts: new Date().toISOString(),
      level,
      kind: 'app',
      traceId: getTraceId(),
      msg: `[${context ?? 'App'}] ${this.toText(message)}`,
      stack,
    });
  }

  private toText(message: unknown): string {
    if (typeof message === 'string') return message;
    if (message instanceof Error) return message.message;
    try {
      return JSON.stringify(message);
    } catch {
      return String(message);
    }
  }
}
