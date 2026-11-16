import { createConnection } from 'mysql2/promise';
import { TEST_DATABASE } from './setup-env';

/**
 * TypeORM 的 synchronize 只建表不建库，因此测试前先确保测试库存在。
 * 连接参数默认与 .env.development 一致，可用 MYSQL_* 环境变量覆盖。
 */
export default async function globalSetup(): Promise<void> {
  const connection = await createConnection({
    host: process.env.MYSQL_HOST ?? '127.0.0.1',
    port: Number(process.env.MYSQL_PORT ?? 3316),
    user: process.env.MYSQL_USER ?? 'root',
    password: process.env.MYSQL_PASSWORD ?? 'recordreplay',
  });
  await connection.query(`CREATE DATABASE IF NOT EXISTS \`${TEST_DATABASE}\``);
  await connection.end();
}
