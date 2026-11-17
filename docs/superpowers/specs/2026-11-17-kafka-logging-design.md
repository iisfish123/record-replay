# record-replay 日志系统设计（Kafka 版）

- 日期：2026-11-17
- 状态：待评审
- 项目根目录：`/Users/lkz/202507/record-replay`
- 配套教学文档：[`docs/learn/kafka-log.md`](../../learn/kafka-log.md)（从 Kafka 基础讲到本项目代码）

---

## 1. 背景与目标

### 1.1 现状

后端目前只有零散的 `new Logger(...)` 输出到 stdout：

- 没有 traceId，一次请求产生的所有日志无法串起来
- 没有访问日志（谁、什么时候、调了哪个接口、耗时多久、结果如何）
- 异常处理散落在各 service，客户端拿到的错误结构由 NestJS 默认决定，堆栈直接打 stdout
- 关键链路（用户提问 → 出片）没有任何可观测点，出片失败时只能靠翻数据库字段猜

### 1.2 目标

1. **可追踪**：一次请求从进到出，所有日志带同一个 `traceId`，可一键串起完整链路
2. **可观测**：用户「提问 → 生成视频答案」这条主链路有 7 个关键埋点，每步都有耗时
3. **可排查**：全局统一错误结构，客户端只拿到安全的 `{ code, message, traceId }`，堆栈完整落到日志系统
4. **可查询**：日志**不落本地文件**，走 `API → Kafka → ClickHouse` —— Kafka 做削峰解耦，ClickHouse 做列式存储与聚合查询（"昨天各阶段 P95 耗时多少"这类问题一条 SQL 出结果）
5. **可学习**：本项目当作 Kafka + ClickHouse 入门的第一课，对齐企业化"日志采集 → 消息队列 → 落库归档"的标准形态

### 1.3 非目标（YAGNI）

明确不做，避免过度设计：

- ❌ 日志检索 UI / 日志查询接口（直接用 `clickhouse-client` 跑 SQL 即可）
- ❌ Elasticsearch / Kafka Connect / 数据看板（Grafana / Metabase）
- ❌ 多 broker 集群、跨机房容灾（本地单节点 KRaft，文档里讲清与生产 RF=3 的差异）
- ❌ 分布式链路追踪（OpenTelemetry / Jaeger）
- ❌ 前端改动（前端已有轮询 `/tasks/:id` 的能力，不新增接口）
- ❌ 日志分级动态热更新

---

## 2. 整体架构

### 2.1 数据流

```
┌──────────┐   HTTP    ┌──────────────────────────────────────────┐
│ 手机 App  │ ────────► │            NestJS API (3000)             │
└──────────┘           │                                          │
                       │  TraceMiddleware   → 生成/沿用 traceId    │
                       │       │             写入 AsyncLocalStorage │
                       │       ▼             回写响应头 X-Trace-Id  │
                       │  Controller / Service                     │
                       │   ├─ AccessLogInterceptor → 访问日志       │
                       │   ├─ TaskTracer           → 关键埋点       │
                       │   └─ AllExceptionsFilter  → 异常日志       │
                       │       │                                   │
                       │       ▼                                   │
                       │   LogSink (接口)                           │
                       │       │                                   │
                       │   KafkaLogSink  ← 唯一碰 kafkajs 的地方    │
                       │   （内存队列 + 批量异步 + 失败降级）         │
                       └───────┬──────────────────────────────────┘
                               │ produce  acks=-1
                               ▼
                  ┌────────────────────────────┐
                  │  record-replay-kafka        │
                  │  bitnamilegacy/kafka:4.0.0  │
                  │  KRaft 单节点  127.0.0.1:9093│
                  │  topic: rr.api.access       │
                  │         rr.api.error        │
                  │         rr.task.trace       │
                  └───────────┬────────────────┘
                              │ consume  消费组 rr-log-archiver
                              ▼
                  ┌────────────────────────────┐
                  │  log-consumer 独立进程       │
                  │  手动提交 offset            │
                  │  批量 INSERT（每 500 条/1s） │
                  └───────────┬────────────────┘
                              │ @clickhouse/client (HTTP 8123)
                              ▼
                  ┌────────────────────────────┐
                  │  record-replay-clickhouse   │
                  │  bitnami/clickhouse:25.3.1  │
                  │  127.0.0.1:8123             │
                  │  表 record_replay.rr_logs   │
                  │  MergeTree / 按天分区 / TTL │
                  └────────────────────────────┘
```

> **Kafka 与 ClickHouse 的分工**：Kafka 是**短期缓冲**（削峰、解耦、可回放），ClickHouse 是**最终存储**（长期保留、可聚合查询）。两者保留期独立，互不影响。

### 2.2 为什么是"内存队列 + 批量异步"而不是"每条日志同步 send"

| 方案 | 问题 |
|---|---|
| 每条日志 `await producer.send()` | 日志变成业务请求的同步依赖，Kafka 抖动 = 接口变慢，违背"日志不能拖垮业务" |
| 内存队列 + 定时批量 flush | 业务线程只做 `push`（微秒级），Kafka 抖动只影响日志延迟，不影响接口 |

