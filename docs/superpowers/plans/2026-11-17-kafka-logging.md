# Kafka 日志系统 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给 record-replay 后端接上「访问日志 + traceId + 全局异常过滤器 + 关键链路埋点」，日志经 Kafka 削峰后由独立进程批量落入 ClickHouse。

**Architecture:** API 进程内定义 `LogSink` 接口（依赖倒置），唯一实现 `KafkaLogSink` 负责「内存队列 + 定时批量 + 失败降级」；`TraceMiddleware` 在最外层生成/沿用 `traceId` 并写入 `AsyncLocalStorage`，`AccessLogInterceptor` / `AllExceptionsFilter` / `TaskTracer` 只依赖 `LogSink` 接口。独立进程 `log-consumer` 从 Kafka 拉取、攒批 `INSERT` 进 ClickHouse（`rr_logs` 单表 + `kind` 字段）。

**Tech Stack:** NestJS 11 + TypeScript 5.9 + kafkajs + @clickhouse/client + Kafka 4.0 KRaft（`bitnamilegacy/kafka:4.0.0-debian-12-r10`）+ ClickHouse 25.3（`bitnami/clickhouse:25.3.1`）+ Jest 30 + supertest。

**设计依据（已评审）：** [`docs/superpowers/specs/2026-11-17-kafka-logging-design.md`](../specs/2026-11-17-kafka-logging-design.md)
**配套教学：** [`docs/learn/kafka-log.md`](../../learn/kafka-log.md)

**对规格的两处实现级修正（本计划生效）：**
1. 规格 §12 的 Kafka 只配了单一 `PLAINTEXT` listener（advertised `127.0.0.1:9093`）。这样 compose 网络内的 `kafka-init` 容器连接 `kafka:9092` 后会被重定向到 `127.0.0.1:9093`（它自己容器内的回环），必然失败。因此本计划改用**双 listener**：`INTERNAL://kafka:29092`（网络内）+ `EXTERNAL://127.0.0.1:9093`（宿主机）。
2. 规格 §13 配置表漏了 `LOG_BATCH_MAX`，但 §9.2 明确 `BATCH_MAX = 200`，故补上该配置项。

**测试基线：** 当前 13 suites / 67 tests 全绿。每个 Task 结束都必须保持全绿。

---

## 文件结构

**新增（API 进程）**

| 文件 | 职责 |
|---|---|
| `apps/api/src/log/log-events.ts` | 7 个埋点事件名的 `const` 对象 + 联合类型 |
| `apps/api/src/log/log-sink.ts` | `LogRecord` / `LogSink` 接口 / `LOG_SINK` 注入令牌 |
| `apps/api/src/log/in-memory-log-sink.ts` | 测试替身，记录所有 `LogRecord` 供断言 |
| `apps/api/src/log/noop-log-sink.ts` | 关闭 Kafka 时的空实现 |
| `apps/api/src/log/kafka-log-sink.ts` | **唯一** import `kafkajs` 的文件 |
| `apps/api/src/log/trace-context.ts` | `AsyncLocalStorage` + `getTraceId()` + `runWithTrace()` |
| `apps/api/src/log/trace.middleware.ts` | 生成/沿用 `traceId`，回写响应头，进 ALS |
| `apps/api/src/log/access-log.interceptor.ts` | 每次 HTTP 访问发一条 `kind:'access'` |
| `apps/api/src/log/all-exceptions.filter.ts` | 统一错误结构 + 堆栈只进日志 |
| `apps/api/src/log/task-tracer.ts` | 7 个关键埋点的对外方法 |
| `apps/api/src/log/app-logger.service.ts` | `extends ConsoleLogger`，把 Nest 日志也导进 `LogSink` |
| `apps/api/src/log/log.module.ts` | `@Global()`，按 `LOG_KAFKA_ENABLED` 绑定 `LOG_SINK` |

**新增（独立消费进程）**

| 文件 | 职责 |
|---|---|
| `apps/api/src/log/consumer/clickhouse-schema.ts` | 建库建表 DDL（幂等） |
| `apps/api/src/log/consumer/clickhouse-writer.ts` | 攒批 + 重试的 ClickHouse 写入器 |
| `apps/api/src/log/consumer/main.ts` | `log-consumer` 进程入口 |

**改动**

| 文件 | 改动 |
|---|---|
| `docker/docker-compose.yml` | 新增 `kafka` / `kafka-init` / `clickhouse` 三个 service |
| `.gitignore` | 忽略 `docker/kafka_data/`、`docker/clickhouse_data/` |
| `apps/api/package.json` | 依赖 `kafkajs` / `@clickhouse/client` / `dotenv`；script `log:consumer` |
| `apps/api/src/config/configuration.ts` | `AppConfig` 新增 `log` / `clickhouse` 两段 |
| `apps/api/.env.example` + `apps/api/.env.development` | 新增日志相关变量 |
| `apps/api/test/setup-env.ts` | 测试默认 `LOG_KAFKA_ENABLED=false` |
| `apps/api/src/task/entities/render-task.entity.ts` | 新增 `traceId` 列 |
| `apps/api/src/task/task.service.ts` | `create()` 落 traceId；`process()` 里 `runWithTrace` 续接 + 7 个埋点 |
| `apps/api/src/app.module.ts` | import `LogModule`；注册 `APP_INTERCEPTOR` / `APP_FILTER` |
| `apps/api/src/main.ts` | `bufferLogs` + `useLogger(AppLoggerService)` + 挂 `TraceMiddleware` |

---

## Task 1: 起 Kafka 与 ClickHouse 容器

**Files:**
- Modify: `docker/docker-compose.yml`
- Modify: `.gitignore`

- [ ] **Step 1: 追加三个 service 到 `docker/docker-compose.yml`**

在文件末尾（`redis` 之后）追加：

```yaml
  kafka:
    image: bitnamilegacy/kafka:4.0.0-debian-12-r10
    pull_policy: never
    container_name: record-replay-kafka
    ports:
      - "127.0.0.1:9093:9092"
    environment:
      KAFKA_CFG_NODE_ID: "0"
      KAFKA_CFG_PROCESS_ROLES: "broker,controller"
      KAFKA_CFG_CONTROLLER_QUORUM_VOTERS: "0@kafka:9093"
      KAFKA_CFG_LISTENERS: "INTERNAL://:29092,EXTERNAL://:9092,CONTROLLER://:9093"
      KAFKA_CFG_ADVERTISED_LISTENERS: "INTERNAL://kafka:29092,EXTERNAL://127.0.0.1:9093"
      KAFKA_CFG_LISTENER_SECURITY_PROTOCOL_MAP: "CONTROLLER:PLAINTEXT,INTERNAL:PLAINTEXT,EXTERNAL:PLAINTEXT"
      KAFKA_CFG_INTER_BROKER_LISTENER_NAME: "INTERNAL"
      KAFKA_CFG_CONTROLLER_LISTENER_NAMES: "CONTROLLER"
      KAFKA_CFG_AUTO_CREATE_TOPICS_ENABLE: "false"
      KAFKA_CFG_NUM_PARTITIONS: "3"
      KAFKA_CFG_DEFAULT_REPLICATION_FACTOR: "1"
      ALLOW_PLAINTEXT_LISTENER: "yes"
    volumes:
      - ./kafka_data:/bitnami/kafka
    healthcheck:
      test: ["CMD-SHELL", "/opt/bitnami/kafka/bin/kafka-topics.sh --bootstrap-server 127.0.0.1:29092 --list"]
      interval: 10s
      timeout: 10s
      retries: 12

  kafka-init:
    image: bitnamilegacy/kafka:4.0.0-debian-12-r10
    pull_policy: never
    container_name: record-replay-kafka-init
    depends_on:
      kafka:
        condition: service_healthy
    entrypoint: ["/bin/bash", "-c"]
    command:
      - |
        set -e
        T=/opt/bitnami/kafka/bin/kafka-topics.sh
        $$T --bootstrap-server kafka:29092 --create --if-not-exists \
          --topic rr.api.access --partitions 3 --replication-factor 1 \
          --config retention.ms=259200000
        $$T --bootstrap-server kafka:29092 --create --if-not-exists \
          --topic rr.api.error --partitions 3 --replication-factor 1 \
          --config retention.ms=2592000000
        $$T --bootstrap-server kafka:29092 --create --if-not-exists \
          --topic rr.task.trace --partitions 3 --replication-factor 1 \
          --config retention.ms=2592000000
        $$T --bootstrap-server kafka:29092 --list

  clickhouse:
    image: bitnami/clickhouse:25.3.1
    pull_policy: never
    container_name: record-replay-clickhouse
    ports:
      - "127.0.0.1:8123:8123"
    environment:
      ALLOW_EMPTY_PASSWORD: "yes"
      CLICKHOUSE_DATABASE: record_replay
    volumes:
      - ./clickhouse_data:/bitnami/clickhouse
    healthcheck:
      test: ["CMD-SHELL", "curl -sf http://127.0.0.1:8123/ping || exit 1"]
      interval: 10s
      timeout: 5s
      retries: 12
```

> `$$T` 里的 `$$` 是 docker-compose 的转义，交给容器后变成 `$T`（compose 变量插值）。
> `kafka:29092` 是容器网络内的 advertised 地址，`kafka-init` 能解析到它自己。

- [ ] **Step 2: 忽略数据卷目录**

在 `.gitignore` 的 `docker/mysql_data/` 下面加两行：

```
docker/kafka_data/
docker/clickhouse_data/
```

- [ ] **Step 3: 起容器**

Run:
```bash
cd /Users/lkz/202507/record-replay/docker && docker compose up -d kafka kafka-init clickhouse
```

- [ ] **Step 4: 验证 Kafka topic 与 ClickHouse 存活**

Run:
```bash
docker compose -f /Users/lkz/202507/record-replay/docker/docker-compose.yml logs kafka-init | tail -20
docker compose -f /Users/lkz/202507/record-replay/docker/docker-compose.yml ps
curl -sf http://127.0.0.1:8123/ping
```
Expected：
- `kafka-init` 日志里 `--list` 输出含 `rr.api.access`、`rr.api.error`、`rr.task.trace`
- `record-replay-kafka`、`record-replay-clickhouse` 状态 `Up`（healthy）
- `curl` 输出 `Ok`

> 若 `clickhouse` 报 unhealthy：`docker exec record-replay-clickhouse curl -sf http://127.0.0.1:8123/ping` 手动确认；镜像里没有 `curl` 就把 healthcheck 换成 `["CMD-SHELL", "clickhouse-client --query 'SELECT 1' || exit 1"]`。

- [ ] **Step 5: Commit**

```bash
cd /Users/lkz/202507/record-replay
git add docker/docker-compose.yml .gitignore
git commit -m "chore(logging): docker 增加 Kafka(KRaft) 与 ClickHouse 服务"
```

---

## Task 2: 依赖、配置项、测试默认关 Kafka

**Files:**
- Modify: `apps/api/package.json`
- Modify: `apps/api/src/config/configuration.ts`
- Modify: `apps/api/.env.example`
- Modify: `apps/api/.env.development`
- Modify: `apps/api/test/setup-env.ts`

