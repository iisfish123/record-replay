import { LOGS_TABLE, createDatabaseSql, createTableSql } from './clickhouse-schema';

describe('clickhouse-schema', () => {
  it('建库语句幂等', () => {
    expect(createDatabaseSql('record_replay')).toBe('CREATE DATABASE IF NOT EXISTS record_replay');
  });

  it('建表语句幂等且带库名前缀', () => {
    const sql = createTableSql('record_replay');
    expect(sql).toContain(`CREATE TABLE IF NOT EXISTS record_replay.${LOGS_TABLE}`);
  });

  it('表结构含 MergeTree / 按天分区 / 30 天 TTL / trace_id 跳数索引', () => {
    const sql = createTableSql('record_replay');
    expect(sql).toContain('ENGINE = MergeTree');
    expect(sql).toContain('PARTITION BY toYYYYMMDD(ts)');
    expect(sql).toContain('ORDER BY (kind, ts)');
    expect(sql).toContain('TTL toDateTime(ts) + INTERVAL 30 DAY');
    expect(sql).toContain('INDEX idx_trace_id trace_id TYPE bloom_filter GRANULARITY 1');
  });

  it('列名与 writer 的行字段一一对应', () => {
    const sql = createTableSql('record_replay');
    for (const column of [
      'ts',
      'level',
      'kind',
      'trace_id',
      'msg',
      'user_id',
      'persona_id',
      'task_id',
      'method',
      'path',
      'status',
      'duration_ms',
      'code',
      'stack',
      'event',
      'stage',
      'total_duration_ms',
      'meta',
    ]) {
      expect(sql).toMatch(new RegExp(`\\b${column}\\b`));
    }
  });
});