**结论**：`LogSink.emit()` 是**同步非阻塞**的（只入队），真正发送在后台定时器里做。

---

## 3. 代码分层与文件清单

### 3.1 新增文件

```
apps/api/src/log/
├── log.module.ts                 # LogModule：注册全局 Provider
├── log-sink.ts                   # LogSink 接口 + LogRecord 类型 + LOG_SINK 注入令牌
├── kafka-log-sink.ts             # KafkaLogSink：唯一 import 'kafkajs' 的文件
├── in-memory-log-sink.ts         # InMemoryLogSink：测试替身，e2e 用它断言
├── noop-log-sink.ts              # NoopLogSink：LOG_KAFKA_ENABLED=false 时兜底
├── trace-context.ts              # AsyncLocalStorage<TraceContext> + getTraceId()
├── trace.middleware.ts           # TraceMiddleware
├── access-log.interceptor.ts     # AccessLogInterceptor
├── all-exceptions.filter.ts      # AllExceptionsFilter
├── task-tracer.ts                # TaskTracer（关键埋点）
├── app-logger.service.ts         # AppLoggerService extends ConsoleLogger（把 Logger 也接进 LogSink）
└── consumer/
    ├── main.ts                   # log-consumer 进程入口
    ├── clickhouse-schema.ts      # DDL 常量（建库建表，幂等）
    └── clickhouse-writer.ts      # 批量 INSERT 写入器（攒批 + 重试）
```

### 3.2 改动文件

| 文件 | 改动 |
|---|---|
| `apps/api/src/app.module.ts` | 引入 `LogModule`；注册全局过滤器（通过 `APP_FILTER` / `APP_INTERCEPTOR`） |
| `apps/api/src/main.ts` | 换成 `bufferLogs: true` + `app.useLogger(appLogger)`；`app.use(traceMiddleware)` |
| `apps/api/src/task/entities/render-task.entity.ts` | 新增 `traceId` 列（`varchar(64) nullable`） |
| `apps/api/src/task/task.service.ts` | 在 `process()` 各阶段插入 `TaskTracer` 埋点；`create()` 时把当前 traceId 落库 |
| `apps/api/package.json` | 新增依赖 `kafkajs`、`@clickhouse/client`；新增 script `log:consumer` |
| `docker/docker-compose.yml` | 新增 `kafka`（`record-replay-kafka`，`127.0.0.1:9093:9092`）与 `clickhouse`（`record-replay-clickhouse`，`127.0.0.1:8123:8123`） |
| `apps/api/.env.development` | 新增 `KAFKA_BROKERS` / `LOG_KAFKA_ENABLED` / `CLICKHOUSE_URL` 等 |

### 3.3 分层原则（SOLID）

- **依赖倒置**：`AccessLogInterceptor` / `AllExceptionsFilter` / `TaskTracer` 只依赖 `LogSink` 接口，不依赖 Kafka
- **单一职责**：`KafkaLogSink` 是唯一 import `kafkajs` 的文件 —— 换中间件（Kafka → Redis Stream → 文件）只改这一个文件
- **开闭**：新增埋点只需在 `TaskTracer` 加方法，不动 Sink
- **测试友好**：单测/e2e 注入 `InMemoryLogSink`，完全不碰真 Kafka，跑得快且稳定

---

## 4. TraceId 设计（来源与去向）

> 这一节是本次设计的核心。`X-Trace-Id` 从哪来、到哪去，必须逐条讲清。

### 4.1 来源（Ingress）：一个请求的 traceId 怎么诞生

```
客户端请求
   │
   ├─ 请求头带 X-Trace-Id 且合法（1~64 字符）？ ──是──► 沿用该值
   │                                              （用于跨服务/客户端主动串联）
   └────────────────────────────否─────────────► randomUUID()
```

- 合法性校验：必须是 1~64 位的字符串，否则视为伪造/脏数据，**重新生成**（避免日志被注入超长串或跨行字符）
- 为什么"沿用优先"：手机 App、网关、上游服务如果已经生成了 traceId，后端沿用才能把链路拼完整

### 4.2 去向（Egress）：一个 traceId 要去 4 个地方

| # | 去向 | 形式 | 为什么 |
|---|---|---|---|
| ① | **响应头** | `X-Trace-Id: <uuid>` | 客户端/前端把 traceId 显示在错误提示里，用户报障时直接报这个号，后端能秒定位 |
| ② | **AsyncLocalStorage** | `als.run({ traceId }, ...)` | 让本次请求调用栈内**任意位置**（service / provider / sink）都能 `getTraceId()`，无需层层传参 |
| ③ | **数据库** | `render_tasks.trace_id` | **关键**：`POST /personas/:id/ask` 立刻返回 `{ taskId }`，之后出片是**后台异步**跑的，早就脱离 HTTP 请求上下文了。只有把 traceId 落库，异步链路产出的日志才能和那次 HTTP 请求对齐 |
| ④ | **Kafka 消息** | 消息体 `traceId` 字段 **+ 作为 partition key** | 字段用于检索；作为 key 保证**同一 traceId 的所有日志进同一分区**，消费端看到的是**有序**的链路 |