- [ ] **Step 1: 装依赖**

Run:
```bash
cd /Users/lkz/202507/record-replay
pnpm --filter @record-replay/api add kafkajs @clickhouse/client dotenv
```
Expected：`package.json` 的 `dependencies` 出现 `kafkajs`、`@clickhouse/client`、`dotenv`。

- [ ] **Step 2: 加 `log:consumer` script**

修改 `apps/api/package.json` 的 `scripts`，在 `"test:e2e"` 后加一行：

```json
    "test:e2e": "jest --config jest.config.js --runInBand",
    "log:consumer": "ts-node src/log/consumer/main.ts"
```

> `main.ts` 内部自己 `dotenv` 加载 `.env.development`，所以命令里不用 `-r dotenv/config`。

- [ ] **Step 3: `configuration.ts` 新增两段配置**

在 `AppConfig` 接口里，`answerMaxChars: number;` 之前插入：

```ts
  log: {
    kafkaEnabled: boolean;
    kafkaBrokers: string;
    kafkaClientId: string;
    flushIntervalMs: number;
    batchMax: number;
    queueMax: number;
  };
  clickhouse: {
    url: string;
    database: string;
    user: string;
    password: string;
    batchMax: number;
    flushIntervalMs: number;
    maxRetry: number;
  };
```

在 factory 的 `answerMaxChars` 之前插入：

```ts
  log: {
    kafkaEnabled: (process.env.LOG_KAFKA_ENABLED ?? 'true') !== 'false',
    kafkaBrokers: process.env.KAFKA_BROKERS ?? '127.0.0.1:9093',
    kafkaClientId: process.env.KAFKA_CLIENT_ID ?? 'record-replay-api',
    flushIntervalMs: parseInt(process.env.LOG_FLUSH_INTERVAL_MS ?? '500', 10),
    batchMax: parseInt(process.env.LOG_BATCH_MAX ?? '200', 10),
    queueMax: parseInt(process.env.LOG_QUEUE_MAX ?? '1000', 10),
  },
  clickhouse: {
    url: process.env.CLICKHOUSE_URL ?? 'http://127.0.0.1:8123',
    database: process.env.CLICKHOUSE_DATABASE ?? 'record_replay',
    user: process.env.CLICKHOUSE_USER ?? 'default',
    password: process.env.CLICKHOUSE_PASSWORD ?? '',
    batchMax: parseInt(process.env.CH_BATCH_MAX ?? '500', 10),
    flushIntervalMs: parseInt(process.env.CH_FLUSH_INTERVAL_MS ?? '1000', 10),
    maxRetry: parseInt(process.env.CH_MAX_RETRY ?? '3', 10),
  },
```

> `kafkaEnabled` 在 factory 里就转成布尔（`ConfigService` 不做类型转换，直接 `get<boolean>` 拿到的是字符串）。

- [ ] **Step 4: 写进 `.env.example`**

在 `apps/api/.env.example` 末尾追加：

```
# ---- 日志系统（Kafka → ClickHouse）----
KAFKA_BROKERS=127.0.0.1:9093
KAFKA_CLIENT_ID=record-replay-api
# false 时用 NoopLogSink，本地不起 Kafka 也能开发；测试环境默认 false
LOG_KAFKA_ENABLED=true
LOG_FLUSH_INTERVAL_MS=500
LOG_BATCH_MAX=200
LOG_QUEUE_MAX=1000

CLICKHOUSE_URL=http://127.0.0.1:8123
CLICKHOUSE_DATABASE=record_replay
CLICKHOUSE_USER=default
CLICKHOUSE_PASSWORD=
CH_BATCH_MAX=500
CH_FLUSH_INTERVAL_MS=1000
CH_MAX_RETRY=3
```

同样内容再追加一份到 `apps/api/.env.development`（该文件被 gitignore，只在本地生效）。

- [ ] **Step 5: 测试环境默认关闭 Kafka**

在 `apps/api/test/setup-env.ts` 末尾追加：

```ts
/**
 * 测试默认走 NoopLogSink：单测/e2e 不应该连真 Kafka，
 * 需要断言日志的 e2e（logging.e2e-spec.ts）自己 override LOG_SINK 为 InMemoryLogSink。
 */
process.env.LOG_KAFKA_ENABLED = 'false';
```

- [ ] **Step 6: 跑基线回归**

Run:
```bash
cd /Users/lkz/202507/record-replay && pnpm --filter @record-replay/api test -- --runInBand
```
Expected：13 suites / 67 tests 全绿（配置项只是新增，不改变行为）。

- [ ] **Step 7: Commit**

```bash
cd /Users/lkz/202507/record-replay
git add apps/api/package.json pnpm-lock.yaml apps/api/src/config/configuration.ts apps/api/.env.example apps/api/test/setup-env.ts
git commit -m "feat(logging): 引入 kafkajs/@clickhouse/client 依赖与日志配置项"
```

---

## Task 3: LogSink 抽象层

**Files:**
- Create: `apps/api/src/log/log-events.ts`
- Create: `apps/api/src/log/log-sink.ts`
- Create: `apps/api/src/log/in-memory-log-sink.ts`
- Create: `apps/api/src/log/noop-log-sink.ts`
- Test: `apps/api/src/log/log-sink.spec.ts`

- [ ] **Step 1: 写失败测试**

Create `apps/api/src/log/log-sink.spec.ts`:

```ts
import { InMemoryLogSink } from './in-memory-log-sink';
import { NoopLogSink } from './noop-log-sink';
import { LogRecord } from './log-sink';

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

describe('InMemoryLogSink', () => {
  it('按顺序保存所有 emit 的记录', () => {
    const sink = new InMemoryLogSink();
    sink.emit(makeRecord({ msg: 'a' }));
    sink.emit(makeRecord({ msg: 'b' }));
    expect(sink.records.map((r) => r.msg)).toEqual(['a', 'b']);
  });

  it('findByKind 只返回指定 kind 的记录', () => {
    const sink = new InMemoryLogSink();
    sink.emit(makeRecord({ kind: 'access' }));
    sink.emit(makeRecord({ kind: 'error' }));
    sink.emit(makeRecord({ kind: 'trace', event: 'task.created' }));
    expect(sink.findByKind('trace')).toHaveLength(1);
  });

  it('findEvents 按顺序返回 trace 事件的 event 字段', () => {
    const sink = new InMemoryLogSink();
    sink.emit(makeRecord({ kind: 'trace', event: 'task.created' }));
    sink.emit(makeRecord({ kind: 'trace', event: 'task.answered' }));
    expect(sink.findEvents()).toEqual(['task.created', 'task.answered']);
  });

  it('clear 清空记录', () => {
    const sink = new InMemoryLogSink();
    sink.emit(makeRecord());
    sink.clear();
    expect(sink.records).toHaveLength(0);
  });
});

describe('NoopLogSink', () => {
  it('emit 不抛异常也不保留任何东西', () => {
    const sink = new NoopLogSink();
    expect(() => sink.emit(makeRecord())).not.toThrow();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run:
```bash
cd /Users/lkz/202507/record-replay && pnpm --filter @record-replay/api test -- log-sink.spec.ts
```
Expected：FAIL，`Cannot find module './in-memory-log-sink'`。

- [ ] **Step 3: 写实现**

Create `apps/api/src/log/log-events.ts`:

```ts
/** 7 个关键埋点事件名，集中定义避免裸写字符串。 */
export const LogEvent = {
  TaskCreated: 'task.created',
  TaskAnswered: 'task.answered',
  TaskTtsDone: 'task.tts.done',
  TaskRenderSubmitted: 'task.render.submitted',
  TaskRenderPolled: 'task.render.polled',
  TaskVideoReady: 'task.video.ready',
  TaskFailed: 'task.failed',
} as const;

export type LogEvent = (typeof LogEvent)[keyof typeof LogEvent];
```

Create `apps/api/src/log/log-sink.ts`:

```ts
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
```

Create `apps/api/src/log/in-memory-log-sink.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { LogKind, LogRecord, LogSink } from './log-sink';

/** 测试替身：把日志留在内存里，供单测/e2e 断言。 */
@Injectable()
export class InMemoryLogSink implements LogSink {
  readonly records: LogRecord[] = [];

  emit(record: LogRecord): void {
    this.records.push(record);
  }

  clear(): void {
    this.records.length = 0;
  }

  findByKind(kind: LogKind): LogRecord[] {
    return this.records.filter((r) => r.kind === kind);
  }

  findEvents(): string[] {
    return this.records.filter((r) => r.kind === 'trace').map((r) => r.event ?? '');
  }
}
```

Create `apps/api/src/log/noop-log-sink.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { LogSink } from './log-sink';

