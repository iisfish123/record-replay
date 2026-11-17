import type { LogEvent } from './log-events';

export type LogLevel = 'info' | 'warn' | 'error';

/** 决定日志进哪个 Kafka topic。 */
export type LogKind = 'access' | 'error' | 'trace' | 'app';

/** 所有日志统一信封，也是 Kafka 消息体的形状。 */
export interface LogRecord {
  ts: string;
  level: LogLevel;
  kind: LogKind;
  traceId: string;
  msg: string;
  userId?: string;
  personaId?: string;
  taskId?: string;
  method?: string;
  path?: string;
  status?: number;
  durationMs?: number;
  code?: string;
  stack?: string;
  event?: LogEvent;
  stage?: string;
  totalDurationMs?: number;
  meta?: Record<string, unknown>;
}

/** 依赖倒置的核心抽象：上层只认这个接口，不认 Kafka。 */
export interface LogSink {
  emit(record: LogRecord): void;
}

export const LOG_SINK = Symbol('LOG_SINK');