### 4.3 AsyncLocalStorage 为什么是必须的

NestJS 里 HTTP 请求处理是异步的（Promise 链），普通变量无法跨 `await` 边界共享。

- ❌ 全局变量：并发请求会互相污染
- ❌ 每个函数加 `traceId` 参数：侵入性强，provider 接口全要改
- ✅ `AsyncLocalStorage`：Node 官方方案，`als.run(ctx, () => next())` 之后，整个异步调用链内 `als.getStore()` 都能拿到 ctx

### 4.4 关键埋点如何"续上"异步链路

```
POST /personas/:id/ask
  ├─ TraceMiddleware 生成 traceId=T
  ├─ TaskService.create() → render_tasks.trace_id = T   ← 落库
  ├─ 返回 { taskId }，请求结束，HTTP 上下文销毁
  │
  └─ void this.process(taskId)   ← 后台异步，此时 ALS 已空
        └─ 进入 process 时：traceContext.run({ traceId: task.traceId }, () => ...)
              └─ 之后所有 Tracer 埋点自动带上 T
```

---

## 5. Topic 设计（为什么这么设计）

### 5.1 三个 topic

| Topic | 分区数 | 保留期 | 内容 | 设计理由 |
|---|---|---|---|---|
| `rr.api.access` | 3 | 3 天 | 每次 HTTP 访问一行 | **量大且低价值**：每天几万行，只用于近期排查（"刚才那个 500 是哪个接口"）。3 天足够，过期自动清理省磁盘 |
| `rr.api.error` | 3 | 30 天 | 4xx/5xx + 堆栈 | **量小但高价值**：报错是"事故证据"，要留久一点做复盘。堆栈只进这里，不进 access |
| `rr.task.trace` | 3 | 30 天 | 出片链路埋点 | **业务关键**：用户提问 → 出片 7 个阶段。既要排查失败，也要算各阶段耗时（P95），30 天可看趋势 |

> **Kafka 保留期 ≠ 数据生命周期**。这里的 3 天/30 天只决定"消息在 Kafka 磁盘上留多久"，是**缓冲层**的容量控制。
> 数据真正的长期存储在 **ClickHouse**（`rr_logs` 表，TTL 30 天）。因为归档消费组 `rr-log-archiver` 一直在线消费，Kafka 侧 3 天足够安全落库；即使消费者停 3 天以上，也只需临时调大某个 topic 的保留期即可回放。

### 5.2 为什么按"类型"分 topic，而不是一个 topic 全塞

| 维度 | 分 3 个 topic | 合并 1 个 topic |
|---|---|---|
| 保留期 | 各自独立（access 3 天 / error 30 天） | 只能迁就最长，access 白占 27 天磁盘 |
| 消费端 | 可按需只消费 error 做告警 | 必须全量拉再过滤，浪费带宽 |
| 分区键 | 都能用 traceId | 抢同一个分区集合 |

**结论**：保留期差异是关键驱动。若"一条日志一个 topic"则会 topic 爆炸，所以按**生命周期 + 用途**聚类成 3 个。

### 5.3 为什么是 3 个分区

- **下限**：本地单 broker，`min.insync.replicas` 实际为 1，分区数 ≥ 2 才能体现"并行消费"（同一个消费组内最多 N 个 consumer 并行）
- **上限**：本项目日志量很小（Demo），3 个分区既够并行演示，又不至于产生过多小文件、过多 rebalance 开销
- **可扩展**：Kafka **只能增分区不能减**，且增分区会打乱「同 key 落同分区」的映射（`hash(key) % 分区数` 变了）。所以宁可一开始就留一点余量（3 而非 1），避免后期扩容导致历史数据 key 映射错乱
- **生产对照**：真实生产按吞吐算，经验值是「单分区 10MB/s 左右」，几十 MB/s 的量通常给 6~12 分区

### 5.4 为什么 partition key 用 traceId

Kafka **只保证"单分区内有序"**，不保证跨分区有序。

- key = `traceId` → 同一条链路的日志**全部落到同一分区** → 消费端读到的顺序 = 产生顺序
- 若 key = null（轮询）→ 同一条链路的 7 条埋点会散落到 3 个分区 → 消费端看到的顺序是乱的，无法还原"提问 → 出片"的时序

> 这是本项目最容易被忽略、也最能体现"懂 Kafka"的一个设计点。

### 5.5 建 topic 的方式

**不依赖 Kafka 的 `auto.create.topics.enable`**（生产通常关闭，且自动建的 topic 分区数/保留期是默认值，不可控）。

- 开发：在 `docker-compose.yml` 里用一个 `kafka-init` 一次性容器跑 `kafka-topics.sh --create`（幂等，可重复执行）
- 消费端进程启动时也做一次"确保存在"（`admin.createTopics` 幂等），保证换机器也能自举

