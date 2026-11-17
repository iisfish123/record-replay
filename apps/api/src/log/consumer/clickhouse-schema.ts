export const LOGS_TABLE = 'rr_logs';

/** 单表 + kind 字段：写入与查询都简单，kind/level 用 LowCardinality 压缩。 */
export function createDatabaseSql(database: string): string {
  return `CREATE DATABASE IF NOT EXISTS ${database}`;
}

export function createTableSql(database: string): string {
  return `
CREATE TABLE IF NOT EXISTS ${database}.${LOGS_TABLE}
(
    ts                DateTime64(3, 'UTC'),
    level             LowCardinality(String),
    kind              LowCardinality(String),
    trace_id          String,
    msg               String,
    user_id           String DEFAULT '',
    persona_id        String DEFAULT '',
    task_id           String DEFAULT '',
    method            LowCardinality(String) DEFAULT '',
    path              String DEFAULT '',
    status            UInt16 DEFAULT 0,
    duration_ms       UInt32 DEFAULT 0,
    code              LowCardinality(String) DEFAULT '',
    stack             String DEFAULT '',
    event             LowCardinality(String) DEFAULT '',
    stage             LowCardinality(String) DEFAULT '',
    total_duration_ms UInt32 DEFAULT 0,
    meta              String DEFAULT '',
    INDEX idx_trace_id trace_id TYPE bloom_filter GRANULARITY 1
)
ENGINE = MergeTree
PARTITION BY toYYYYMMDD(ts)
ORDER BY (kind, ts)
TTL toDateTime(ts) + INTERVAL 30 DAY
SETTINGS index_granularity = 8192
`.trim();
}