/** LOG_KAFKA_ENABLED=false 时的兜底实现：什么都不做。 */
@Injectable()
export class NoopLogSink implements LogSink {
  emit(): void {
    // 有意为之：关闭 Kafka 时不产生任何副作用
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run:
```bash
cd /Users/lkz/202507/record-replay && pnpm --filter @record-replay/api test -- log-sink.spec.ts
```
Expected：PASS，5 tests。

- [ ] **Step 5: Commit**

```bash
cd /Users/lkz/202507/record-replay
git add apps/api/src/log/log-events.ts apps/api/src/log/log-sink.ts apps/api/src/log/in-memory-log-sink.ts apps/api/src/log/noop-log-sink.ts apps/api/src/log/log-sink.spec.ts
git commit -m "feat(logging): 新增 LogSink 抽象层与测试替身"
```

---

## Task 4: Trace 上下文（AsyncLocalStorage）

**Files:**
- Create: `apps/api/src/log/trace-context.ts`
- Test: `apps/api/src/log/trace.middleware.spec.ts`（本任务先只放 `trace-context` 用例，下个任务再补中间件用例）

- [ ] **Step 1: 写失败测试**

Create `apps/api/src/log/trace.middleware.spec.ts`:

```ts
import { getTraceId, runWithTrace } from './trace-context';

describe('trace-context', () => {
  it('不在任何上下文里时 getTraceId 返回 "-"', () => {
    expect(getTraceId()).toBe('-');
  });

  it('runWithTrace 内 getTraceId 返回传入的 traceId', () => {
    const seen = runWithTrace('T-abc', () => getTraceId());
    expect(seen).toBe('T-abc');
  });

  it('runWithTrace 结束后上下文恢复为空', () => {
    runWithTrace('T-abc', () => undefined);
    expect(getTraceId()).toBe('-');
  });

  it('嵌套 runWithTrace 时以内层为准，退出后回到外层', () => {
    const result = runWithTrace('outer', () => {
      const inner = runWithTrace('inner', () => getTraceId());
      return { inner, after: getTraceId() };
    });
    expect(result).toEqual({ inner: 'inner', after: 'outer' });
  });

  it('await 之后仍能拿到同一个 traceId', async () => {
    await runWithTrace('T-await', async () => {
      await new Promise((r) => setTimeout(r, 5));
      expect(getTraceId()).toBe('T-await');
    });
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run:
```bash
cd /Users/lkz/202507/record-replay && pnpm --filter @record-replay/api test -- trace.middleware.spec.ts
```
Expected：FAIL，`Cannot find module './trace-context'`。

- [ ] **Step 3: 写实现**

Create `apps/api/src/log/trace-context.ts`:

```ts
import { AsyncLocalStorage } from 'node:async_hooks';

export interface TraceContext {
  traceId: string;
}

/**
 * 用 AsyncLocalStorage 承载 traceId：只要在 run() 的调用链里，
 * 任意深度的同步/异步函数都能 getTraceId()，不用层层传参。
 */
export const traceStorage = new AsyncLocalStorage<TraceContext>();

export function getTraceId(): string {
  return traceStorage.getStore()?.traceId ?? '-';
}

export function runWithTrace<T>(traceId: string, fn: () => T): T {
  return traceStorage.run({ traceId }, fn);
}
```

- [ ] **Step 4: 跑测试确认通过**

Run:
```bash
cd /Users/lkz/202507/record-replay && pnpm --filter @record-replay/api test -- trace.middleware.spec.ts
```
Expected：PASS，5 tests。

- [ ] **Step 5: Commit**

```bash
cd /Users/lkz/202507/record-replay
git add apps/api/src/log/trace-context.ts apps/api/src/log/trace.middleware.spec.ts
git commit -m "feat(logging): 用 AsyncLocalStorage 承载 traceId"
```

---

## Task 5: TraceMiddleware（traceId 的来源）

**Files:**
- Create: `apps/api/src/log/trace.middleware.ts`
- Modify: `apps/api/src/log/trace.middleware.spec.ts`

- [ ] **Step 1: 追加失败测试**

在 `apps/api/src/log/trace.middleware.spec.ts` 顶部补 import，并在文件末尾追加：

```ts
import { randomUUID } from 'node:crypto';
import { TraceMiddleware } from './trace.middleware';
```

```ts
describe('TraceMiddleware', () => {
  function makeCtx(headers: Record<string, unknown> = {}) {
    const req: any = { headers };
    const res: any = { setHeader: jest.fn() };
    const next = jest.fn();
    return { req, res, next };
  }

  it('请求头没有 X-Trace-Id 时生成 UUID 并回写响应头', () => {
    const { req, res, next } = makeCtx();
    new TraceMiddleware().use(req, res, next);
    const set = res.setHeader.mock.calls[0];
    expect(set[0]).toBe('X-Trace-Id');
    expect(String(set[1])).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('请求头带了合法 X-Trace-Id 时沿用该值', () => {
    const { req, res, next } = makeCtx({ 'x-trace-id': 'T-from-client' });
    new TraceMiddleware().use(req, res, next);
    expect(res.setHeader).toHaveBeenCalledWith('X-Trace-Id', 'T-from-client');
  });

  it('请求头 X-Trace-Id 超过 64 字符时视为脏数据，重新生成', () => {
    const { req, res, next } = makeCtx({ 'x-trace-id': 'x'.repeat(65) });
    new TraceMiddleware().use(req, res, next);
    expect(res.setHeader.mock.calls[0][1]).not.toBe('x'.repeat(65));
    expect(res.setHeader.mock.calls[0][1]).toMatch(/[0-9a-f-]{36}/);
  });

  it('请求头 X-Trace-Id 为空字符串时重新生成', () => {
    const { req, res, next } = makeCtx({ 'x-trace-id': '' });
    new TraceMiddleware().use(req, res, next);
    expect(res.setHeader.mock.calls[0][1]).toMatch(/[0-9a-f-]{36}/);
  });

  it('下游 next 内 getTraceId() 与响应头一致', () => {
    const { req, res, next } = makeCtx();
    let seen = '';
    next.mockImplementation(() => {
      seen = getTraceId();
    });
    new TraceMiddleware().use(req, res, next);
    expect(seen).toBe(res.setHeader.mock.calls[0][1]);
    expect(seen).toHaveLength(36);
  });

  it('中间件执行完（请求结束后）不残留上下文', () => {
    const { req, res, next } = makeCtx();
    new TraceMiddleware().use(req, res, next);
    expect(getTraceId()).toBe('-');
  });
});
```

> `randomUUID` 在本文件里没直接用到，删掉那行 import 也可以；留着只是提示它是生成源。

- [ ] **Step 2: 跑测试确认失败**

Run:
```bash
cd /Users/lkz/202507/record-replay && pnpm --filter @record-replay/api test -- trace.middleware.spec.ts
```
Expected：FAIL，`Cannot find module './trace.middleware'`。

- [ ] **Step 3: 写实现**

Create `apps/api/src/log/trace.middleware.ts`:

```ts
import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { traceStorage } from './trace-context';

const MAX_TRACE_ID_LEN = 64;

/** 沿用合法请求头，否则生成新的；校验长度防止日志注入超长/跨行串。 */
function normalizeTraceId(raw: unknown): string {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.length >= 1 && trimmed.length <= MAX_TRACE_ID_LEN) return trimmed;
  }
  return randomUUID();
}

@Injectable()
export class TraceMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const traceId = normalizeTraceId(req.headers['x-trace-id']);
    res.setHeader('X-Trace-Id', traceId);
    traceStorage.run({ traceId }, () => next());
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run:
```bash
cd /Users/lkz/202507/record-replay && pnpm --filter @record-replay/api test -- trace.middleware.spec.ts
```
Expected：PASS，11 tests。

- [ ] **Step 5: Commit**

```bash
cd /Users/lkz/202507/record-replay
git add apps/api/src/log/trace.middleware.ts apps/api/src/log/trace.middleware.spec.ts
git commit -m "feat(logging): 新增 TraceMiddleware 生成/沿用 traceId"
```

---

## Task 6: AppLoggerService（把 Nest 日志接进 LogSink）

**Files:**
- Create: `apps/api/src/log/app-logger.service.ts`

> 这个类没有独立单测：它只是把 `ConsoleLogger` 的输出复制一份进 `LogSink`，行为由 Task 17 的 e2e 覆盖（第 1 条断言 `kind:'access'` 存在，说明 Sink 通路是活的）。这里不硬造测试。

- [ ] **Step 1: 写实现**

Create `apps/api/src/log/app-logger.service.ts`:

```ts
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
```

- [ ] **Step 2: 编译确认没类型错**

Run:
```bash
cd /Users/lkz/202507/record-replay && pnpm --filter @record-replay/api exec tsc --noEmit -p tsconfig.json
```
Expected：无输出（exit 0）。

- [ ] **Step 3: Commit**

```bash
cd /Users/lkz/202507/record-replay
git add apps/api/src/log/app-logger.service.ts
git commit -m "feat(logging): AppLoggerService 把 Nest 日志导入 LogSink"
```

---

## Task 7: AccessLogInterceptor（访问日志）

**Files:**
- Create: `apps/api/src/log/access-log.interceptor.ts`
- Test: `apps/api/src/log/access-log.interceptor.spec.ts`

- [ ] **Step 1: 写失败测试**

Create `apps/api/src/log/access-log.interceptor.spec.ts`:

```ts
import { BadRequestException } from '@nestjs/common';
import { firstValueFrom, of, throwError } from 'rxjs';
import { AccessLogInterceptor } from './access-log.interceptor';
import { InMemoryLogSink } from './in-memory-log-sink';
import { runWithTrace } from './trace-context';

function makeContext(opts: { user?: any; statusCode?: number } = {}) {
  const req: any = { method: 'POST', originalUrl: '/personas/p1/ask', user: opts.user };
  const res: any = { statusCode: opts.statusCode ?? 201 };
  return {
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
  } as any;
}

describe('AccessLogInterceptor', () => {
  it('成功请求后发出一条 access 日志，含 method/path/status/duration/traceId', async () => {
    const sink = new InMemoryLogSink();
    const interceptor = new AccessLogInterceptor(sink);

    await runWithTrace('T-1', () =>
      firstValueFrom(interceptor.intercept(makeContext(), { handle: () => of({ ok: true }) })),
    );

    const records = sink.findByKind('access');
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      level: 'info',
      traceId: 'T-1',
      method: 'POST',
      path: '/personas/p1/ask',
      status: 201,
    });
    expect(records[0].durationMs).toBeGreaterThanOrEqual(0);
    expect(records[0].msg).toBe('POST /personas/p1/ask 201 0ms');
  });

  it('handler 抛 400 时仍记一条 access，status=400，并把异常继续抛出', async () => {
    const sink = new InMemoryLogSink();
    const interceptor = new AccessLogInterceptor(sink);

    await expect(
      runWithTrace('T-2', () =>
        firstValueFrom(
          interceptor.intercept(makeContext(), { handle: () => throwError(() => new BadRequestException('参数错误')) }),
        ),
      ),
    ).rejects.toThrow('参数错误');

    expect(sink.findByKind('access')[0]).toMatchObject({ traceId: 'T-2', status: 400 });
  });

  it('非 HttpException 抛错时 status 记为 500', async () => {
    const sink = new InMemoryLogSink();
    const interceptor = new AccessLogInterceptor(sink);

    await expect(
      runWithTrace('T-3', () =>
        firstValueFrom(interceptor.intercept(makeContext(), { handle: () => throwError(() => new Error('boom')) })),
      ),
    ).rejects.toThrow('boom');

    expect(sink.findByKind('access')[0]).toMatchObject({ traceId: 'T-3', status: 500 });
  });

  it('req.user 存在时带上 userId，匿名请求则不带', async () => {
    const sink = new InMemoryLogSink();
    const interceptor = new AccessLogInterceptor(sink);

    await runWithTrace('T-4', () =>
      firstValueFrom(interceptor.intercept(makeContext({ user: { sub: 'u-9' } }), { handle: () => of(null) })),
    );
    expect(sink.findByKind('access')[0].userId).toBe('u-9');

    sink.clear();
    await runWithTrace('T-5', () =>
      firstValueFrom(interceptor.intercept(makeContext(), { handle: () => of(null) })),
    );
    expect(sink.findByKind('access')[0].userId).toBeUndefined();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run:
```bash
cd /Users/lkz/202507/record-replay && pnpm --filter @record-replay/api test -- access-log.interceptor.spec.ts
```
Expected：FAIL，`Cannot find module './access-log.interceptor'`。

- [ ] **Step 3: 写实现**

Create `apps/api/src/log/access-log.interceptor.ts`:

```ts
import { CallHandler, ExecutionContext, Inject, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, catchError, tap, throwError } from 'rxjs';
import { LOG_SINK, LogSink } from './log-sink';
import { getTraceId } from './trace-context';

/** 每个 HTTP 请求在响应结束后发一条 kind:'access' 日志。 */
@Injectable()
export class AccessLogInterceptor implements NestInterceptor {
  constructor(@Inject(LOG_SINK) private readonly sink: LogSink) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const req = http.getRequest<any>();
    const res = http.getResponse<any>();
    const startedAt = Date.now();
    const path = req.originalUrl ?? req.url;

    const emit = (status: number): void => {
      const durationMs = Date.now() - startedAt;
      this.sink.emit({
        ts: new Date().toISOString(),
        level: 'info',
        kind: 'access',
        traceId: getTraceId(),
        userId: req.user?.sub,
        method: req.method,
        path,
        status,
        durationMs,
        msg: `${req.method} ${path} ${status} ${durationMs}ms`,
      });
    };

    return next.handle().pipe(
      tap(() => emit(res.statusCode)),
      catchError((err: any) => {
        emit(typeof err?.getStatus === 'function' ? err.getStatus() : 500);
        return throwError(() => err);
      }),
    );
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run:
```bash
cd /Users/lkz/202507/record-replay && pnpm --filter @record-replay/api test -- access-log.interceptor.spec.ts
```
Expected：PASS，4 tests。

- [ ] **Step 5: Commit**

```bash
cd /Users/lkz/202507/record-replay
git add apps/api/src/log/access-log.interceptor.ts apps/api/src/log/access-log.interceptor.spec.ts
git commit -m "feat(logging): 新增访问日志拦截器"
```

---

## Task 8: AllExceptionsFilter（全局异常过滤器）

**Files:**
- Create: `apps/api/src/log/all-exceptions.filter.ts`
- Test: `apps/api/src/log/all-exceptions.filter.spec.ts`

- [ ] **Step 1: 写失败测试**

Create `apps/api/src/log/all-exceptions.filter.spec.ts`:

```ts
import { BadRequestException, HttpException, NotFoundException } from '@nestjs/common';
import { AllExceptionsFilter } from './all-exceptions.filter';
import { InMemoryLogSink } from './in-memory-log-sink';
import { runWithTrace } from './trace-context';

function makeHost() {
  const req: any = { method: 'GET', originalUrl: '/tasks/nope', user: { sub: 'u-1' } };
  const res: any = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  return { host: { switchToHttp: () => ({ getResponse: () => res, getRequest: () => req }) } as any, res };
}

describe('AllExceptionsFilter', () => {
  it('HttpException：保持原 status，返回统一 { code, message, traceId }', () => {
    const sink = new InMemoryLogSink();
    const { host, res } = makeHost();

    runWithTrace('T-404', () => new AllExceptionsFilter(sink).catch(new NotFoundException('任务不存在'), host));

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ code: 'NOT_FOUND', message: '任务不存在', traceId: 'T-404' });
  });

  it('HttpException 自带 code 时优先使用它', () => {
    const sink = new InMemoryLogSink();
    const { host, res } = makeHost();
    const ex = new HttpException({ code: 'TASK_NOT_FOUND', message: '任务不存在' }, 404);

    runWithTrace('T-code', () => new AllExceptionsFilter(sink).catch(ex, host));

    expect(res.json).toHaveBeenCalledWith({ code: 'TASK_NOT_FOUND', message: '任务不存在', traceId: 'T-code' });
  });

  it('数组 message（class-validator 风格）拼成一句', () => {
    const sink = new InMemoryLogSink();
    const { host, res } = makeHost();
    const ex = new BadRequestException({ message: ['问题不能为空', '长度超限'] });

    runWithTrace('T-arr', () => new AllExceptionsFilter(sink).catch(ex, host));

    expect((res.json.mock.calls[0][0] as any).message).toBe('问题不能为空; 长度超限');
  });

  it('未知 Error：status=500，message 用通用文案，不泄漏原始信息', () => {
    const sink = new InMemoryLogSink();
    const { host, res } = makeHost();

    runWithTrace('T-500', () => new AllExceptionsFilter(sink).catch(new Error('SQL: select * from users'), host));

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      code: 'INTERNAL_SERVER_ERROR',
      message: '服务器内部错误',
      traceId: 'T-500',
    });
  });

  it('响应体里不含 stack，但日志里含 stack', () => {
    const sink = new InMemoryLogSink();
    const { host, res } = makeHost();

    runWithTrace('T-stack', () => new AllExceptionsFilter(sink).catch(new Error('boom'), host));

    const body = res.json.mock.calls[0][0] as Record<string, unknown>;
    expect(body).not.toHaveProperty('stack');
    const logged = sink.findByKind('error');
    expect(logged).toHaveLength(1);
    expect(logged[0].stack).toContain('boom');
  });

  it('错误日志字段完整：kind/level/status/code/method/path/userId/traceId', () => {
    const sink = new InMemoryLogSink();
    const { host } = makeHost();

    runWithTrace('T-fields', () => new AllExceptionsFilter(sink).catch(new NotFoundException('任务不存在'), host));

    expect(sink.findByKind('error')[0]).toMatchObject({
      level: 'error',
      kind: 'error',
      traceId: 'T-fields',
      userId: 'u-1',
      method: 'GET',
      path: '/tasks/nope',
      status: 404,
      code: 'NOT_FOUND',
    });
  });

  it('非 Error 抛出物（字符串）也不崩，回 500', () => {
    const sink = new InMemoryLogSink();
    const { host, res } = makeHost();

    runWithTrace('T-str', () => new AllExceptionsFilter(sink).catch('炸了', host));

    expect(res.status).toHaveBeenCalledWith(500);
    expect((res.json.mock.calls[0][0] as any).message).toBe('服务器内部错误');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run:
```bash
cd /Users/lkz/202507/record-replay && pnpm --filter @record-replay/api test -- all-exceptions.filter.spec.ts
```
Expected：FAIL，`Cannot find module './all-exceptions.filter'`。

- [ ] **Step 3: 写实现**

Create `apps/api/src/log/all-exceptions.filter.ts`:

```ts
import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Inject } from '@nestjs/common';
import type { Request, Response } from 'express';
import { LOG_SINK, LogSink } from './log-sink';
import { getTraceId } from './trace-context';

const STATUS_CODE_FALLBACK: Record<number, string> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  422: 'UNPROCESSABLE_ENTITY',
  500: 'INTERNAL_SERVER_ERROR',
};

const GENERIC_MESSAGE = '服务器内部错误';

interface ErrorBody {
  code: string;
  message: string;
  traceId: string;
}

/** 全局兜底异常过滤器：客户端只拿安全结构，堆栈只进日志。 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(@Inject(LOG_SINK) private readonly sink: LogSink) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request & { user?: { sub?: string } }>();
    const res = ctx.getResponse<Response>();
    const traceId = getTraceId();

    const status = exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const { code, message } = this.resolve(exception, status);
    const path = (req as any).originalUrl ?? (req as any).url ?? '';
    const rawMessage = exception instanceof Error ? exception.message : String(exception);
    const stack = exception instanceof Error ? exception.stack : undefined;

    this.sink.emit({
      ts: new Date().toISOString(),
      level: 'error',
      kind: 'error',
      traceId,
      userId: req.user?.sub,
      method: (req as any).method,
      path,
      status,
      code,
      stack,
      msg: `${(req as any).method} ${path} ${status} ${rawMessage}`,
    });

    const body: ErrorBody = { code, message, traceId };
    res.status(status).json(body);
  }

  private resolve(exception: unknown, status: number): { code: string; message: string } {
    const fallbackCode = STATUS_CODE_FALLBACK[status] ?? 'INTERNAL_SERVER_ERROR';
    if (!(exception instanceof HttpException)) {
      return { code: fallbackCode, message: GENERIC_MESSAGE };
    }
    const payload = exception.getResponse();
    if (typeof payload === 'string') {
      return { code: fallbackCode, message: payload };
    }
    const obj = payload as Record<string, unknown>;
    const raw = obj.message;
    const message = Array.isArray(raw)
      ? raw.map((m) => String(m)).join('; ')
      : typeof raw === 'string'
        ? raw
        : fallbackCode;
    const code = typeof obj.code === 'string' ? obj.code : fallbackCode;
    return { code, message };
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run:
```bash
cd /Users/lkz/202507/record-replay && pnpm --filter @record-replay/api test -- all-exceptions.filter.spec.ts
```
Expected：PASS，7 tests。

- [ ] **Step 5: Commit**

```bash
cd /Users/lkz/202507/record-replay
git add apps/api/src/log/all-exceptions.filter.ts apps/api/src/log/all-exceptions.filter.spec.ts
git commit -m "feat(logging): 全局异常过滤器统一错误结构，堆栈只进日志"
```

---

## Task 9: TaskTracer（关键埋点）

**Files:**
- Create: `apps/api/src/log/task-tracer.ts`
- Test: `apps/api/src/log/task-tracer.spec.ts`

- [ ] **Step 1: 写失败测试**

Create `apps/api/src/log/task-tracer.spec.ts`:

```ts
import { InMemoryLogSink } from './in-memory-log-sink';
import { TaskTracer } from './task-tracer';
import { runWithTrace } from './trace-context';

describe('TaskTracer', () => {
  it('created：发出 task.created / stage=pending，携带 question 长度', () => {
    const sink = new InMemoryLogSink();
    runWithTrace('T-t', () => new TaskTracer(sink).created('task-1', 'p-1', '你好世界'));
    expect(sink.findByKind('trace')[0]).toMatchObject({
      level: 'info',
      kind: 'trace',
      traceId: 'T-t',
      event: 'task.created',
      stage: 'pending',
      taskId: 'task-1',
      personaId: 'p-1',
    });
    expect((sink.findByKind('trace')[0].meta as any).questionChars).toBe(4);
  });

  it('answered：stage=answering，带 durationMs 与 answerChars', () => {
    const sink = new InMemoryLogSink();
    runWithTrace('T-t', () => new TaskTracer(sink).answered('task-1', 'p-1', 1234, 42));
    expect(sink.findByKind('trace')[0]).toMatchObject({
      event: 'task.answered',
      stage: 'answering',
      durationMs: 1234,
    });
    expect((sink.findByKind('trace')[0].meta as any).answerChars).toBe(42);
  });

  it('ttsDone：stage=tts，带 durationMs 与 audioBytes', () => {
    const sink = new InMemoryLogSink();
    runWithTrace('T-t', () => new TaskTracer(sink).ttsDone('task-1', 'p-1', 800, 20480));
    expect(sink.findByKind('trace')[0]).toMatchObject({
      event: 'task.tts.done',
      stage: 'tts',
      durationMs: 800,
    });
    expect((sink.findByKind('trace')[0].meta as any).audioBytes).toBe(20480);
  });

  it('renderSubmitted：stage=rendering，带 remoteTaskId', () => {
    const sink = new InMemoryLogSink();
    runWithTrace('T-t', () => new TaskTracer(sink).renderSubmitted('task-1', 'p-1', 300, 'remote-9'));
    expect(sink.findByKind('trace')[0]).toMatchObject({
      event: 'task.render.submitted',
      stage: 'rendering',
      durationMs: 300,
    });
    expect((sink.findByKind('trace')[0].meta as any).remoteTaskId).toBe('remote-9');
  });

  it('renderPolled：stage=rendering，带 round 与 remoteStatus', () => {
    const sink = new InMemoryLogSink();
    runWithTrace('T-t', () => new TaskTracer(sink).renderPolled('task-1', 'p-1', 2, 'processing'));
    expect(sink.findByKind('trace')[0]).toMatchObject({
      event: 'task.render.polled',
      stage: 'rendering',
    });
    expect((sink.findByKind('trace')[0].meta as any)).toMatchObject({ round: 2, remoteStatus: 'processing' });
  });

  it('videoReady：stage=done，带 totalDurationMs', () => {
    const sink = new InMemoryLogSink();
    runWithTrace('T-t', () => new TaskTracer(sink).videoReady('task-1', 'p-1', 45000));
    expect(sink.findByKind('trace')[0]).toMatchObject({
      event: 'task.video.ready',
      stage: 'done',
      totalDurationMs: 45000,
    });
  });

  it('failed：level=error，带失败阶段、总耗时与堆栈', () => {
    const sink = new InMemoryLogSink();
    runWithTrace('T-t', () =>
      new TaskTracer(sink).failed('task-1', 'p-1', 'tts', 'TTS 调用失败', 5000, 'Error: TTS 调用失败\n  at x'),
    );
    const record = sink.findByKind('trace')[0];
    expect(record).toMatchObject({
      level: 'error',
      event: 'task.failed',
      stage: 'tts',
      totalDurationMs: 5000,
      taskId: 'task-1',
    });
    expect(record.stack).toContain('TTS 调用失败');
  });

  it('traceId 取自 AsyncLocalStorage，无需入参', () => {
    const sink = new InMemoryLogSink();
    runWithTrace('T-from-als', () => new TaskTracer(sink).videoReady('task-1', 'p-1', 1));
    expect(sink.findByKind('trace')[0].traceId).toBe('T-from-als');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run:
```bash
cd /Users/lkz/202507/record-replay && pnpm --filter @record-replay/api test -- task-tracer.spec.ts
```
Expected：FAIL，`Cannot find module './task-tracer'`。

- [ ] **Step 3: 写实现**

Create `apps/api/src/log/task-tracer.ts`:

```ts
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
```

- [ ] **Step 4: 跑测试确认通过**

Run:
```bash
cd /Users/lkz/202507/record-replay && pnpm --filter @record-replay/api test -- task-tracer.spec.ts
```
Expected：PASS，8 tests。

- [ ] **Step 5: Commit**

```bash
cd /Users/lkz/202507/record-replay
git add apps/api/src/log/task-tracer.ts apps/api/src/log/task-tracer.spec.ts
git commit -m "feat(logging): 新增 TaskTracer 覆盖提问到出片 7 个埋点"
```

---

## Task 10: KafkaLogSink（唯一碰 kafkajs 的地方）

**Files:**
- Create: `apps/api/src/log/kafka-log-sink.ts`
- Test: `apps/api/src/log/kafka-log-sink.spec.ts`

- [ ] **Step 1: 写失败测试**

Create `apps/api/src/log/kafka-log-sink.spec.ts`:

```ts
import { KafkaLogSink, KafkaLogSinkOptions, ProducerLike, TOPIC_BY_KIND } from './kafka-log-sink';
import { LogRecord } from './log-sink';

function makeOptions(overrides: Partial<KafkaLogSinkOptions> = {}): KafkaLogSinkOptions {
  return {
    brokers: ['127.0.0.1:9093'],
    clientId: 'test',
    flushIntervalMs: 60_000, // 默认关掉定时器，避免测试期间被动 flush
    batchMax: 200,
    queueMax: 1000,
    ...overrides,
  };
}

function makeProducer(): ProducerLike & { sent: any[]; connect: jest.Mock } {
  const sent: any[] = [];
  return {
    sent,
    connect: jest.fn().mockResolvedValue(undefined),
    disconnect: jest.fn().mockResolvedValue(undefined),
    send: jest.fn(async (args: any) => {
      sent.push(args);
    }) as any,
  } as any;
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

describe('KafkaLogSink', () => {
  it('emit 只入队，不同步发送', async () => {
    const producer = makeProducer();
    const sink = new KafkaLogSink(makeOptions(), producer);
    sink.emit(makeRecord());
    await new Promise((r) => setTimeout(r, 20));
    expect(producer.send).not.toHaveBeenCalled();
    await sink.onApplicationShutdown();
  });

  it('到 flush 间隔后自动批量发送', async () => {
    const producer = makeProducer();
    const sink = new KafkaLogSink(makeOptions({ flushIntervalMs: 10 }), producer);
    sink.emit(makeRecord());
    await new Promise((r) => setTimeout(r, 60));
    expect(producer.send).toHaveBeenCalledTimes(1);
    expect(producer.sent[0].messages).toHaveLength(1);
    await sink.onApplicationShutdown();
  });

  it('队列达到 batchMax 时立即 flush', async () => {
    const producer = makeProducer();
    const sink = new KafkaLogSink(makeOptions({ batchMax: 3 }), producer);
    sink.emit(makeRecord({ msg: 'a' }));
    sink.emit(makeRecord({ msg: 'b' }));
    expect(producer.send).not.toHaveBeenCalled();
    sink.emit(makeRecord({ msg: 'c' }));
    await new Promise((r) => setTimeout(r, 20));
    expect(producer.send).toHaveBeenCalledTimes(1);
    expect(producer.sent[0].messages).toHaveLength(3);
    await sink.onApplicationShutdown();
  });

  it('kind 决定 topic 路由', async () => {
    const producer = makeProducer();
    const sink = new KafkaLogSink(makeOptions({ batchMax: 3 }), producer);
    sink.emit(makeRecord({ kind: 'access' }));
    sink.emit(makeRecord({ kind: 'error' }));
    sink.emit(makeRecord({ kind: 'trace' }));
    await new Promise((r) => setTimeout(r, 20));
    expect(producer.sent.map((a) => a.topic).sort()).toEqual(
      [TOPIC_BY_KIND.access, TOPIC_BY_KIND.error, TOPIC_BY_KIND.trace].sort(),
    );
    await sink.onApplicationShutdown();
  });

  it('traceId 作为 message key，value 是 JSON 字符串', async () => {
    const producer = makeProducer();
    const sink = new KafkaLogSink(makeOptions({ batchMax: 1 }), producer);
    sink.emit(makeRecord({ traceId: 'T-key', msg: 'kv' }));
    await new Promise((r) => setTimeout(r, 20));
    const message = producer.sent[0].messages[0];
    expect(message.key).toBe('T-key');
    expect(JSON.parse(message.value)).toMatchObject({ traceId: 'T-key', msg: 'kv' });
    await sink.onApplicationShutdown();
  });

  it('发送时 acks = -1', async () => {
    const producer = makeProducer();
    const sink = new KafkaLogSink(makeOptions({ batchMax: 1 }), producer);
    sink.emit(makeRecord());
    await new Promise((r) => setTimeout(r, 20));
    expect(producer.sent[0].acks).toBe(-1);
    await sink.onApplicationShutdown();
  });

  it('超过 queueMax 丢最旧的记录，且不抛异常', () => {
    const producer = makeProducer();
    const sink = new KafkaLogSink(makeOptions({ queueMax: 3 }), producer);
    expect(() => {
      for (let i = 0; i < 10; i++) sink.emit(makeRecord({ msg: `m${i}` }));
    }).not.toThrow();
    expect(sink.queueSize()).toBe(3);
  });

  it('send 抛错时不影响 emit，也不让 flush 冒泡异常', async () => {
    const producer = makeProducer();
    (producer.send as jest.Mock).mockRejectedValue(new Error('broker 挂了'));
    const sink = new KafkaLogSink(makeOptions({ batchMax: 1 }), producer);
    sink.emit(makeRecord());
    await expect(sink.flush()).resolves.toBeUndefined();
    expect(() => sink.emit(makeRecord())).not.toThrow();
    await sink.onApplicationShutdown();
  });

  it('onApplicationShutdown 清掉定时器并 flush 残留', async () => {
    const producer = makeProducer();
    const sink = new KafkaLogSink(makeOptions(), producer);
    sink.emit(makeRecord({ msg: 'leftover' }));
    await sink.onApplicationShutdown();
    expect(producer.sent[0].messages[0].value).toContain('leftover');
    expect(producer.disconnect).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run:
```bash
cd /Users/lkz/202507/record-replay && pnpm --filter @record-replay/api test -- kafka-log-sink.spec.ts
```
Expected：FAIL，`Cannot find module './kafka-log-sink'`。

- [ ] **Step 3: 写实现**

Create `apps/api/src/log/kafka-log-sink.ts`:

```ts
import { Injectable, OnApplicationShutdown } from '@nestjs/common';
import { Kafka } from 'kafkajs';
import { LogKind, LogRecord, LogSink } from './log-sink';

export const TOPIC_BY_KIND: Record<LogKind, string> = {
  access: 'rr.api.access',
  error: 'rr.api.error',
  trace: 'rr.task.trace',
  app: 'rr.api.access',
};

export interface KafkaLogSinkOptions {
  brokers: string[];
  clientId: string;
  flushIntervalMs: number;
  batchMax: number;
  queueMax: number;
}

/** 抽象出 producer 便于单测注入替身，也让 kafkajs 只出现在本文件。 */
export interface ProducerLike {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  send(args: { topic: string; acks?: number; messages: Array<{ key?: string; value: string }> }): Promise<void>;
}

function createKafkaProducer(options: KafkaLogSinkOptions): ProducerLike {
  const kafka = new Kafka({ clientId: options.clientId, brokers: options.brokers });
  const producer = kafka.producer({ idempotent: true, maxInFlightRequests: 1 });
  return {
    connect: () => producer.connect(),
    disconnect: () => producer.disconnect(),
    send: (args) => producer.send(args as never),
  };
}

/**
 * 唯一接触 Kafka 的 LogSink 实现。
 * emit() 只入队（同步非阻塞），真正的发送在定时器里批量做；Kafka 抖动不影响业务。
 */
@Injectable()
export class KafkaLogSink implements LogSink, OnApplicationShutdown {
  private readonly queue: LogRecord[] = [];
  private readonly producer: ProducerLike;
  private readonly timer: NodeJS.Timeout;
  private sending = false;
  private connected = false;