---

## 6. 日志事件模型

### 6.1 统一基础字段

所有发往 Kafka 的日志都是这个信封：

```ts
interface LogRecord {
  ts: string;        // ISO8601，例：2026-11-17T08:30:12.345Z
  level: 'info' | 'warn' | 'error';
  kind: 'access' | 'error' | 'trace' | 'app';   // 决定进哪个 topic
  traceId: string;   // 见第 4 节
  msg: string;       // 人类可读描述
  // 业务上下文（有则带，无则省略）
  userId?: string;
  personaId?: string;
  taskId?: string;
  // 访问日志专用
  method?: string;
  path?: string;
  status?: number;
  durationMs?: number;
  // 错误专用（仅进 rr.api.error）
  code?: string;
  stack?: string;
  // 埋点专用
  event?: LogEvent;
  stage?: string;
  totalDurationMs?: number;
  meta?: Record<string, unknown>;
}
```

### 6.2 关键埋点事件（`rr.task.trace`）

用户「提问 → 生成视频回答」全链路 7 个事件：

| event | stage | 触发点 | 关键字段 |
|---|---|---|---|
| `task.created` | `pending` | `TaskService.create()` 落库后 | `question` 长度、`personaId` |
| `task.answered` | `answering` | LLM 返回回答文本后 | `durationMs`（LLM 耗时）、`answerChars` |
| `task.tts.done` | `tts` | 语音合成 + 落盘完成 | `durationMs`、`audioBytes` |
| `task.render.submitted` | `rendering` | 提交口型任务成功 | `durationMs`、`remoteTaskId` |
| `task.render.polled` | `rendering` | 每次轮询一次（可多条） | `round`、`remoteStatus` |
| `task.video.ready` | `done` | 视频转存成功 | `totalDurationMs`（create→done 总耗时） |
| `task.failed` | `failed` | 任一步失败 | `stage`（失败阶段）、`error`、`totalDurationMs`、`stack` |

**为什么要 `totalDurationMs`**：单个阶段耗时（`durationMs`）看瓶颈，总耗时看用户体验。两方都要。

**为什么 `task.failed` 要带 `stage`**：光知道"失败"没用，要知道**卡在哪一步**（LLM？TTS？渲染？转存？）。

### 6.3 事件常量集中定义

`log-events.ts` 里用 `const` 对象 + `typeof` 派生联合类型，避免字符串裸写、保证类型安全：

```ts
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

---

## 7. 全局异常过滤器

### 7.1 统一错误结构（返回给客户端）

```json
{
  "code": "TASK_NOT_FOUND",
  "message": "任务不存在",
  "traceId": "0f5b1c2e-..."
}
```

| 字段 | 说明 |
|---|---|
| `code` | 机器可读错误码，来自 `HttpException` 的 `response.code`，或按 HTTP status 兜底映射（如 `404 → NOT_FOUND`） |
| `message` | 人类可读提示，`HttpException` 的 message；**未知异常统一回 `服务器内部错误`**，绝不返回原始 message（可能含 SQL、路径、密钥片段） |
| `traceId` | 本次请求 traceId，用户报障时可直接提供 |

### 7.2 堆栈只进日志，绝不回传

```
捕获异常
  ├─ 若是 HttpException → 用其 status / message
  ├─ 否则 → 500 + '服务器内部错误'
  ├─ 无论哪种，把完整 stack 作为 { kind:'error' } 发给 LogSink（→ rr.api.error）
  └─ 响应体只含 { code, message, traceId }
