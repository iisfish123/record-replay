import { ClickHouseWriter, ClickHouseWriterOptions, InsertClient, toRow } from './clickhouse-writer';
import { LogRecord } from '../log-sink';

function makeOptions(overrides: Partial<ClickHouseWriterOptions> = {}): ClickHouseWriterOptions {
  return {
    url: 'http://127.0.0.1:8123',
    database: 'record_replay',
    user: 'default',
    password: '',
    batchMax: 500,
    flushIntervalMs: 60_000,
    maxRetry: 3,
    ...overrides,
  };
}

function makeClient() {
  const inserted: any[] = [];
  const client: InsertClient & { inserted: any[]; command: jest.Mock } = {
    inserted,
    command: jest.fn().mockResolvedValue(undefined),
    insert: jest.fn(async (args: any) => {
      inserted.push(args);
    }) as any,
    close: jest.fn().mockResolvedValue(undefined),
  };
  return client;
}

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

describe('toRow', () => {
  it('LogRecord → ClickHouse 行：下划线列名 + 缺省值 + meta 序列化', () => {
    const row = toRow(
      makeRecord({
        userId: 'u-1',
        personaId: 'p-1',
        taskId: 'task-1',
        method: 'POST',
        path: '/x',
        status: 201,
        durationMs: 42,
        meta: { a: 1 },
      }),
    );
    expect(row).toEqual({
      ts: '2026-11-17T08:30:12.345Z',
      level: 'info',
      kind: 'access',
      trace_id: 'T-1',
      msg: 'hello',
      user_id: 'u-1',
      persona_id: 'p-1',
      task_id: 'task-1',
      method: 'POST',
      path: '/x',
      status: 201,
      duration_ms: 42,
      code: '',
      stack: '',
      event: '',
      stage: '',
      total_duration_ms: 0,
      meta: '{"a":1}',
    });
  });

  it('没传的可选字段走默认值', () => {
    const row = toRow(makeRecord());
    expect(row.user_id).toBe('');
    expect(row.status).toBe(0);
    expect(row.duration_ms).toBe(0);
    expect(row.meta).toBe('');
  });
});

describe('ClickHouseWriter', () => {
  it('ensureSchema 先建库再建表', async () => {
    const client = makeClient();
    const writer = new ClickHouseWriter(makeOptions(), client);
    await writer.ensureSchema();
    expect(client.command).toHaveBeenCalledTimes(2);
    expect(client.command.mock.calls[0][0].query).toContain('CREATE DATABASE IF NOT EXISTS record_replay');
    expect(client.command.mock.calls[1][0].query).toContain('CREATE TABLE IF NOT EXISTS record_replay.rr_logs');
    await writer.close();
  });

  it('未满 batchMax 时不立即写，攒够定时器间隔再写', async () => {
    const client = makeClient();
    const writer = new ClickHouseWriter(makeOptions({ flushIntervalMs: 10 }), client);
    await writer.insert([makeRecord()]);
    expect(client.insert).not.toHaveBeenCalled();
    await new Promise((r) => setTimeout(r, 60));
    expect(client.insert).toHaveBeenCalledTimes(1);
    await writer.close();
  });

  it('达到 batchMax 立即写，不等待定时器', async () => {
    const client = makeClient();
    const writer = new ClickHouseWriter(makeOptions({ batchMax: 2 }), client);
    await writer.insert([makeRecord(), makeRecord()]);
    expect(client.insert).toHaveBeenCalledTimes(1);
    expect(client.inserted[0].values).toHaveLength(2);
    expect(client.inserted[0]).toMatchObject({ table: 'rr_logs', format: 'JSONEachRow' });
    await writer.close();
  });

  it('insert 抛错时按 maxRetry 重试，最终失败则抛出（供上层不提交 offset）', async () => {
    const client = makeClient();
    (client.insert as jest.Mock).mockRejectedValue(new Error('connection refused'));
    const writer = new ClickHouseWriter(makeOptions({ batchMax: 1, maxRetry: 3 }), client);
    await expect(writer.insert([makeRecord()])).rejects.toThrow('connection refused');
    expect(client.insert).toHaveBeenCalledTimes(3);
    // 失败的批次被放回缓冲，close() 会再试一次并同样失败；这里吞掉，
    // 因为「写不进去」正是上层不提交 offset 的信号。
    await writer.close().catch(() => undefined);
    expect(client.close).toHaveBeenCalled();
  });

  it('重试后成功则不抛出', async () => {
    const client = makeClient();
    (client.insert as jest.Mock)
      .mockRejectedValueOnce(new Error('flaky'))
      .mockResolvedValueOnce(undefined);
    const writer = new ClickHouseWriter(makeOptions({ batchMax: 1, maxRetry: 3 }), client);
    await expect(writer.insert([makeRecord()])).resolves.toBeUndefined();
    expect(client.insert).toHaveBeenCalledTimes(2);
    await writer.close();
  });

  it('close 会 flush 残留并关闭 client', async () => {
    const client = makeClient();
    const writer = new ClickHouseWriter(makeOptions(), client);
    await writer.insert([makeRecord({ msg: 'leftover' })]);
    await writer.close();
    expect(client.insert).toHaveBeenCalledTimes(1);
    expect(client.inserted[0].values[0].msg).toBe('leftover');
    expect(client.close).toHaveBeenCalled();
  });

  it('insert 空数组什么也不做', async () => {
    const client = makeClient();
    const writer = new ClickHouseWriter(makeOptions(), client);
    await writer.insert([]);
    expect(client.insert).not.toHaveBeenCalled();
    await writer.close();
  });
});