  constructor(
    private readonly options: KafkaLogSinkOptions,
    producer?: ProducerLike,
  ) {
    this.producer = producer ?? createKafkaProducer(options);
    this.timer = setInterval(() => {
      void this.flush().catch(() => undefined);
    }, options.flushIntervalMs);
    this.timer.unref?.();
  }

  emit(record: LogRecord): void {
    this.queue.push(record);
    while (this.queue.length > this.options.queueMax) {
      this.queue.shift();
      process.stderr.write('[KafkaLogSink] 队列溢出，已丢弃最旧的日志\n');
    }
    if (this.queue.length >= this.options.batchMax) {
      void this.flush().catch(() => undefined);
    }
  }

  queueSize(): number {
    return this.queue.length;
  }

  async flush(): Promise<void> {
    if (this.sending || this.queue.length === 0) return;
    this.sending = true;
    try {
      await this.ensureConnected();
      while (this.queue.length > 0) {
        const batch = this.queue.splice(0, this.options.batchMax);
        const grouped = new Map<string, LogRecord[]>();
        for (const record of batch) {
          const topic = TOPIC_BY_KIND[record.kind];
          const list = grouped.get(topic);
          if (list) list.push(record);
          else grouped.set(topic, [record]);
        }
        for (const [topic, records] of grouped) {
          await this.producer.send({
            topic,
            acks: -1,
            messages: records.map((r) => ({ key: r.traceId, value: JSON.stringify(r) })),
          });
        }
      }
    } catch (err: any) {
      // 有意为之：日志可以丢，业务不能停。只告警不重试不阻塞。
      process.stderr.write(`[KafkaLogSink] 发送失败，丢弃本批日志: ${err?.message ?? err}\n`);
    } finally {
      this.sending = false;
    }
  }