```

**为什么**：堆栈暴露内部实现（文件路径、依赖版本、SQL 片段），是典型的信息泄漏；客户端也不需要堆栈，只需要 traceId。

### 7.3 404 等非异常路径

NestJS 的 404（路由不存在）不会抛异常，走不到过滤器。这类请求仍会被 `AccessLogInterceptor` 记录（`status=404`），访问日志不受影响。

---

## 8. 访问日志拦截器

### 8.1 记什么

每个进入的 HTTP 请求，在响应结束后发一条 `kind:'access'`：

```json
{
  "ts": "...", "level": "info", "kind": "access", "traceId": "T",
  "method": "POST", "path": "/personas/xxx/ask", "status": 201,
  "durationMs": 42, "userId": "u1", "msg": "POST /personas/xxx/ask 201 42ms"
}
```

### 8.2 为什么用 Interceptor 而不是 Middleware

| | Middleware | Interceptor |
|---|---|---|
| 执行时机 | 路由**之前** | 路由**前后**都行（RxJS tap） |
| 能否拿到响应状态码 | ❌（要 hack `res.on('finish')`） | ✅（`response.statusCode` 在 handler 之后） |
| 能否拿到 handler 异常 | ❌ | ✅（`catchError`） |

需求是"METHOD PATH STATUS DURATION"，`Interceptor` 天然满足，故访问日志用 Interceptor；traceId 生成必须在最外层尽早发生，故用 Middleware。

> 一句话：**Middleware 负责"注入上下文"，Interceptor 负责"统计访问"**。

### 8.3 与异常过滤器的关系

- 成功请求：Interceptor 正常记录
- 异常请求：Filter 先记 `kind:'error'`（带堆栈），Interceptor 的 `tap` 不触发，但 `catchError` 分支仍记一条 `access`（status=5xx）→ **一次失败 = 1 条 access + 1 条 error**，两者都有价值

### 8.4 `userId` 怎么来

`JwtGuard` 校验通过后把用户挂在 `req.user`。Interceptor 在响应阶段读 `req.user?.sub` 即可（登录/注册等匿名接口则为空）。

---

## 9. KafkaLogSink 实现要点

### 9.1 生产者配置

```ts
const producer = kafka.producer({
  idempotent: true,        // 幂等生产者，防重复
  maxInFlightRequests: 1,  // 幂等模式下必须为 1，保证单连接内有序
});
await producer.connect();
await producer.send({
  topic,
  acks: -1,                // 所有 ISR 都写入才确认（本地单副本等价于 -1）
  messages: batch.map((r) => ({ key: r.traceId, value: JSON.stringify(r), headers: {...} })),
});
```

### 9.2 队列与批量

| 参数 | 值 | 理由 |
|---|---|---|
| `FLUSH_INTERVAL_MS` | 500 | 延迟与吞吐的折中；500ms 内攒批 |
| `BATCH_MAX` | 200 | 单次 `send` 上限，避免单条消息过大 |
| `QUEUE_MAX` | 1000 | 队列上限，超出**丢最旧**并 `process.stderr.write` 告警 |

### 9.3 降级：Kafka 挂了业务不能挂

- `emit()` 只入队，**永不抛异常**
- 定时 flush 里 `try/catch` 包住 `producer.send`，失败只打 stderr 计数，**不重试阻塞**（日志可丢，业务不可停）
- `LOG_KAFKA_ENABLED=false` 时用 `NoopLogSink`（本地不想起 Kafka 也能跑 API）
- 应用退出时 `onApplicationShutdown` 做一次 flush（尽力而为，不阻断退出）

### 9.4 topic 路由

`LogRecord.kind` → topic：

```ts
const TOPIC_BY_KIND = {
  access: 'rr.api.access',
  error:  'rr.api.error',
  trace:  'rr.task.trace',
  app:    'rr.api.access',   // 应用普通日志按访问日志级别保留
};
```

---

## 10. log-consumer 进程（Kafka → ClickHouse）

### 10.1 定位

一个**独立 Node 进程**（不是 Nest 应用），职责单一：从 Kafka 拉日志 → 批量写入 ClickHouse。

```bash
pnpm --filter @record-replay/api log:consumer
```

### 10.2 消费配置

```ts
const consumer = kafka.consumer({
  groupId: 'rr-log-archiver',
  sessionTimeout: 30000,
  heartbeatInterval: 3000,
});
await consumer.subscribe({ topics: ['rr.api.access', 'rr.api.error', 'rr.task.trace'], fromBeginning: false });
await consumer.run({
  eachBatchAutoResolve: false,   // 手动提交，处理成功才提交 offset
  eachBatch: async ({ batch, resolveOffset, heartbeat, commitOffsetsIfNecessary }) => {
    const rows = batch.messages.filter((m) => m.value).map((m) => toRow(JSON.parse(m.value!.toString())));
    await writer.insert(rows);                       // 批量写入 ClickHouse
    for (const m of batch.messages) resolveOffset(m.offset);
    await heartbeat();
    await commitOffsetsIfNecessary();
  },
});
```

### 10.3 表结构（`record_replay.rr_logs`）

**单表 + `kind` 字段**（用户选定的方案）：写入与查询都简单，`kind` 用 `LowCardinality` 压缩。

```sql
CREATE DATABASE IF NOT EXISTS record_replay;

