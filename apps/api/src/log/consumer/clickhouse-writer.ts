import { createClient } from '@clickhouse/client';
import { LogRecord } from '../log-sink';
import { LOGS_TABLE, createDatabaseSql, createTableSql } from './clickhouse-schema';

export interface ClickHouseWriterOptions {
  url: string;
  database: string;
  user: string;
  password: string;
  batchMax: number;
  flushIntervalMs: number;
  maxRetry: number;
}

/** 抽象出 client 便于单测注入替身。 */
export interface InsertClient {
  command(args: { query: string }): Promise<unknown>;
  insert(args: { table: string; values: unknown[]; format: 'JSONEachRow' }): Promise<unknown>;
  close(): Promise<void>;
}

export type ClickHouseRow = Record<string, string | number>;

/** LogRecord（camelCase）→ ClickHouse 行（snake_case），缺省值补齐。 */
export function toRow(record: LogRecord): ClickHouseRow {
  return {
    ts: record.ts,
    level: record.level,
    kind: record.kind,
    trace_id: record.traceId,
    msg: record.msg,
    user_id: record.userId ?? '',
    persona_id: record.personaId ?? '',
    task_id: record.taskId ?? '',
    method: record.method ?? '',
    path: record.path ?? '',
    status: record.status ?? 0,
    duration_ms: record.durationMs ?? 0,
    code: record.code ?? '',
    stack: record.stack ?? '',
    event: record.event ?? '',
    stage: record.stage ?? '',
    total_duration_ms: record.totalDurationMs ?? 0,
    meta: record.meta ? JSON.stringify(record.meta) : '',
  };
}

function createClickHouseClient(options: ClickHouseWriterOptions): InsertClient {
  const client = createClient({
    url: options.url,
    username: options.user,
    password: options.password,
    database: options.database,
    clickhouse_settings: { date_time_input_format: 'best_effort' },
  });
  return {
    command: (args) => client.command(args),
    insert: (args) => client.insert(args as never),
    close: () => client.close(),
  };
}

const RETRY_BASE_DELAY_MS = 100;

/**
 * ClickHouse 不怕数据量大，怕写入次数多（每次 INSERT 生成一个 part）。
 * 所以必须攒批：满 batchMax 立即写，否则等 flushIntervalMs。
 */
export class ClickHouseWriter {
  private readonly buffer: ClickHouseRow[] = [];
  private readonly client: InsertClient;
  private readonly timer: NodeJS.Timeout;
  private flushing = false;

  constructor(
    private readonly options: ClickHouseWriterOptions,
    client?: InsertClient,
  ) {
    this.client = client ?? createClickHouseClient(options);
    this.timer = setInterval(() => {
      void this.flush().catch((err) => {
        process.stderr.write(`[ClickHouseWriter] 定时 flush 失败: ${err?.message ?? err}\n`);
      });
    }, options.flushIntervalMs);
    this.timer.unref?.();
  }

  async ensureSchema(): Promise<void> {
    await this.client.command({ query: createDatabaseSql(this.options.database) });
    await this.client.command({ query: createTableSql(this.options.database) });
  }

  async insert(records: LogRecord[]): Promise<void> {
    if (records.length === 0) return;
    for (const record of records) this.buffer.push(toRow(record));
    if (this.buffer.length >= this.options.batchMax) await this.flush();
  }

  async flush(): Promise<void> {
    if (this.flushing) return;
    this.flushing = true;
    try {
      while (this.buffer.length > 0) {
        const batch = this.buffer.splice(0, this.options.batchMax);
        await this.writeWithRetry(batch);
      }
    } finally {
      this.flushing = false;
    }
  }

  async close(): Promise<void> {
    clearInterval(this.timer);
    try {
      await this.flush();
    } finally {
      await this.client.close();
    }
  }

  private async writeWithRetry(batch: ClickHouseRow[]): Promise<void> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= this.options.maxRetry; attempt++) {
      try {
        await this.client.insert({ table: LOGS_TABLE, values: batch, format: 'JSONEachRow' });
        return;
      } catch (err) {
        lastError = err;
        if (attempt < this.options.maxRetry) {
          await new Promise((r) => setTimeout(r, RETRY_BASE_DELAY_MS * attempt));
        }
      }
    }
    // 写不进去就放回队首，等上层不提交 offset 后由 Kafka 重投
    this.buffer.unshift(...batch);
    throw lastError;
  }
}
