/**
 * 测试统一使用独立测试库，避免像 record_replay 那样被 e2e 反复写入脏数据。
 *
 * @nestjs/config 加载 .env.development 时只会补全 process.env 里「缺失」的键，
 * 且 ConfigService.get() 优先读 process.env，因此在这里提前写入 MYSQL_DATABASE
 * 即可覆盖配置文件里的开发库。库本身由 global-setup-e2e.ts 创建，表结构靠 synchronize 自动生成。
 */
export const TEST_DATABASE = process.env.MYSQL_TEST_DATABASE ?? 'record_replay_test';

process.env.MYSQL_DATABASE = TEST_DATABASE;