CREATE TABLE IF NOT EXISTS record_replay.rr_logs
(
    ts                DateTime64(3, 'UTC'),
    level             LowCardinality(String),
    kind              LowCardinality(String),        -- access | error | trace | app
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
    meta              String DEFAULT '',             -- JSON 字符串，装零散字段
    INDEX idx_trace_id trace_id TYPE bloom_filter GRANULARITY 1
)
ENGINE = MergeTree
PARTITION BY toYYYYMMDD(ts)
ORDER BY (kind, ts)
TTL toDateTime(ts) + INTERVAL 30 DAY
SETTINGS index_granularity = 8192;
```

四个关键设计点（教学文档会展开讲）：

| 设计 | 作用 | 为什么 |
|---|---|---|
| `ENGINE = MergeTree` | ClickHouse 的默认列存引擎，支持主键索引、分区、TTL | 日志是典型"只写不改、按时间范围读"的场景，列存 + 顺序扫描极快 |
| `ORDER BY (kind, ts)` | 排序键（≈主键），决定数据物理顺序与索引粒度 | 最常用的两类查询是"某 kind 在某个时间窗"，把这两个放在最前，granule 直接跳过 |
| `PARTITION BY toYYYYMMDD(ts)` | 按天分区 | 查询常带时间范围 → 分区裁剪；TTL 删除也按分区整块删，代价低 |
| `INDEX idx_trace_id ... bloom_filter` | 跳数索引 | 按 `trace_id` 查全链路时，虽然 trace_id 不是排序键前缀，bloom filter 也能跳过绝大多数 granule |
| `TTL ... + INTERVAL 30 DAY` | 自动过期删除 | 单表统一 30 天；**不用写清理脚本** |

> **取舍说明**：单表方案的代价是 access 日志也保留 30 天（不能像 topic 那样单独 3 天）。这在 Demo 里完全可接受——ClickHouse 列存压缩率极高，30 天的 access 日志通常也就几十 MB。若将来确实要分治，再拆表或引入 `expires_at` 列做行级 TTL。

### 10.4 批量写入（关键）

ClickHouse 的写入模型与 MySQL 完全不同：**它不怕数据量大，怕写入次数多**。

> 每次 `INSERT` 都会在磁盘上生成一个 **part**，后台再异步 merge。写入过于频繁会产生大量小 part，触发 `Too many parts` 报错，写入被拒。

因此写入器必须**攒批**：

| 参数 | 值 | 理由 |
|---|---|---|
| `CH_BATCH_MAX` | 500 条 | 单次 INSERT 的行数上限 |
| `CH_FLUSH_INTERVAL_MS` | 1000 | 最多攒 1 秒就发，控制延迟 |
| `CH_MAX_RETRY` | 3 | 写入失败时按连接错误退避重试；重试仍失败则**不提交 offset**，等下次重投 |

用官方客户端：

```ts
await client.insert({
  table: 'rr_logs',
  values: rows,
  format: 'JSONEachRow',
});
```

客户端还需设置 `date_time_input_format: 'best_effort'`，这样可以直接把 `2026-11-17T08:30:12.345Z` 这类 ISO 字符串交给 ClickHouse 解析，不用手写时区转换。

### 10.5 建表时机：消费端自举

不依赖容器 initdb 脚本（Bitnami 镜像是否执行 `/docker-entrypoint-initdb.d` 因版本而异，不可靠）。
`log-consumer` 启动时先执行一次 `clickhouse-schema.ts` 里的 `CREATE DATABASE / CREATE TABLE IF NOT EXISTS`（幂等），再开始消费。DDL 同时也放在 `clickhouse-schema.ts` 常量里，方便人工复制执行。

### 10.6 为什么手动提交 offset

- 自动提交可能在"ClickHouse 写入失败"时也提交了 offset → 日志丢失
- 手动提交保证"**写入成功才提交**"，至少一次（at-least-once）
- 代价：可能重复写（进程崩溃在写入后、提交前）→ ClickHouse 侧可用 `ReplacingMergeTree` 去重，Demo 阶段接受重复

---

## 11. 数据模型改动

`render_tasks` 新增一列：

```ts
@Column({ type: 'varchar', length: 64, nullable: true })
traceId: string | null;
```

- `synchronize: true` 会自动加列（Demo 阶段够用；生产要改用 migration）
- 落库时机：`TaskService.create()` 内 `this.tasks.create({ ..., traceId: getTraceId() })`
- 用途：① 异步链路续上 ALS；② 任何时刻用 `taskId` 即可从数据库反查 traceId，再去 ClickHouse 捞全链路

---

## 12. Docker：新增 Kafka 与 ClickHouse

> **镜像来源**：本项目所在环境的 Docker Hub 不可达，故统一使用**本地已有镜像** + `pull_policy: never`。
> 已确认本地存在：`bitnamilegacy/kafka:4.0.0-debian-12-r10`、`bitnami/clickhouse:25.3.1`。

追加到 `docker/docker-compose.yml`：

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
      KAFKA_CFG_CONTROLLER_QUORUM_VOTERS: "0@kafka:9093"   # 容器内监听端口
      KAFKA_CFG_LISTENERS: "PLAINTEXT://:9092,CONTROLLER://:9093"
      KAFKA_CFG_ADVERTISED_LISTENERS: "PLAINTEXT://127.0.0.1:9093"
      KAFKA_CFG_LISTENER_SECURITY_PROTOCOL_MAP: "CONTROLLER:PLAINTEXT,PLAINTEXT:PLAINTEXT"
      KAFKA_CFG_CONTROLLER_LISTENER_NAMES: "CONTROLLER"
      KAFKA_CFG_AUTO_CREATE_TOPICS_ENABLE: "false"
      KAFKA_CFG_NUM_PARTITIONS: "3"
      KAFKA_CFG_DEFAULT_REPLICATION_FACTOR: "1"
      ALLOW_PLAINTEXT_LISTENER: "yes"
    volumes:
      - ./kafka_data:/bitnami/kafka
    healthcheck:
      test: ["CMD-SHELL", "/opt/bitnami/kafka/bin/kafka-topics.sh --bootstrap-server 127.0.0.1:9092 --list"]
      interval: 10s
      timeout: 10s
      retries: 10
```