  async onApplicationShutdown(): Promise<void> {
    clearInterval(this.timer);
    await this.flush();
    try {
      await this.producer.disconnect();
    } catch {
      // 退出阶段忽略断开异常
    }
  }

  private async ensureConnected(): Promise<void> {
    if (this.connected) return;
    await this.producer.connect();
    this.connected = true;
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run:
```bash
cd /Users/lkz/202507/record-replay && pnpm --filter @record-replay/api test -- kafka-log-sink.spec.ts
```
Expected：PASS，9 tests。

- [ ] **Step 5: Commit**

```bash
cd /Users/lkz/202507/record-replay
git add apps/api/src/log/kafka-log-sink.ts apps/api/src/log/kafka-log-sink.spec.ts
git commit -m "feat(logging): KafkaLogSink 内存队列 + 批量发送 + 失败降级"
```

---

## Task 11: LogModule + 全局注册（把一切接起来）

**Files:**
- Create: `apps/api/src/log/log.module.ts`
- Modify: `apps/api/src/app.module.ts`
- Modify: `apps/api/src/main.ts`

- [ ] **Step 1: 写 `log.module.ts`**

Create `apps/api/src/log/log.module.ts`:

```ts
import { Global, Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AccessLogInterceptor } from './access-log.interceptor';
import { AllExceptionsFilter } from './all-exceptions.filter';
import { AppLoggerService } from './app-logger.service';
import { KafkaLogSink } from './kafka-log-sink';
import { LOG_SINK, LogSink } from './log-sink';
import { NoopLogSink } from './noop-log-sink';
import { TaskTracer } from './task-tracer';
import { TraceMiddleware } from './trace.middleware';

/** 日志基础设施：一次性把 Sink 与三个消费者（拦截器/过滤器/埋点）注册成全局 Provider。 */
@Global()
@Module({
  providers: [
    {
      provide: LOG_SINK,
      inject: [ConfigService],
      useFactory: (cfg: ConfigService): LogSink => {
        if (!cfg.get<boolean>('log.kafkaEnabled')) {
          Logger.warn('LOG_KAFKA_ENABLED=false，日志不发送到 Kafka', 'LogModule');
          return new NoopLogSink();
        }
        return new KafkaLogSink({
          brokers: cfg.get<string>('log.kafkaBrokers')!.split(','),
          clientId: cfg.get<string>('log.kafkaClientId')!,
          flushIntervalMs: cfg.get<number>('log.flushIntervalMs')!,
          batchMax: cfg.get<number>('log.batchMax')!,
          queueMax: cfg.get<number>('log.queueMax')!,
        });
      },
    },
    TraceMiddleware,
    AccessLogInterceptor,
    AllExceptionsFilter,
    TaskTracer,
    AppLoggerService,
  ],
  exports: [LOG_SINK, TraceMiddleware, AccessLogInterceptor, AllExceptionsFilter, TaskTracer, AppLoggerService],
})
export class LogModule {}
```

- [ ] **Step 2: `app.module.ts` 引入 LogModule 并全局注册拦截器/过滤器**

修改 `apps/api/src/app.module.ts`：

顶部 import 增加：

```ts
import { Module } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { AccessLogInterceptor } from './log/access-log.interceptor';
import { AllExceptionsFilter } from './log/all-exceptions.filter';
import { LogModule } from './log/log.module';
```

`imports` 数组最后加 `LogModule,`：

```ts
    TaskModule,
    LogModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_INTERCEPTOR, useExisting: AccessLogInterceptor },
    { provide: APP_FILTER, useExisting: AllExceptionsFilter },
  ],
})
export class AppModule {}
```

- [ ] **Step 3: `main.ts` 接 AppLoggerService 与 TraceMiddleware**

修改 `apps/api/src/main.ts`：

```ts
import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { DEFAULT_JWT_SECRET } from './config/configuration';
import { AppLoggerService } from './log/app-logger.service';
import { TraceMiddleware } from './log/trace.middleware';
import { PUBLIC_URL_PREFIX, STORAGE_ROOT } from './media/storage.config';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  const config = app.get(ConfigService);

  app.useLogger(app.get(AppLoggerService));

  if (process.env.NODE_ENV === 'production' && config.get<string>('jwtSecret') === DEFAULT_JWT_SECRET) {
    throw new Error('JWT_SECRET must be set to a strong value in production');
  }

  const traceMiddleware = app.get(TraceMiddleware);
  app.use(traceMiddleware.use.bind(traceMiddleware));

  app.useStaticAssets(STORAGE_ROOT, { prefix: PUBLIC_URL_PREFIX });

  app.enableCors({ origin: true, credentials: true });

  const port = config.get<number>('port') ?? 3000;
  await app.listen(port, '0.0.0.0');
  Logger.log(`api listening on ${port}`, 'Bootstrap');
}

bootstrap().catch((error) => {
  Logger.error(error, 'Bootstrap');
  process.exit(1);
});
```

> `app.use()` 必须传函数，`NestMiddleware` 实例要 `.use.bind(...)`；这也是 e2e 里要照做的一步。

- [ ] **Step 4: 编译 + 起服务手验**

Run:
```bash
cd /Users/lkz/202507/record-replay && pnpm --filter @record-replay/api exec tsc --noEmit -p tsconfig.json
```
Expected：exit 0。

Run（另开终端保持常驻）：
```bash
cd /Users/lkz/202507/record-replay && pnpm --filter @record-replay/api start:dev
```

Run:
```bash
curl -sD - -o /dev/null http://127.0.0.1:3000/health | grep -i x-trace-id
curl -s -H 'X-Trace-Id: my-custom-trace' -D - -o /dev/null http://127.0.0.1:3000/health | grep -i x-trace-id
```
Expected：第一行返回一个 UUID；第二行返回 `my-custom-trace`。

Run（验证错误结构）：
```bash
curl -s http://127.0.0.1:3000/tasks/00000000-0000-0000-0000-000000000000
```
Expected：`{"code":"UNAUTHORIZED","message":"缺少令牌","traceId":"..."}`（`JwtGuard` 先拦下）。

- [ ] **Step 5: 全量回归**

Run:
```bash
cd /Users/lkz/202507/record-replay && pnpm --filter @record-replay/api test -- --runInBand
```
Expected：13 suites / 67 tests + 新增单测（5+11+4+7+8+9=44）全绿，无失败。

- [ ] **Step 6: Commit**

```bash
cd /Users/lkz/202507/record-replay
git add apps/api/src/log/log.module.ts apps/api/src/app.module.ts apps/api/src/main.ts
git commit -m "feat(logging): LogModule 全局注册 Sink/拦截器/过滤器并接入 main"
```

---

## Task 12: render_tasks 增加 trace_id

**Files:**
- Modify: `apps/api/src/task/entities/render-task.entity.ts`

- [ ] **Step 1: 加列**

在 `answeredText` 之前（`question` 之后）插入：

```ts
  /** 创建任务那次 HTTP 请求的 traceId：让后台异步链路能续上 ALS，也方便用 taskId 反查全链路。 */
  @Column({ type: 'varchar', length: 64, nullable: true })
  traceId: string | null;
```

- [ ] **Step 2: 验证表结构已加列**

Run:
```bash
cd /Users/lkz/202507/record-replay && pnpm --filter @record-replay/api test -- --runInBand
```
Expected：全绿（`synchronize: true` 会在测试库自动加列）。

- [ ] **Step 3: Commit**

```bash
cd /Users/lkz/202507/record-replay
git add apps/api/src/task/entities/render-task.entity.ts
git commit -m "feat(logging): render_tasks 增加 trace_id 列"
```

---

## Task 13: TaskService 埋点（7 个事件 + 异步链路续接）

**Files:**
- Modify: `apps/api/src/task/task.service.ts`

- [ ] **Step 1: 注入 TaskTracer 并在 create() 落 traceId**

修改 `apps/api/src/task/task.service.ts`：

import 增加：

```ts
import { TaskTracer } from '../log/task-tracer';
import { getTraceId, runWithTrace } from '../log/trace-context';
```

构造函数参数增加最后一项：

```ts
    @Inject(RENDER_PROVIDER) private readonly render: RenderProvider,
    private readonly tracer: TaskTracer,
  ) {}
```

`create()` 改为：

```ts
  async create(persona: Persona, question: string): Promise<RenderTask> {
    const traceId = getTraceId();
    const task = await this.tasks.save(
      this.tasks.create({ personaId: persona.id, question, status: 'pending', traceId }),
    );
    this.tracer.created(task.id, persona.id, question);
    void this.process(task.id, persona).catch((err) => {
      this.logger.error(`任务 ${task.id} 失败: ${err.message}`);
    });
    return task;
  }
```

> `this.tracer.created(...)` 放在 `create()` 里（此时 ALS 里还带着本次 HTTP 的 traceId），
> `process()` 是 detached 的异步链路，那里再 `runWithTrace` 续上。

- [ ] **Step 2: 重写 `process()`，续接 traceId 并埋点**

把 `process()` 整体替换为：

```ts
  private async process(taskId: string, persona: Persona): Promise<void> {
    const task = await this.tasks.findOne({ where: { id: taskId } });
    if (!task) return;

    const startedAt = Date.now();
    const stage = { current: 'answering' as string };

    await runWithTrace(task.traceId ?? '-', async () => {
      try {
        // 1) 生成回答文本
        await this.tasks.update(taskId, { status: 'answering' });
        const answerStarted = Date.now();
        const answerText = await this.chat.answer(
          { avatarUrl: persona.avatarUrl, voiceSampleUrl: persona.voiceSampleUrl },
          task.question,
        );
        await this.tasks.update(taskId, { answerText });
        this.tracer.answered(taskId, persona.id, Date.now() - answerStarted, answerText.length);

        // 2) 用克隆音色合成语音
        stage.current = 'tts';
        await this.tasks.update(taskId, { status: 'tts' });
        if (!persona.speakerId) throw new Error('人格音色尚未就绪');
        const ttsStarted = Date.now();
        const { audio, durationMs } = await this.voice.synthesize(answerText, persona.speakerId);
        const audioUrl = await this.saveFile('audio', `${randomUUID()}.mp3`, audio);
        await this.tasks.update(taskId, { audioUrl });
        this.tracer.ttsDone(taskId, persona.id, Date.now() - ttsStarted, audio.byteLength);

        // 3) 提交口型视频任务（火山 OmniHuman 自动跟随音频；MiniMax 需显式指定时长）
        stage.current = 'rendering';
        await this.tasks.update(taskId, { status: 'rendering' });
        const submitStarted = Date.now();
        const remoteTaskId = await this.render.submit(
          persona.avatarUrl,
          audioUrl,
          Math.ceil(durationMs / 1000) || undefined,
        );
        this.tracer.renderSubmitted(taskId, persona.id, Date.now() - submitStarted, remoteTaskId);

        // 4) 轮询并转存（远端 video_url 仅 1 小时有效）
        stage.current = 'persisting';
        const videoUrl = await this.pollAndPersist(taskId, persona.id, remoteTaskId);
        await this.tasks.update(taskId, { status: 'done', videoUrl, finishedAt: new Date() });
        this.tracer.videoReady(taskId, persona.id, Date.now() - startedAt);
      } catch (err: any) {
        await this.tasks.update(taskId, {
          status: 'failed',
          error: String(err?.message ?? err),
          finishedAt: new Date(),
        });
        this.tracer.failed(
          taskId,
          persona.id,
          stage.current,
          String(err?.message ?? err),
          Date.now() - startedAt,
          err?.stack,
        );
        throw err;
      }
    });
  }
```

- [ ] **Step 3: `pollAndPersist()` 每次轮询埋点**

把 `pollAndPersist` 签名改为接收 `personaId`，并在每轮循环开头埋点：

```ts
  private async pollAndPersist(taskId: string, personaId: string, remoteTaskId: string): Promise<string> {
    for (let i = 0; i < RENDER_MAX_ROUNDS; i++) {
      const result = await this.render.query(remoteTaskId);
      this.tracer.renderPolled(taskId, personaId, i + 1, result.status);
      if (result.status === 'failed') throw new Error('视频生成失败');
      if (result.status === 'done' && result.videoUrl) {
        const res = await fetch(result.videoUrl);
        if (!res.ok) throw new Error(`下载视频失败: ${res.status}`);
        const buf = Buffer.from(await res.arrayBuffer());
        await this.tasks.update(taskId, { remoteVideoUrl: result.videoUrl });
        return this.saveFile('videos', `${randomUUID()}.mp4`, buf);
      }
      await new Promise((r) => setTimeout(r, RENDER_POLL_INTERVAL_MS));
    }
    throw new Error('视频生成超时');
  }
```

- [ ] **Step 4: 编译 + 回归**

Run:
```bash
cd /Users/lkz/202507/record-replay && pnpm --filter @record-replay/api exec tsc --noEmit -p tsconfig.json && pnpm --filter @record-replay/api test -- --runInBand
```
Expected：编译 exit 0；测试全绿。

- [ ] **Step 5: Commit**

```bash
cd /Users/lkz/202507/record-replay
git add apps/api/src/task/task.service.ts
git commit -m "feat(logging): TaskService 插入 7 个关键埋点并续接异步链路 traceId"
```

---

## Task 14: ClickHouse DDL

**Files:**
- Create: `apps/api/src/log/consumer/clickhouse-schema.ts`
- Test: `apps/api/src/log/consumer/clickhouse-schema.spec.ts`

- [ ] **Step 1: 写失败测试**

Create `apps/api/src/log/consumer/clickhouse-schema.spec.ts`:

```ts
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
```

- [ ] **Step 2: 跑测试确认失败**

Run:
```bash
cd /Users/lkz/202507/record-replay && pnpm --filter @record-replay/api test -- clickhouse-schema.spec.ts
```
Expected：FAIL，`Cannot find module './clickhouse-schema'`。

- [ ] **Step 3: 写实现**

Create `apps/api/src/log/consumer/clickhouse-schema.ts`:

```ts
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
```

- [ ] **Step 4: 跑测试确认通过**

Run:
```bash
cd /Users/lkz/202507/record-replay && pnpm --filter @record-replay/api test -- clickhouse-schema.spec.ts
```
Expected：PASS，4 tests。

- [ ] **Step 5: 手动建表（验证 DDL 真能跑）**

Run:
```bash
docker exec record-replay-clickhouse clickhouse-client --query "CREATE DATABASE IF NOT EXISTS record_replay"
docker exec -i record-replay-clickhouse clickhouse-client --multiquery <<'SQL'
CREATE TABLE IF NOT EXISTS record_replay.rr_logs
(
    ts DateTime64(3, 'UTC'), level LowCardinality(String), kind LowCardinality(String),
    trace_id String, msg String, user_id String DEFAULT '', persona_id String DEFAULT '',
    task_id String DEFAULT '', method LowCardinality(String) DEFAULT '', path String DEFAULT '',
    status UInt16 DEFAULT 0, duration_ms UInt32 DEFAULT 0, code LowCardinality(String) DEFAULT '',
    stack String DEFAULT '', event LowCardinality(String) DEFAULT '', stage LowCardinality(String) DEFAULT '',
    total_duration_ms UInt32 DEFAULT 0, meta String DEFAULT '',
    INDEX idx_trace_id trace_id TYPE bloom_filter GRANULARITY 1
)
ENGINE = MergeTree PARTITION BY toYYYYMMDD(ts) ORDER BY (kind, ts)
TTL toDateTime(ts) + INTERVAL 30 DAY SETTINGS index_granularity = 8192;
SQL
docker exec record-replay-clickhouse clickhouse-client --query "SHOW CREATE TABLE record_replay.rr_logs FORMAT TSVRaw"
```
Expected：最后一条输出建表语句，无报错。

- [ ] **Step 6: Commit**

```bash
cd /Users/lkz/202507/record-replay
git add apps/api/src/log/consumer/clickhouse-schema.ts apps/api/src/log/consumer/clickhouse-schema.spec.ts
git commit -m "feat(logging): ClickHouse 建库建表 DDL（幂等）"
```

---

## Task 15: ClickHouseWriter（攒批 + 重试）

**Files:**
- Create: `apps/api/src/log/consumer/clickhouse-writer.ts`
- Test: `apps/api/src/log/consumer/clickhouse-writer.spec.ts`

- [ ] **Step 1: 写失败测试**

Create `apps/api/src/log/consumer/clickhouse-writer.spec.ts`:

```ts
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
    await writer.close();
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
```

- [ ] **Step 2: 跑测试确认失败**

Run:
```bash
cd /Users/lkz/202507/record-replay && pnpm --filter @record-replay/api test -- clickhouse-writer.spec.ts
```
Expected：FAIL，`Cannot find module './clickhouse-writer'`。

- [ ] **Step 3: 写实现**

Create `apps/api/src/log/consumer/clickhouse-writer.ts`:

```ts
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
    await this.flush();
    await this.client.close();
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
```

- [ ] **Step 4: 跑测试确认通过**

Run:
```bash
cd /Users/lkz/202507/record-replay && pnpm --filter @record-replay/api test -- clickhouse-writer.spec.ts
```
Expected：PASS，9 tests。

- [ ] **Step 5: Commit**

```bash
cd /Users/lkz/202507/record-replay
git add apps/api/src/log/consumer/clickhouse-writer.ts apps/api/src/log/consumer/clickhouse-writer.spec.ts
git commit -m "feat(logging): ClickHouseWriter 攒批写入 + 失败重试"
```

---

## Task 16: log-consumer 进程入口

**Files:**
- Create: `apps/api/src/log/consumer/main.ts`

- [ ] **Step 1: 写实现**

Create `apps/api/src/log/consumer/main.ts`:

```ts
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
      { topic: 'rr.api.access', numPartitions: 3, replicationFactor: 1, configEntries: [{ name: 'retention.ms', value: '259200000' }] },
      { topic: 'rr.api.error', numPartitions: 3, replicationFactor: 1, configEntries: [{ name: 'retention.ms', value: '2592000000' }] },
      { topic: 'rr.task.trace', numPartitions: 3, replicationFactor: 1, configEntries: [{ name: 'retention.ms', value: '2592000000' }] },
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
```

- [ ] **Step 2: 端到端验证：Kafka → ClickHouse**

确保 Kafka / ClickHouse 容器在跑，然后：

Run（常驻，另开终端）：
```bash
cd /Users/lkz/202507/record-replay && pnpm --filter @record-replay/api log:consumer
```
Expected：stderr 输出 `[log-consumer] 已启动，订阅 rr.api.access, rr.api.error, rr.task.trace，消费组 rr-log-archiver`，无报错。

Run（造一条日志进 Kafka）：
```bash
docker exec -i record-replay-kafka /opt/bitnami/kafka/bin/kafka-console-producer.sh \
  --bootstrap-server 127.0.0.1:29092 --topic rr.api.access <<'EOF'
{"ts":"2026-11-17T10:00:00.000Z","level":"info","kind":"access","traceId":"manual-check","msg":"probe","method":"GET","path":"/health","status":200,"durationMs":1}
EOF
```

Run（等约 2 秒后查 ClickHouse）：
```bash
sleep 3
docker exec record-replay-clickhouse clickhouse-client --query \
  "SELECT trace_id, kind, msg, status FROM record_replay.rr_logs WHERE trace_id = 'manual-check' FORMAT TSVRaw"
```
Expected：输出 `manual-check	access	probe	200`。

- [ ] **Step 3: Commit**

```bash
cd /Users/lkz/202507/record-replay
git add apps/api/src/log/consumer/main.ts
git commit -m "feat(logging): log-consumer 进程从 Kafka 消费并落入 ClickHouse"
```

---

## Task 17: logging e2e-spec

**Files:**
- Create: `apps/api/test/logging.e2e-spec.ts`

- [ ] **Step 1: 写测试**

Create `apps/api/test/logging.e2e-spec.ts`:

```ts
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module';
import { SMS_CLIENT } from '../src/auth/sms.service';
import { InMemoryLogSink } from '../src/log/in-memory-log-sink';
import { LOG_SINK } from '../src/log/log-sink';
import { TraceMiddleware } from '../src/log/trace.middleware';
import { CHAT_PROVIDER } from '../src/providers/chat/chat.provider';
import { VOICE_PROVIDER } from '../src/providers/voice/voice.provider';
import { RENDER_PROVIDER } from '../src/providers/render/render.provider';

const PHONE = '15920328009';
const VOICE_SAMPLE = `data:audio/mp3;base64,${Buffer.from('audio').toString('base64')}`;
const REMOTE_VIDEO = `data:video/mp4;base64,${Buffer.from('fake-video').toString('base64')}`;

describe('日志系统 (e2e)', () => {
  let app: INestApplication;
  let http: any;
  let sink: InMemoryLogSink;
  let token: string;
  let personaId: string;

  beforeAll(async () => {
    sink = new InMemoryLogSink();

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(LOG_SINK)
      .useValue(sink)
      .overrideProvider(SMS_CLIENT)
      .useValue({
        sendSmsVerifyCodeWithOptions: jest.fn().mockResolvedValue({ body: { code: 'OK' } }),
        checkSmsVerifyCodeWithOptions: jest
          .fn()
          .mockResolvedValue({ body: { code: 'OK', model: { verifyResult: 'PASS' } } }),
      })
      .overrideProvider(CHAT_PROVIDER)
      .useValue({ answer: jest.fn().mockResolvedValue('我爱你一万年') })
      .overrideProvider(VOICE_PROVIDER)
      .useValue({
        train: jest.fn().mockResolvedValue({ speakerId: 'p-1' }),
        queryTrainStatus: jest.fn().mockResolvedValue('ready'),
        synthesize: jest.fn().mockResolvedValue({ audio: Buffer.from('audio'), durationMs: 4200 }),
      })
      .overrideProvider(RENDER_PROVIDER)
      .useValue({
        submit: jest.fn().mockResolvedValue('task-1'),
        query: jest.fn().mockResolvedValue({ status: 'done', videoUrl: REMOTE_VIDEO }),
      })
      .compile();

    app = moduleRef.createNestApplication();
    // main.ts 里 TraceMiddleware 是手动挂的，e2e 不跑 main.ts，必须照做一次
    const traceMiddleware = app.get(TraceMiddleware);
    app.use(traceMiddleware.use.bind(traceMiddleware));
    await app.init();
    http = app.getHttpServer();

    const login = await request(http).post('/auth/sms/login').send({ phone: PHONE, code: '123456' });
    token = login.body.token;

    const persona = await request(http)
      .post('/personas')
      .set('Authorization', `Bearer ${token}`)
      .send({ avatarUrl: 'http://x/a.jpg', voiceSampleUrl: VOICE_SAMPLE });
    personaId = persona.body.id;

    for (let i = 0; i < 30; i++) {
      const res = await request(http).get(`/personas/${personaId}`).set('Authorization', `Bearer ${token}`);
      if (res.body.status === 'ready') break;
      await new Promise((r) => setTimeout(r, 100));
    }
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => sink.clear());

  it('任意请求都回写 X-Trace-Id，并产生一条 access 日志', async () => {
    const res = await request(http).get('/health').expect(200);
    const traceId = res.headers['x-trace-id'];
    expect(traceId).toBeTruthy();

    const access = sink.findByKind('access');
    expect(access.length).toBeGreaterThanOrEqual(1);
    expect(access[0]).toMatchObject({ traceId, method: 'GET', path: '/health', status: 200 });
  });

  it('沿用客户端传入的 X-Trace-Id', async () => {
    const res = await request(http).get('/health').set('X-Trace-Id', 'client-trace-1').expect(200);
    expect(res.headers['x-trace-id']).toBe('client-trace-1');
    expect(sink.findByKind('access')[0].traceId).toBe('client-trace-1');
  });

  it('handler 抛 404：统一错误结构 + error 日志带堆栈 + 响应体无堆栈', async () => {
    const res = await request(http)
      .get(`/tasks/${randomUUID()}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(404);

    expect(Object.keys(res.body).sort()).toEqual(['code', 'message', 'traceId']);
    expect(res.body.traceId).toBe(res.headers['x-trace-id']);
    expect(res.body).not.toHaveProperty('stack');

    const errors = sink.findByKind('error');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ traceId: res.headers['x-trace-id'], status: 404, code: 'NOT_FOUND' });
    expect(typeof errors[0].stack).toBe('string');

