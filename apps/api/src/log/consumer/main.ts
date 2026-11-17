/**
 * log-consumer：独立进程（非 Nest 应用）。
 * 职责单一 —— 从 Kafka 拉日志，攒批写入 ClickHouse。
 *
 * 启动：pnpm --filter @record-replay/api log:consumer
 */
import { config as loadEnv } from 'dotenv';
import { Kafka } from 'kafkajs';
import { LogRecord } from '../log-sink';
import { ClickHouseWriter } from './clickhouse-writer';

loadEnv({ path: '.env.development' });
loadEnv();

const TOPICS = ['rr.api.access', 'rr.api.error', 'rr.task.trace'];
const GROUP_ID = 'rr-log-archiver';

function env(name: string, fallback: string): string {
  return process.env[name] || fallback;
}

function num(name: string, fallback: number): number {
  return parseInt(process.env[name] ?? String(fallback), 10);
}

async function main(): Promise<void> {
  const brokers = env('KAFKA_BROKERS', '127.0.0.1:9093').split(',');
  const clientId = env('KAFKA_CLIENT_ID', 'record-replay-log-consumer');

  const writer = new ClickHouseWriter({
    url: env('CLICKHOUSE_URL', 'http://127.0.0.1:8123'),
    database: env('CLICKHOUSE_DATABASE', 'record_replay'),
    user: env('CLICKHOUSE_USER', 'default'),
    password: env('CLICKHOUSE_PASSWORD', ''),
    batchMax: num('CH_BATCH_MAX', 500),
    flushIntervalMs: num('CH_FLUSH_INTERVAL_MS', 1000),
    maxRetry: num('CH_MAX_RETRY', 3),
  });

  // 自举建表：不依赖容器 initdb 脚本
  await writer.ensureSchema();

  const kafka = new Kafka({ clientId, brokers });

  // 兜底确保 topic 存在（幂等），换机器也能跑起来
  const admin = kafka.admin();
  await admin.connect();
  await admin.createTopics({
    waitForLeaders: true,
    topics: [
      {
        topic: 'rr.api.access',
        numPartitions: 3,
        replicationFactor: 1,
        configEntries: [{ name: 'retention.ms', value: '259200000' }],
      },
      {
        topic: 'rr.api.error',
        numPartitions: 3,
        replicationFactor: 1,
        configEntries: [{ name: 'retention.ms', value: '2592000000' }],
      },
      {
        topic: 'rr.task.trace',
        numPartitions: 3,
        replicationFactor: 1,
        configEntries: [{ name: 'retention.ms', value: '2592000000' }],
      },
    ],
  });
  await admin.disconnect();

  const consumer = kafka.consumer({ groupId: GROUP_ID, sessionTimeout: 30000, heartbeatInterval: 3000 });
  await consumer.connect();
  await consumer.subscribe({ topics: TOPICS, fromBeginning: false });

  await consumer.run({
    eachBatchAutoResolve: false,
    eachBatch: async ({ batch, resolveOffset, heartbeat, commitOffsetsIfNecessary }) => {
      const records = batch.messages
        .filter((m) => m.value)
        .map((m) => JSON.parse(m.value!.toString()) as LogRecord);

      // 写成功才继续；抛错则 offset 不提交，下次重投（at-least-once）
      await writer.insert(records);

      for (const message of batch.messages) resolveOffset(message.offset);
      await heartbeat();
      await commitOffsetsIfNecessary();
    },
  });

  const shutdown = async (signal: string): Promise<void> => {
    process.stderr.write(`[log-consumer] 收到 ${signal}，正在优雅退出\n`);
    try {
      await consumer.disconnect();
      await writer.close();
    } finally {
      process.exit(0);
    }
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  process.stderr.write(`[log-consumer] 已启动，订阅 ${TOPICS.join(', ')}，消费组 ${GROUP_ID}\n`);
}

main().catch((err) => {
  process.stderr.write(`[log-consumer] 启动失败: ${err?.stack ?? err}\n`);
  process.exit(1);
});