关键点与坑：

1. **端口 9093**：本机 9092 已被 `li-dify-kafka` 占用，故映射到 `127.0.0.1:9093`
2. **ADVERTISED_LISTENERS 必须是宿主机视角的 `127.0.0.1:9093`**：Kafka 客户端连上后会被"重定向"到 advertised 地址，写成容器名 `kafka` 会导致宿主机上的 API 连不上
3. **KRaft 模式**：Kafka 4.0 已移除 ZooKeeper，元数据由 Raft（controller quorum）管理，无需再起 ZK
4. **`AUTO_CREATE_TOPICS_ENABLE=false`**：topic 由 `kafka-init` 显式创建，保证分区数/保留期可控

再加一个一次性 `kafka-init`（`depends_on: kafka healthy`）跑三条 `--create --if-not-exists`（含 `--partitions 3 --replication-factor 1`，access 加 `--config retention.ms=259200000`，error/trace 加 `retention.ms=2592000000`）。

### 12.1 ClickHouse 服务

```yaml
  clickhouse:
    image: bitnami/clickhouse:25.3.1
    pull_policy: never
    container_name: record-replay-clickhouse
    ports:
      - "127.0.0.1:8123:8123"      # HTTP 接口，@clickhouse/client 走这里
    environment:
      ALLOW_EMPTY_PASSWORD: "yes"  # Demo 环境免密码；生产必须设密码 + 网络隔离
      CLICKHOUSE_DATABASE: record_replay
    volumes:
      - ./clickhouse_data:/bitnami/clickhouse
    healthcheck:
      test: ["CMD-SHELL", "wget -qO- http://127.0.0.1:8123/ping || exit 1"]
      interval: 10s
      timeout: 5s
      retries: 10
```

要点：

1. **只映射 8123（HTTP）**：`@clickhouse/client` 走 HTTP，native 9000 用不到，不暴露少一个攻击面
2. **`ALLOW_EMPTY_PASSWORD=yes`**：Bitnami 镜像默认会生成随机密码且要手工取，Demo 用空密码最省事；生产必须关掉
3. **数据卷 `./clickhouse_data`**：容器重建不丢数据；Bitnami 镜像以 UID 1001 运行，宿主机目录权限不对时要 `chown -R 1001 ./clickhouse_data`
4. **建表不靠容器 initdb**：见 10.5，由 `log-consumer` 自举

---

## 13. 配置项

`apps/api/.env.development` 新增：

| 变量 | 默认 | 说明 |
|---|---|---|
| `KAFKA_BROKERS` | `127.0.0.1:9093` | broker 地址，逗号分隔 |
| `KAFKA_CLIENT_ID` | `record-replay-api` | 客户端标识 |
| `LOG_KAFKA_ENABLED` | `true` | `false` 时用 NoopLogSink，本地不起 Kafka 也能开发 |
| `LOG_FLUSH_INTERVAL_MS` | `500` | 批量 flush 间隔 |
| `LOG_QUEUE_MAX` | `1000` | 内存队列上限 |
| `CLICKHOUSE_URL` | `http://127.0.0.1:8123` | ClickHouse HTTP 地址（consumer 用） |
| `CLICKHOUSE_DATABASE` | `record_replay` | 库名 |
| `CLICKHOUSE_USER` | `default` | 用户 |
| `CLICKHOUSE_PASSWORD` | 空 | Demo 为空 |
| `CH_BATCH_MAX` | `500` | 单次 INSERT 行数上限 |
| `CH_FLUSH_INTERVAL_MS` | `1000` | ClickHouse 攒批间隔 |

同步更新 `config/configuration.ts` 的 `AppConfig` 接口与 factory（新增 `log` 与 `clickhouse` 两段）。

---

## 14. 测试策略（TDD，先红后绿）

### 14.1 单元测试

| 文件 | 用例 |
|---|---|
| `trace.middleware.spec.ts` | ① 无 `X-Trace-Id` → 生成 UUID 并回写响应头；② 合法 `X-Trace-Id` → 沿用；③ 超长/非法 → 重新生成；④ 下游 `getTraceId()` 与响应头一致 |
| `access-log.interceptor.spec.ts` | ① 成功请求 → 一条 `access`，含 method/path/status/durationMs/traceId；② 4xx/5xx 记 `status`；③ 有 `req.user` 时带 `userId` |
| `all-exceptions.filter.spec.ts` | ① `HttpException` → 保持 status、统一结构；② 未知 Error → 500 且 message 为通用文案；③ 响应体**不含** `stack`；④ `LogSink` 收到 `kind:'error'` 且**含** `stack`；⑤ traceId 正确回传 |
| `kafka-log-sink.spec.ts` | ① `emit` 只入队不发送；② 到 flush 间隔触发批量 `send`；③ 超过 `QUEUE_MAX` 丢最旧并告警；④ `send` 抛错不影响 `emit`；⑤ `kind` → topic 路由正确；⑥ `traceId` 作为 message key |
| `task-tracer.spec.ts` | ① 每个事件方法发出正确 `event`/`stage`；② `video.ready` / `failed` 带 `totalDurationMs`；③ `failed` 带 `stage` |
| `log-consumer/clickhouse-writer.spec.ts` | ① 未满 `CH_BATCH_MAX` 时按 `CH_FLUSH_INTERVAL_MS` 定时 flush；② 满 `CH_BATCH_MAX` 立即 flush；③ `LogRecord` → ClickHouse 行的字段映射正确（含 `meta` 序列化为字符串）；④ `insert` 抛错时按 `CH_MAX_RETRY` 重试，最终失败抛出（供上层不提交 offset）；⑤ 关闭时 flush 残留 |
| `log-consumer/clickhouse-schema.spec.ts` | ① DDL 含 `CREATE DATABASE IF NOT EXISTS` 与 `CREATE TABLE IF NOT EXISTS`（幂等）；② 表名/列名与 writer 映射一致 |