    // 一次失败 = 1 条 access + 1 条 error
    expect(sink.findByKind('access').some((r) => r.status === 404)).toBe(true);
  });

  it('guard 抛 401：同样返回统一错误结构（guards 早于拦截器，故没有 access 记录）', async () => {
    const res = await request(http).get(`/tasks/${randomUUID()}`).expect(401);

    expect(Object.keys(res.body).sort()).toEqual(['code', 'message', 'traceId']);
    expect(res.body).not.toHaveProperty('stack');
    expect(sink.findByKind('error')).toHaveLength(1);
  });

  it('POST /personas/:id/ask：traceId 落库，且关键埋点共享同一 traceId', async () => {
    const ask = await request(http)
      .post(`/personas/${personaId}/ask`)
      .set('Authorization', `Bearer ${token}`)
      .send({ question: '你爱我吗' })
      .expect(201);

    const askTraceId = ask.headers['x-trace-id'];
    const taskId = ask.body.taskId;

    // 后台异步出片是 detached 的，轮询等它跑完
    const deadline = Date.now() + 15000;
    let events: string[] = [];
    while (Date.now() < deadline) {
      events = sink.findEvents();
      if (events.includes('task.video.ready')) break;
      await new Promise((r) => setTimeout(r, 100));
    }

    expect(events).toEqual(
      expect.arrayContaining([
        'task.created',
        'task.answered',
        'task.tts.done',
        'task.render.submitted',
        'task.video.ready',
      ]),
    );

    const traceIds = new Set(sink.findByKind('trace').map((r) => r.traceId));
    expect(traceIds.size).toBe(1);
    expect(traceIds.has('-')).toBe(false);
    expect([...traceIds][0]).toBe(askTraceId);

    // traceId 也落到了 render_tasks 表
    const task = await request(http).get(`/tasks/${taskId}`).set('Authorization', `Bearer ${token}`).expect(200);
    expect(task.body.traceId).toBe(askTraceId);
  });
});
```

> **为什么 401 那条没有 access 日志**：NestJS 的执行顺序是 `中间件 → Guard → 拦截器 → 控制器`。`JwtGuard` 在拦截器之前抛错，`AccessLogInterceptor.intercept()` 根本没机会执行。
> 所以「一次失败 = 1 条 access + 1 条 error」只在**控制器/handler 内部抛错**时成立；Guard / 参数校验阶段抛错只有 error 日志。这是 NestJS 生命周期的固有限制，不是实现缺陷（生产里靠 error 日志 + traceId 一样能定位）。

- [ ] **Step 2: 跑 e2e**

Run:
```bash
cd /Users/lkz/202507/record-replay && pnpm --filter @record-replay/api test:e2e -- logging.e2e-spec.ts
```
Expected：4 tests PASS。

- [ ] **Step 3: Commit**

```bash
cd /Users/lkz/202507/record-replay
git add apps/api/test/logging.e2e-spec.ts
git commit -m "test(logging): 新增日志系统 e2e（traceId/异常结构/埋点链路）"
```

---

## Task 18: 全量回归 + 真机验证

- [ ] **Step 1: 全量单测 + e2e**

Run:
```bash
cd /Users/lkz/202507/record-replay && pnpm --filter @record-replay/api test -- --runInBand
```
Expected：13 原有 suites 全绿 + 新增 7 个 spec 全绿，0 失败。

- [ ] **Step 2: 起完整链路**

Run（三个终端）：
```bash
cd /Users/lkz/202507/record-replay/docker && docker compose up -d
cd /Users/lkz/202507/record-replay && pnpm --filter @record-replay/api log:consumer
cd /Users/lkz/202507/record-replay && pnpm --filter @record-replay/api start:dev
```

- [ ] **Step 3: 手机走一次「提问 → 出片」**

在手机上完成登录 → 创建人格 → 提问，等到视频生成完成。

- [ ] **Step 4: 用 traceId 查全链路**

Run：
```bash
TRACE=$(curl -s -D - -o /dev/null -H 'Authorization: Bearer <你的token>' \
  http://127.0.0.1:3000/health | grep -i '^x-trace-id' | tr -d '\r' | awk '{print $2}')
echo "trace=$TRACE"
```
更直接的方式：从 App 报错提示或响应头拿到 traceId，然后：

```bash
docker exec record-replay-clickhouse clickhouse-client --query "
SELECT ts, kind, event, stage, duration_ms, total_duration_ms, status, msg
FROM record_replay.rr_logs
WHERE trace_id = '<traceId>'
ORDER BY ts
FORMAT TSVRaw"
```
Expected：同一个 traceId 下至少看到 1 条 `access` + `task.created` → `task.answered` → `task.tts.done` → `task.render.submitted` → 若干 `task.render.polled` → `task.video.ready`，时间递增。

- [ ] **Step 5: 看各阶段耗时 P95**

Run：
```bash
docker exec record-replay-clickhouse clickhouse-client --query "
SELECT event, count() AS n, round(quantile(0.95)(duration_ms)) AS p95_ms, round(avg(duration_ms)) AS avg_ms
FROM record_replay.rr_logs
WHERE kind = 'trace' AND event != ''
GROUP BY event ORDER BY n DESC FORMAT PrettyCompact"
```
Expected：输出各事件条数与 P95 耗时表。

- [ ] **Step 6: 最终提交（若有收尾改动）**

```bash
cd /Users/lkz/202507/record-replay
git status --short
```

若无未提交改动则跳过；否则按实际内容提交。

---

## Self-Review 记录

**Spec 覆盖检查**

| 规格章节 | 覆盖位置 |
|---|---|
| §3.1 新增文件清单 | Task 3/4/5/6/7/8/9/10/11/14/15/16 |
| §3.2 改动文件清单 | Task 1/2/11/12/13 |
| §4 TraceId 来源与去向 | Task 4/5（①响应头 ②ALS）、Task 12（③落库）、Task 10/16（④Kafka 字段 + partition key） |
| §5 Topic 设计 | Task 1（3 topic/3 分区/3 天与 30 天保留期）、Task 10（kind→topic）、Task 16（消费组 + 自举建 topic） |
| §6 日志事件模型 | Task 3（LogRecord）、Task 3（log-events）、Task 9（7 个埋点） |
| §7 全局异常过滤器 | Task 8 |
| §8 访问日志拦截器 | Task 7 |
| §9 KafkaLogSink 要点 | Task 10（acks=-1 / 幂等 / 队列 / 降级 / topic 路由） |
| §10 log-consumer | Task 14/15/16（表结构、攒批、手动提交 offset、自举建表） |
| §11 数据模型改动 | Task 12 |
| §12 Docker | Task 1（含双 listener 修正） |
| §13 配置项 | Task 2（含 LOG_BATCH_MAX 补漏） |
| §14 测试策略 | Task 3~10、14~17 共 7 个新 spec + logging.e2e-spec |
| §15 逐步实施顺序 | Task 1~18 顺序一致 |

**Placeholder 扫描**：无 TBD / TODO / “稍后补充”。所有命令、文件路径、测试接口（`POST /auth/sms/login`、`POST /personas`、`POST /personas/:id/ask`、`GET /tasks/:id`、`GET /health`）与短信桩方法名（`sendSmsVerifyCodeWithOptions` / `checkSmsVerifyCodeWithOptions`）均已对照现有 `test/auth.e2e-spec.ts`、`test/persona.e2e-spec.ts`、`test/task.e2e-spec.ts` 核实。

**执行期需留意的一处行为修正（已在 Task 17 注明）**：规格 §8.3 说"一次失败 = 1 条 access + 1 条 error"。实际上 NestJS 的 Guard 在拦截器之前执行，因此 **Guard / 参数校验阶段**抛错只有 error 日志、没有 access 日志；只有 handler 内部抛错才是 1+1。e2e 已按真实行为分别断言。

**类型一致性**：`LogRecord` 字段在 `log-sink.ts` 定义，`toRow()` 映射的 18 个列与 `clickhouse-schema.ts` 的 DDL 列名逐一对应（Task 14 单测强制校验）；`LOG_SINK` 令牌只在 `log-sink.ts` 定义，其余文件一律 `import { LOG_SINK } from './log-sink'`（`log.module.ts` 再转发给 AppModule）。