### 14.2 E2E

`apps/api/test/logging.e2e-spec.ts`（注入 `InMemoryLogSink` 替代 `KafkaLogSink`）：

1. 任意请求 → 响应头含 `X-Trace-Id`；`InMemoryLogSink` 至少有 1 条 `kind:'access'`
2. 请求一个不存在的 task → 响应体为 `{ code, message, traceId }`；有一条 `kind:'error'` 且含 `stack`；响应体无 `stack`
3. `POST /personas/:id/ask`（provider 全桩）→ 断言 `render_tasks.trace_id` 非空且 == 响应头 traceId
4. 断言 `InMemoryLogSink` 中 `event` 依次出现 `task.created` → `task.answered` → `task.tts.done` → `task.render.submitted` → `task.video.ready`，且共享同一 `traceId`

> 注意：现有 13 suites / 67 tests 必须保持全绿；e2e 继续跑在 `record_replay_test` 库。

---

## 15. 逐步实施顺序（每步都先写测试）

1. **准备**：`docker compose up -d kafka kafka-init clickhouse`，确认 3 个 topic 已建、`curl 127.0.0.1:8123/ping` 返回 `Ok`
2. **依赖**：`pnpm --filter @record-replay/api add kafkajs @clickhouse/client`
3. **抽象层**：`log-sink.ts` + `in-memory-log-sink.ts` + `noop-log-sink.ts`（含单测）
4. **trace 上下文**：`trace-context.ts` + `trace.middleware.ts`（含单测）；`main.ts` 挂载，验证响应头
5. **访问日志**：`access-log.interceptor.spec.ts` → 实现 → 注册
6. **异常过滤器**：`all-exceptions.filter.spec.ts` → 实现 → 注册（`APP_FILTER`）
7. **数据模型**：`render-task.entity.ts` 加 `traceId` 列
8. **埋点**：`task-tracer.spec.ts` → 实现 → `task.service.ts` 插入 7 个埋点（含异步链路 `runWithTrace` 续接）
9. **Kafka 落地**：`kafka-log-sink.spec.ts` → 实现 → `LogModule` 按 `LOG_KAFKA_ENABLED` 绑定 `LogSink` Provider
10. **ClickHouse 落地**：`clickhouse-schema.ts` + `clickhouse-writer.ts` 及其单测 → `consumer/main.ts` + `log:consumer` script
11. **e2e**：`logging.e2e-spec.ts` 全绿
12. **真机验证**：手机走一次「提问 → 出片」，用 `clickhouse-client` 查同 traceId 的完整 7 条链路

---

## 16. 风险与取舍

| 风险 | 取舍 |
|---|---|
| 日志可能丢（Kafka 挂、队列溢出） | **有意为之**：日志系统不能拖垮业务。丢日志可接受，接口 500 不可接受 |
| 消费端可能重复写 ClickHouse（at-least-once） | 接受；需要精确可改 `ReplacingMergeTree` 或在查询侧按 `trace_id+ts+event` 去重 |
| 单节点 Kafka 无副本 | Demo 环境够用；文档中明确标注"生产需 3 broker + RF=3" |
| ClickHouse 单节点、无密码 | Demo 够用；生产需集群 + 认证 + 网络隔离 |
| ClickHouse 小批写入触发 `Too many parts` | 靠攒批（500 条 / 1 秒）规避；批量越大越安全 |
| `synchronize: true` 自动加列 | Demo 够用；生产改 migration |

---

## 17. 未来演进（非本次范围）

- 多 broker + `replication.factor=3` + `min.insync.replicas=2`
- 可视化看板：Grafana / Metabase 接 ClickHouse，画出各阶段耗时趋势、错误率
- 全文检索需求出现时再引入 Elasticsearch（ClickHouse 已能满足绝大多数日志 SQL 分析）
- 基于 `rr.api.error` 的实时告警（消费端命中 error 即发邮件，复用既有告警通道）
- OpenTelemetry 接入，traceId 与 span 打通
- 日志采样（access 全量 → 按比例采样，进一步降本）
- ClickHouse 冷热分层（近期 SSD，历史转 S3）
