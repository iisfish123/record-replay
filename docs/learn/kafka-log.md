# 从 0 到 1：用 Kafka + ClickHouse 给 record-replay 做一套日志系统

> 读者假设：**你从没用过 Kafka，也没用过 ClickHouse**。
> 目标：读完能自己把日志系统搭起来，并且**说得清每一步为什么这么做**。
> 配套实现规格：[`docs/superpowers/specs/2026-11-17-kafka-logging-design.md`](../superpowers/specs/2026-11-17-kafka-logging-design.md)

**整条链路一句话**：`API 产生日志 → Kafka 缓冲 → 消费端批量写入 → ClickHouse 存起来查`。

阅读建议：

| 章节 | 内容 |
|---|---|
| 第 1~3 章 | Kafka「是什么、为什么、关键组件」 |
| 第 4 章 | 本项目怎么用（含 topic 设计与 ClickHouse 速成） |
| 第 5 章 | X-Trace-Id 从哪来到哪去 |
| 第 6 章 | 逐文件代码讲解 + 逐步实现 |
| 第 7~8 章 | 验证、踩坑、速查表 |

**急的话直接跳到第 6.0 节的实操命令**，跑通了再回头看原理。

---

## 第 1 章 Kafka 是什么：先扔掉术语

### 1.1 一句话

> Kafka 是一个**分布式的、可持久化的、可多消费者读取的消息队列**。

拆开三个关键词：

| 关键词 | 含义 | 解决什么问题 |
|---|---|---|
| 消息队列 | 生产者写、消费者读，中间解耦 | 生产端不用等消费端 |
| 可持久化 | 消息默认写到磁盘，留一段时间 | 消费端挂了，消息不丢 |
| 可多消费者读取 | 同一条消息能被多个不同的消费组各读一遍 | 一份数据多种用途 |

### 1.2 用生活类比理解

把它想成一个**中央信箱大楼**：

- **生产者（Producer）**：寄信的人
- **Topic**：大楼里的一个**信箱分类**，比如"访问日志信箱"、"错误日志信箱"
- **Partition（分区）**：每个信箱分类下有 **3 个并排的格子**，信按规则投进不同格子
- **Offset（偏移量）**：格子里的信从 0 开始编号，编号只增不减
- **Broker**：大楼本身（一个 Kafka 服务进程）
- **Consumer（消费者）**：取信的人，手里有个"书签"记录读到第几封了
- **Consumer Group（消费组）**：一组取信的人，**同一封信只由组内一个人取走**

### 1.3 关键认知：Kafka 不是"队列"，是"提交日志"

新手最容易卡住的一点：

> 传统队列：消息被消费后**删除**。
> Kafka：消息**不因消费而删除**，只按**时间/大小**过期删除（retention）。

这意味着：

- 同一份日志，`rr-log-archiver` 消费组读一遍落盘；将来再加一个"错误告警"消费组，可以**从头再读一遍**，互不干扰
- 消费者真正管理的是**自己的 offset**（读到哪了），而不是"这条消息还在不在"

**这就是 Kafka 能同时当"消息队列"和"数据管道"的原因。**

---

## 第 2 章 为什么日志要用 Kafka：和三个替代方案对比

在做技术选型时，问自己："**我到底想解决什么**"。日志系统的需求是：

1. 业务代码写日志**不能慢**（不能因为日志拖垮接口）
2. 日志**不能丢**（尤其是错误日志）
3. 日志要能**被多方消费**（落盘归档、实时告警、将来做检索）
4. 出问题时能**按链路串起来**（traceId）

### 方案对比

| 方案 | 写入速度 | 可靠性 | 多方消费 | 结论 |
|---|---|---|---|---|
| **直接写本地文件**（log4j/winston 落盘） | 快 | 单机，机器挂了就没了 | ❌ 只能本机看 | 简单，但不可扩展 |
| **直接写数据库**（每条日志 INSERT MySQL） | ❌ 慢，且有连接池/事务开销 | 好 | ✅ | 日志写爆业务库，绝对不行 |
| **同步 HTTP 打给日志服务** | ❌ 受网络影响，日志服务抖动 = 业务变慢 | 中 | ✅ | 把日志变成了业务的同步依赖 |
| **Kafka** | ✅ 生产者异步批量，业务几乎无感 | ✅ 副本 + 持久化 | ✅ 消费组天然支持 | **本项目的选择** |

### 为什么 Kafka 快

1. **顺序写磁盘**：不是随机 IO，追加写，速度快到接近内存
2. **零拷贝（sendfile）**：数据从磁盘到网卡不经过用户态
3. **批量 + 压缩**：生产者攒批发送，网络利用率高
4. **分区并行**：3 个分区 = 3 倍并行度

### 结论（本项目）

- **目的**：把"写日志"和"处理日志"解耦
- **原因**：业务只需要"把日志丢出去"（微秒级入内存队列），落盘/检索/告警这些重活由消费者慢慢做
- **结果**：Kafka 挂了，接口照常返回（丢日志）；Kafka 恢复，消费端自动从 offset 续上

---

## 第 3 章 关键组件（每个都讲"是什么 + 本项目怎么用"）

### 3.1 Topic（主题）

- **是什么**：消息的分类/命名空间。物理上是一个目录，里面放着分区的日志段文件
- **本项目**：`rr.api.access` / `rr.api.error` / `rr.task.trace`（见第 4 章）

### 3.2 Partition（分区）

- **是什么**：Topic 的物理切分单元。**分区是 Kafka 的最小并行单位**
- **核心规则**：
  - 消息进哪个分区由 **partition key** 决定：`hash(key) % 分区数`
  - key 相同 → 同分区 → **分区内严格有序**
  - key 为 null → 轮询分配 → **无序**
  - **Kafka 只保证分区内有序，不保证跨分区有序**
- **本项目**：3 个分区，key = `traceId`（理由见 4.3）

> ⚠️ **分区只能增不能减**。而且增分区会改变 `hash(key) % 分区数` 的结果，导致同一个 key 的历史消息和新消息落在不同分区 —— 有序性被破坏。所以**一开始就要把分区数定够**。

### 3.3 Offset（偏移量）

- **是什么**：消息在分区内的**唯一递增编号**，从 0 开始
- **消费者维护的是 offset**：我读到第几条了
- **本项目**：消费端**手动提交 offset**（处理成功才提交），保证不丢

### 3.4 Broker / Cluster

- **是什么**：一个 Kafka 服务进程 = 一个 broker；多个 broker 组成集群
- **本项目**：**单 broker**（一个容器 `record-replay-kafka`）
- **生产差异**：至少 3 broker，`replication.factor=3`，`min.insync.replicas=2`

### 3.5 Replication（副本）

- **是什么**：一个分区可以有 N 个副本，分散在不同 broker；其中 1 个是 Leader（读写），其余是 Follower（同步）
- **本项目**：`replication.factor=1`（单节点，无从复制）
- **代价**：broker 挂了，数据就没了。Demo 可接受

### 3.6 ISR（In-Sync Replicas）

- **是什么**："跟得上 Leader 的副本集合"
- **为什么重要**：`acks=-1`（=all）表示"**所有 ISR 都写入成功才确认**"
- **本项目**：单副本时 ISR 只有自己，`acks=-1` 等价于"Leader 写成功"

### 3.7 Consumer Group（消费组）

- **是什么**：一组消费者共同消费一个 topic，**每个分区只分给组内一个消费者**
- **规则**：
  - 分区数 = 3，组内有 1 个消费者 → 这个人消费 3 个分区
  - 组内有 3 个消费者 → 一人一个分区（并行度最高）
  - 组内有 4 个消费者 → 有 1 个人闲着
- **推论**：**消费并行度上限 = 分区数**（这也解释了为什么分区不能太少）
- **本项目**：消费组 `rr-log-archiver`，将来可以再加一个 `rr-error-alerter` 组，各读各的互不影响

### 3.8 KRaft（Kafka Raft Metadata Mode）

- **是什么**：Kafka 自己管理元数据的模式，**取代 ZooKeeper**
- **历史**：老版本 Kafka 依赖 ZooKeeper 存元数据（topic 列表、ISR 等）
- **现状**：**Kafka 3.3 起 KRaft 可用，4.0 起 ZooKeeper 被完全移除**
- **本项目**：镜像是 `bitnamilegacy/kafka:4.0.0-debian-12-r10`，**必须用 KRaft**，配置里 `KAFKA_CFG_PROCESS_ROLES=broker,controller` 表示这个节点既当 broker 又当 controller（单节点省事）

> 记忆点：**Controller 是 KRaft 里的"大脑"**，负责选主、管理分区状态；`broker` 是"干活的手"，负责存数据。单节点时自己兼任两个角色。

### 3.9 一张组件全景图（对照本项目）

```
Broker: record-replay-kafka (127.0.0.1:9093)   ← 单节点，兼任 controller
│
├── Topic: rr.api.access        (3 分区, 保留 3 天)
│     ├── Partition 0  [offset 0..N]  ← 消息按 hash(traceId)%3 落进来
│     ├── Partition 1  [offset 0..M]
│     └── Partition 2  [offset 0..K]
│
├── Topic: rr.api.error         (3 分区, 保留 30 天)
│
└── Topic: rr.task.trace        (3 分区, 保留 30 天)
        ▲                                   │
        │ produce (acks=-1, key=traceId)    │ consume (groupId=rr-log-archiver)
        │                                   ▼
   NestJS API                          log-consumer
   (KafkaLogSink)                      ├─ 攒批 insert
                                       ▼
                              ClickHouse record-replay-clickhouse:8123
                              record_replay.rr_logs (MergeTree, TTL 30 天)
```

---

## 第 4 章 本项目的设计：为什么这么做

### 4.1 整体链路（先看全貌）

```
手机 App
  │  POST /personas/:id/ask
  ▼
NestJS API
  ├─ TraceMiddleware     → 生成/沿用 traceId，写入 AsyncLocalStorage + 响应头
  ├─ 业务处理
  │    ├─ AccessLogInterceptor → 记录访问日志
  │    ├─ TaskTracer           → 记录关键埋点
  │    └─ AllExceptionsFilter  → 记录异常 + 堆栈
  │
  └─ LogSink（接口）
       └─ KafkaLogSink（内存队列 + 每 500ms 批量 send）
            │
            ▼
      record-replay-kafka:9093          ← 短期缓冲（3~30 天）
            │
            ▼
      log-consumer（手动提交 offset）
       └─ 攒批（500 条 / 1 秒）批量 INSERT
            │
            ▼
      record-replay-clickhouse:8123     ← 最终存储（TTL 30 天）
       └─ 表 record_replay.rr_logs
```

### 4.2 为什么日志**不落本地文件**，走 Kafka

- **目的**：让"产生日志"和"处理日志"彻底解耦
- **原因**：API 进程只做"发送"这一个动作，落库、重试、磁盘满了怎么办，全是消费端的事
- **结果**：
  - API 侧代码简单（`emit()` 入队一行）
  - 消费端可以随时重启、扩容、换实现（JSONL → ClickHouse → ES），API 完全无感
  - 同一份日志可以喂给多个消费组（归档 / 告警 / 报表）

### 4.2.1 为什么不直接把日志写进 ClickHouse，中间为什么要 Kafka

这是被问得最多的问题，答案有 4 条：

| 理由 | 展开 |
|---|---|
| **削峰** | 突发流量（比如压测）下，日志写入速率可能是稳态的几十倍。ClickHouse 直接扛会被打爆；Kafka 先把洪峰吸住，消费端按自己的节奏慢慢写 |
| **解耦** | ClickHouse 需要停机维护时，API 照常写 Kafka，数据不丢，等 ClickHouse 恢复再消费 |
| **多消费者** | 同一份日志，归档组写 ClickHouse，告警组实时扫 error，将来还有报表组。没有 Kafka 就得让 API 挨个通知 |
| **写入模式不匹配** | ClickHouse **极度讨厌高频小批写入**（会产生大量 part 触发 `Too many parts`）。Kafka 天然按批投递，消费端攒批后一次 INSERT 几百条，正好治这个病 |

一句话：**Kafka 是"缓冲池 + 分发器"，ClickHouse 是"仓库"。**

### 4.2.2 为什么是 ClickHouse，而不是 MySQL / ES

| 存储 | 适不适合存日志 | 原因 |
|---|---|---|
| **MySQL** | ❌ | 行存 + B+ 树，适合点查和事务。日志是"写多读少、按时间范围扫、要聚合"，MySQL 会被写爆、聚合也慢 |
| **Elasticsearch** | ✅ 但重 | 全文检索最强，适合"搜关键字"。但资源占用高（JVM + 堆），运维复杂。日志分析多数是**结构化聚合**（耗时、错误率、计数），不一定需要全文检索 |
| **ClickHouse** | ✅✅ | 列存 + 向量化执行，"扫一亿行做 group by"是它的主场。压缩率极高（日志常压到 1/10）。SQL 友好，一条 SQL 就能算 P95 |

**结论**：日志分析 90% 是结构化的聚合统计 → ClickHouse 性价比最高。真需要全文检索再叠加 ES。

### 4.3 为什么 topic 这么设计（你特别要求要讲的部分）

#### 为什么是 3 个 topic，而不是 1 个或 20 个

**决定因素：生命周期不同。**

| Topic | 保留期 | 为什么 |
|---|---|---|
| `rr.api.access` | 3 天 | 每次请求一条，**量大、单价低**。只用于"刚才那个 500 是哪个接口"这类近期排查，过期即焚 |
| `rr.api.error` | 30 天 | **量小、单价高**。报错是事故证据，要留久做复盘、做告警 |
| `rr.task.trace` | 30 天 | 出片链路埋点，**业务核心**，要算各阶段耗时趋势 |

如果把三者塞进一个 topic：

- 保留期只能取最长（30 天）→ access 白占 27 天磁盘
- 消费端要全量拉再过滤 → 浪费带宽和 CPU

如果按"一条日志一个 topic" → topic 数量爆炸，运维成本失控。

**结论**：按 **生命周期 + 用途** 聚类，3 个刚好。

> ⚠️ **重要区分**：这里的 3 天 / 30 天是 **Kafka 侧的保留期**，只决定"消息在 Kafka 磁盘上留多久"。数据真正的长期存储是 **ClickHouse**（`rr_logs` 表统一 TTL 30 天）。因为归档消费组一直在线消费，Kafka 侧 3 天足够安全落库。**别把 Kafka 的保留期当成数据生命周期。**

#### 为什么是 3 个分区（而不是 1 个或 10 个）

三个约束在拉扯：

1. **下限**：至少 2 个才有"并行消费"的意义（1 个分区时消费组再多人也只有 1 个人干活）
2. **上限**：分区不是越多越好，分区多了 → 小文件多、rebalance 变慢、内存开销大
3. **只能增不能减**：宁可有富余，不能不够（见 3.2 的警告）

3 是"能演示并行、又不过度"的折中。

**生产怎么定**：按吞吐估。经验值单分区约 `10MB/s`。假设日志日均 10GB，峰值 5MB/s，3 个分区绰绰有余；若峰值 50MB/s，就该给 6~12 个。

#### 为什么 partition key 用 `traceId`（最关键的一点）

记住一句话：**Kafka 只保证分区内有序。**

- key = `traceId` → 一条链路的 7 条埋点 → `hash(T) % 3` 结果相同 → **全进同一分区** → 消费端读到的顺序 = 产生顺序
- key = null（轮询）→ 7 条埋点散到 3 个分区 → 消费端看到的顺序**是乱的**，无法还原"提问 → 回答 → 合成 → 渲染 → 出片"的时序

**结果**：用 `traceId` 做 key，既实现了"按链路聚合"，又天然获得了"链路内有序"。这是这个设计里最能体现 Kafka 功力的一个点。

### 4.4 为什么用 `LogSink` 接口 + `KafkaLogSink` 实现

这是**依赖倒置原则（DIP）**：

```
AccessLogInterceptor ─┐
AllExceptionsFilter  ─┼─► LogSink（接口）  ◄─┬─ KafkaLogSink（生产）
TaskTracer           ─┘                     └─ InMemoryLogSink（测试）
                                               NoopLogSink（关闭时）
```

- **目的**：业务代码不认识 Kafka
- **原因**：`kafkajs` 是外部依赖，让业务层直接 import 它 = 耦合；而且单测里没法跑真 Kafka
- **结果**：
  - 换中间件只需改 `KafkaLogSink` 一个文件
  - 单测/e2e 注入 `InMemoryLogSink`，**不依赖 Docker、毫秒级、可断言事件序列**
  - 唯一 import `kafkajs` 的文件 = `kafka-log-sink.ts`（+consumer）→ 好找、好维护

### 4.5 为什么"内存队列 + 批量异步"，而不是每条同步 send

| 方案 | 后果 |
|---|---|
| 每条日志 `await producer.send()` | 日志成了业务的**同步依赖**。Kafka 抖动 1 秒，接口就慢 1 秒。**违背"日志不能拖垮业务"** |
| 内存队列 + 500ms 批量 | 业务线程只 `queue.push()`（微秒级），发送在后台定时器里做 |

**代价**：进程崩溃时队列里未 flush 的日志会丢。**这是有意接受的取舍** —— 丢日志可以，接口 500 不行。

### 4.6 降级设计

| 场景 | 行为 |
|---|---|
| Kafka 挂了 | `producer.send` 抛错 → 只打 stderr 计数，**不重试阻塞**，业务无感 |
| 队列堆到 1000 条 | **丢最旧的** + stderr 告警（说明消费端严重跟不上） |
| `LOG_KAFKA_ENABLED=false` | 用 `NoopLogSink`，本地不起 Kafka 也能开发调试 |
| 进程退出 | `onApplicationShutdown` 尽力 flush 一次 |

### 4.7 ClickHouse 速成（新手向）

#### 4.7.1 一句话：列存数据库

MySQL 是**行存**：一行数据（id/name/age）在磁盘上挨着放。
ClickHouse 是**列存**：一列数据（所有 name）在磁盘上挨着放。

```
行存（MySQL）                       列存（ClickHouse）
[1, Alice, 20]                     [1, 2, 3, 4, 5]        ← id 列
[2, Bob,   22]                     [Alice, Bob, ...]      ← name 列
[3, Carol, 20]                     [20, 22, 20, ...]      ← age 列
```

**为什么对日志特别有用**：

| 特性 | 说明 |
|---|---|
| 查一列只读一列 | `SELECT avg(duration_ms)` 只读 `duration_ms` 一列，不用把整行读出来 |
| 同列数据相似 | 相似数据压缩率极高。"ERROR/ERROR/ERROR…" 几乎不占空间 |
| 向量化执行 | 一次处理一批值（而不是一行行循环），CPU 利用率高 |
| 顺序扫描极快 | 配合 `ORDER BY` 的排序键，能直接跳过无关的数据块 |

**代价**：行级更新/删除很慢（日志根本不需要），所以不适合做业务库。

#### 4.7.2 MergeTree：ClickHouse 的引擎

建表必须写 `ENGINE = ???`。日志场景选 `MergeTree`（ClickHouse 最核心的引擎）。

它的工作机制：

1. 每次 `INSERT` 在磁盘上写一个 **part**（不可变的数据块）
2. 后台线程不断把多个小 part **merge** 成更大的 part
3. 查询时对所有 part 并行扫描

> 关键推论：**part 太多会拖垮性能**，所以写入必须攒批（见 4.7.4）。

#### 4.7.3 三个关键子句：ORDER BY / PARTITION BY / TTL

```sql
ENGINE = MergeTree
PARTITION BY toYYYYMMDD(ts)      -- ① 按天分区
ORDER BY (kind, ts)              -- ② 排序键（≈主键）
TTL toDateTime(ts) + INTERVAL 30 DAY   -- ③ 30 天后自动删除
```

| 子句 | 作用 | 类比 |
|---|---|---|
| `PARTITION BY` | 数据按天切成多个目录 | 把书按年份放进不同书架 |
| `ORDER BY` | 分区内数据按这个顺序物理排列，并生成稀疏索引（每 8192 行一个 granule） | 书架里按书名字母排序，找书时能跳读 |
| `TTL` | 到期的数据自动删除（按分区整块删，很快） | 旧书自动下架，不用人工清理 |

**`ORDER BY (kind, ts)` 怎么选**：原则是"把最常用的查询条件放前面"。

- 我们最常见的查询：`WHERE kind='error' AND ts BETWEEN ...` → 所以 `kind, ts` 打头
- 按 `trace_id` 查虽然是高频需求，但 trace_id 基数太高（几乎每行不同），不适合做排序键前缀 → 用**跳数索引**解决：

```sql
INDEX idx_trace_id trace_id TYPE bloom_filter GRANULARITY 1
```

bloom filter 能快速判断"这个 granule 里**肯定没有**这个 trace_id"，从而跳过绝大多数数据。

#### 4.7.4 为什么 ClickHouse 讨厌"高频小批写入"

这是新手最容易踩的坑：

```ts
// ❌ 灾难：一条条 insert
for (const row of rows) {
  await client.insert({ table: 'rr_logs', values: [row], format: 'JSONEachRow' });
}
// 1000 条 → 1000 个 part → ClickHouse 报 "Too many parts" 并拒绝写入
```

```ts
// ✅ 正确：攒批，一次 500 条
await client.insert({ table: 'rr_logs', values: rows.slice(0, 500), format: 'JSONEachRow' });
```

ClickHouse 的写入哲学是：**"批量攒够了再喂给我，我一次吃完"。**
所以我们的 `clickhouse-writer.ts` 必须实现"攒批 + 定时 flush"（500 条 或 1 秒，先到先发）。

#### 4.7.5 `LowCardinality` 是什么

`kind` / `level` / `method` 这类字段，**取值种类少但重复极多**。`LowCardinality(String)` 会把它字典编码（存"编号"而不是"字符串"），查询和存储都更省。这是 ClickHouse 里针对低基数列的标准优化。

#### 4.7.6 本项目建表 DDL 逐行解读

```sql
CREATE TABLE IF NOT EXISTS record_replay.rr_logs
(
    ts                DateTime64(3, 'UTC'),   -- 毫秒精度时间戳，时区 UTC
    level             LowCardinality(String), -- info/warn/error，就 3 种值 → 低基数
    kind              LowCardinality(String), -- access/error/trace/app，4 种值 → 低基数
    trace_id          String,                -- 高基数，配 bloom filter 索引
    msg               String,
    user_id           String DEFAULT '',     -- 稀疏字段统一给空串默认值
    persona_id        String DEFAULT '',
    task_id           String DEFAULT '',
    method            LowCardinality(String) DEFAULT '',
    path              String DEFAULT '',
    status            UInt16 DEFAULT 0,      -- 无符号整数，HTTP 状态码够用
    duration_ms       UInt32 DEFAULT 0,      -- 无符号整数，耗时
    code              LowCardinality(String) DEFAULT '',
    stack             String DEFAULT '',
    event             LowCardinality(String) DEFAULT '',  -- 7 种埋点事件 → 低基数
    stage             LowCardinality(String) DEFAULT '',
    total_duration_ms UInt32 DEFAULT 0,
    meta              String DEFAULT '',     -- 零散字段塞 JSON 字符串，避免频繁改表
    INDEX idx_trace_id trace_id TYPE bloom_filter GRANULARITY 1
)
ENGINE = MergeTree
PARTITION BY toYYYYMMDD(ts)
ORDER BY (kind, ts)
TTL toDateTime(ts) + INTERVAL 30 DAY
SETTINGS index_granularity = 8192;          -- 每 8192 行一个 granule（默认值，显式写出便于理解）
```

设计要点：**固定字段拍平成列**（能索引、能聚合），**零散字段塞 `meta`**（不为了偶尔的字段改表结构）。

#### 4.7.7 几条马上能用的查询

```sql
-- 1) 某条链路的完整时序
SELECT ts, kind, event, stage, duration_ms, msg
FROM record_replay.rr_logs
WHERE trace_id = '0f5b1c2e-...'
ORDER BY ts;

-- 2) 出片各阶段平均耗时 / P95（这就是列存的威力）
SELECT event,
       count()                                 AS cnt,
       round(avg(duration_ms))                 AS avg_ms,
       quantile(0.95)(duration_ms)             AS p95_ms
FROM record_replay.rr_logs
WHERE kind = 'trace' AND ts > now() - INTERVAL 7 DAY
GROUP BY event
ORDER BY cnt DESC;

-- 3) 最近 1 小时的错误 Top 10
SELECT code, count() AS cnt, max(ts) AS last_seen
FROM record_replay.rr_logs
WHERE kind = 'error' AND ts > now() - INTERVAL 1 HOUR
GROUP BY code
ORDER BY cnt DESC
LIMIT 10;

-- 4) 出片成功率
SELECT
  countIf(event='task.video.ready') AS ok,
  countIf(event='task.failed')      AS failed,
  round(ok / (ok + failed) * 100, 1) AS success_rate
FROM record_replay.rr_logs
WHERE kind = 'trace' AND ts > now() - INTERVAL 1 DAY;
```

> 这几条 SQL 一眼看出区别：**同样的分析，SQL 是声明式的，而 Kafka 里只能靠消费者自己算。**

---

## 第 5 章 X-Trace-Id 从哪来、到哪去（你特别要求要讲明白的部分）

### 5.1 为什么需要 traceId

一次用户提问，后端会产生这些日志：

```
access: POST /personas/p1/ask 201 42ms
trace:  task.created
trace:  task.answered
trace:  task.tts.done
trace:  task.render.submitted
trace:  task.render.polled  ...
trace:  task.video.ready
```

如果这些日志没有共同标识，出事时你只能靠时间猜。**traceId 就是把它们串起来的那根线。**

### 5.2 来源（So → 从哪进来）

```
客户端请求
   │
   ├─ 请求头有 X-Trace-Id 且合法（1~64 字符）？ ──是──► 沿用
   │
   └───────────────────────────不是──────────────► randomUUID() 生成
```

两个设计点：

1. **为什么"有就沿用"**：手机 App、网关、上游服务如果已经生成了 traceId，后端沿用才能把**跨服务**的链路拼完整。这是行业惯例
2. **为什么要校验 1~64 字符**：防止有人塞超长串或带换行的内容进来污染日志（日志注入）。不合法就当没有，重新生成

### 5.3 去向（Egress → 到哪去，一共 4 条路）

#### 去向 ①：响应头 `X-Trace-Id`

```http
HTTP/1.1 201 Created
X-Trace-Id: 0f5b1c2e-8a3d-4f1b-9c2e-7d6a5b4c3d2e
```

**为什么**：用户遇到问题时，"错误提示里显示的编号"可以直接报给客服/开发，一秒定位。

#### 去向 ②：AsyncLocalStorage

```ts
als.run({ traceId }, () => next());
```

**为什么**：NestJS 是异步的，普通变量跨不了 `await`。`AsyncLocalStorage` 让本次请求调用栈内**任意函数**都能 `getTraceId()`，不用层层传参。

对比一下：

```ts
// ❌ 全局变量：并发请求互相污染
globalTraceId = id;

// ❌ 层层传参：provider 接口全要改
this.chat.answer(persona, question, traceId);

// ✅ AsyncLocalStorage：零侵入
getTraceId();  // 在任何地方都能拿到当前请求的 traceId
```

#### 去向 ③：数据库 `render_tasks.trace_id`

**这是最容易漏掉、也最关键的一条。**

时序问题：

```
t0:  POST /personas/:id/ask
t1:  TaskService.create() 落库
t2:  返回 { taskId }    ← HTTP 请求结束，ALS 上下文销毁
t3:  后台 void this.process(taskId) 开始跑 ← 此时 ALS 是空的！
t4:  ... 出片 60 秒 ...
```

t3 之后的日志如果不管，就会**丢失 traceId**。解决办法：

1. t1 时把 traceId **写进 `render_tasks.trace_id` 列**
2. t3 进入 `process()` 时，从数据库读出 task，用 `als.run({ traceId: task.traceId }, ...)` **重建上下文**

**结果**：HTTP 请求和后台异步任务，用同一个 traceId 串起来了。

#### 去向 ④：Kafka 消息

两处用：

1. **消息体字段** `{ "traceId": "..." }` → 用于检索（`jq 'select(.traceId=="T")'`）
2. **作为 partition key** → 保证同一条链路的所有日志进同一分区 → 有序

### 5.4 一张图说清来源与去向

```
                          ┌──────────────────────────────────────┐
   客户端请求头           │  X-Trace-Id 有则沿用，无则 UUID 生成   │
   X-Trace-Id?  ─────────►│                                      │
                          └───────────────┬──────────────────────┘
                                          │
                    ┌─────────────────────┼─────────────────────┐
                    ▼                     ▼                     ▼
            ① 响应头回写          ② AsyncLocalStorage      ③ 数据库
            X-Trace-Id           （请求内任意地方可取）    render_tasks.trace_id
                    ▲                                           │
                    │                                           │ 异步任务开始时
                    │                                           ▼ 重建 ALS 上下文
                    │                                    ┌──────────────┐
                    │                                    │ task.process │
                    │                                    └──────┬───────┘
                    │                                           │
                    └───────────────────────────────────────────┘
                                          │
                                          ▼
                                    ④ Kafka 消息
                                    value.traceId 字段
                                    + partition key
```

---

## 第 6 章 项目代码讲解 + 逐步实现

### 6.0 先装环境（动手第一步）

```bash
cd /Users/lkz/202507/record-replay

# 1) 起 Kafka 与 ClickHouse（镜像本地已有，pull_policy: never，不会去拉）
docker compose -f docker/docker-compose.yml up -d kafka kafka-init clickhouse

# 2) 确认起来
docker ps | grep -E 'record-replay-(kafka|clickhouse)'

# 3) 查看 topic（kafka-init 容器建完就有 3 个）
docker exec record-replay-kafka \
  /opt/bitnami/kafka/bin/kafka-topics.sh --bootstrap-server 127.0.0.1:9092 --list

# 4) 确认 ClickHouse 活着（返回 Ok）
curl -s http://127.0.0.1:8123/ping

# 5) 装依赖（Kafka 客户端 + ClickHouse 官方客户端）
pnpm --filter @record-replay/api add kafkajs @clickhouse/client
```

> ⚠️ **端口注意**：
> - 本机 9092 已被 `li-dify-kafka` 占用，所以 Kafka 映射到 **`127.0.0.1:9093`**
>   - **宿主机上的代码**（NestJS / consumer）用 `127.0.0.1:9093`
>   - **容器内部**的命令（`docker exec`）用容器内的 `127.0.0.1:9092`
> - ClickHouse HTTP 映射到 **`127.0.0.1:8123`**，宿主机代码与 `docker exec` 都用 8123

### 6.1 第一步：抽象层 `log-sink.ts`

**目的**：定义"日志往哪去"的接口，业务层只认接口。

```ts
// apps/api/src/log/log-sink.ts
export type LogKind = 'access' | 'error' | 'trace' | 'app';

export interface LogRecord {
  ts: string;
  level: 'info' | 'warn' | 'error';
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
  event?: string;
  stage?: string;
  totalDurationMs?: number;
  meta?: Record<string, unknown>;
}

export interface LogSink {
  /** 只入队，同步非阻塞，永不抛异常 */
  emit(record: LogRecord): void;
}

/** DI 注入令牌：业务层只依赖这个 token + LogSink 接口，不认识任何具体实现 */
export const LOG_SINK = Symbol('LOG_SINK');
```

**为什么 `emit` 设计成同步**：见 4.5 —— 日志不能成为业务的 await 依赖。

### 6.2 第二步：`trace-context.ts`（AsyncLocalStorage）

```ts
// apps/api/src/log/trace-context.ts
import { AsyncLocalStorage } from 'node:async_hooks';

export interface TraceContext {
  traceId: string;
}

export const traceStorage = new AsyncLocalStorage<TraceContext>();

export function getTraceId(): string {
  return traceStorage.getStore()?.traceId ?? '-';
}

export function runWithTrace<T>(traceId: string, fn: () => T): T {
  return traceStorage.run({ traceId }, fn);
}
```

**关键点**：`getTraceId()` 兜底返回 `'-'`。为什么？因为**后台定时任务、启动阶段**没有 HTTP 上下文，此时不应该抛错，用 `'-'` 标记"无链路"。

### 6.3 第三步：`trace.middleware.ts`

```ts
// apps/api/src/log/trace.middleware.ts
import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { traceStorage } from './trace-context';

const MAX_LEN = 64;

/** 上游传来的 traceId 只在合法时沿用，避免日志注入 */
function normalize(raw: unknown): string {
  if (typeof raw !== 'string') return randomUUID();
  const v = raw.trim();
  if (v.length === 0 || v.length > MAX_LEN) return randomUUID();
  return v;
}

@Injectable()
export class TraceMiddleware implements NestMiddleware {
  use(req: any, res: any, next: () => void): void {
    const traceId = normalize(req.headers['x-trace-id']);
    res.setHeader('X-Trace-Id', traceId);      // 去向 ①
    traceStorage.run({ traceId }, () => next()); // 去向 ②
  }
}
```

**为什么用 Middleware 而不是 Interceptor**：traceId 必须**尽可能早**生成，早于一切拦截器和守卫。Middleware 是最外层。

### 6.4 第四步：`access-log.interceptor.ts`

```ts
// apps/api/src/log/access-log.interceptor.ts
import { CallHandler, ExecutionContext, Inject, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { LOG_SINK, type LogSink } from './log-sink';
import { getTraceId } from './trace-context';

@Injectable()
export class AccessLogInterceptor implements NestInterceptor {
  constructor(@Inject(LOG_SINK) private readonly sink: LogSink) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (ctx.getType() !== 'http') return next.handle();

    const start = Date.now();
    const req = ctx.switchToHttp().getRequest();
    const res = ctx.switchToHttp().getResponse();
    const record = (status: number) =>
      this.sink.emit({
        ts: new Date().toISOString(),
        level: status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info',
        kind: 'access',
        traceId: getTraceId(),
        msg: `${req.method} ${req.originalUrl} ${status} ${Date.now() - start}ms`,
        method: req.method,
        path: req.originalUrl,
        status,
        durationMs: Date.now() - start,
        userId: req.user?.sub,
      });

    return next.handle().pipe(
      tap(() => record(res.statusCode)),           // 成功
      catchError((err) => {                         // 失败也记一条
        record(err?.status ?? 500);
        throw err;
      }),
    );
  }
}
```

### 6.5 第五步：`all-exceptions.filter.ts`

```ts
// apps/api/src/log/all-exceptions.filter.ts
import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Inject } from '@nestjs/common';
import { LOG_SINK, type LogSink } from './log-sink';
import { getTraceId } from './trace-context';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(@Inject(LOG_SINK) private readonly sink: LogSink) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse();
    const traceId = getTraceId();
    const isHttp = exception instanceof HttpException;
    const status = isHttp ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;

    // 客户端可见的 message：未知异常一律用通用文案，不泄漏内部细节
    const raw = isHttp ? exception.getResponse() : null;
    const message = isHttp
      ? (typeof raw === 'string' ? raw : (raw as any)?.message ?? exception.message)
      : '服务器内部错误';
    const code = (typeof raw === 'object' && raw && (raw as any).code) || defaultCode(status);

    // 堆栈只进日志，绝不回传
    this.sink.emit({
      ts: new Date().toISOString(),
      level: 'error',
      kind: 'error',
      traceId,
      msg: `[${code}] ${message}`,
      code,
      stack: exception instanceof Error ? exception.stack : undefined,
      path: host.switchToHttp().getRequest().originalUrl,
      method: host.switchToHttp().getRequest().method,
    });

    res.status(status).json({ code, message, traceId });
  }
}

function defaultCode(status: number): string {
  return { 400: 'BAD_REQUEST', 401: 'UNAUTHORIZED', 403: 'FORBIDDEN',
           404: 'NOT_FOUND', 429: 'TOO_MANY_REQUESTS' }[status] ?? 'INTERNAL_ERROR';
}
```

**为什么必须 `@Catch()` 空参**：空参表示"捕获所有异常"，才能兜住非 `HttpException` 的裸 Error。

### 6.6 第六步：`task-tracer.ts`（关键埋点）

```ts
// apps/api/src/log/task-tracer.ts
import { Inject, Injectable } from '@nestjs/common';
import { LOG_SINK } from './log.module';
import type { LogSink } from './log-sink';
import { getTraceId } from './trace-context';

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

@Injectable()
export class TaskTracer {
  constructor(@Inject(LOG_SINK) private readonly sink: LogSink) {}

  private emit(event: LogEvent, stage: string, taskId: string, extra: Record<string, unknown> = {}) {
    this.sink.emit({
      ts: new Date().toISOString(),
      level: event === LogEvent.TaskFailed ? 'error' : 'info',
      kind: 'trace',
      traceId: getTraceId(),
      msg: `${event} task=${taskId}`,
      taskId,
      event,
      stage,
      ...extra,
    });
  }

  created(taskId: string, personaId: string, question: string) {
    this.emit(LogEvent.TaskCreated, 'pending', taskId, { personaId, meta: { questionChars: question.length } });
  }
  answered(taskId: string, durationMs: number, answerChars: number) {
    this.emit(LogEvent.TaskAnswered, 'answering', taskId, { durationMs, meta: { answerChars } });
  }
  ttsDone(taskId: string, durationMs: number, audioBytes: number) {
    this.emit(LogEvent.TaskTtsDone, 'tts', taskId, { durationMs, meta: { audioBytes } });
  }
  renderSubmitted(taskId: string, durationMs: number, remoteTaskId: string) {
    this.emit(LogEvent.TaskRenderSubmitted, 'rendering', taskId, { durationMs, meta: { remoteTaskId } });
  }
  renderPolled(taskId: string, round: number, remoteStatus: string) {
    this.emit(LogEvent.TaskRenderPolled, 'rendering', taskId, { meta: { round, remoteStatus } });
  }
  videoReady(taskId: string, totalDurationMs: number) {
    this.emit(LogEvent.TaskVideoReady, 'done', taskId, { totalDurationMs });
  }
  failed(taskId: string, stage: string, error: string, totalDurationMs: number, stack?: string) {
    this.emit(LogEvent.TaskFailed, stage, taskId, { totalDurationMs, stack, meta: { error } });
  }
}
```

### 6.7 第七步：把埋点插进 `task.service.ts`

```ts
// apps/api/src/task/task.service.ts（关键改动）
async create(persona: Persona, question: string): Promise<RenderTask> {
  const traceId = getTraceId();                 // 捕获当前请求的 traceId
  const task = await this.tasks.save(
    this.tasks.create({ personaId: persona.id, question, status: 'pending', traceId }),
  );
  this.tracer.created(task.id, persona.id, question);

  void this.process(task.id, persona).catch((err) => {
    this.logger.error(`任务 ${task.id} 失败: ${err.message}`);
  });
  return task;
}

private async process(taskId: string, persona: Persona): Promise<void> {
  const task = await this.tasks.findOne({ where: { id: taskId } });
  if (!task) return;

  // ★ 关键：后台异步任务开始时，用落库的 traceId 重建 ALS 上下文
  return runWithTrace(task.traceId ?? '-', async () => {
    const startedAt = task.createdAt.getTime();
    let stage = 'pending';
    try {
      stage = 'answering';
      await this.tasks.update(taskId, { status: 'answering' });
      let t = Date.now();
      const answerText = await this.chat.answer({ avatarUrl: persona.avatarUrl, voiceSampleUrl: persona.voiceSampleUrl }, task.question);
      this.tracer.answered(taskId, Date.now() - t, answerText.length);
      await this.tasks.update(taskId, { answerText });

      stage = 'tts';
      await this.tasks.update(taskId, { status: 'tts' });
      if (!persona.speakerId) throw new Error('人格音色尚未就绪');
      t = Date.now();
      const { audio, durationMs } = await this.voice.synthesize(answerText, persona.speakerId);
      const audioUrl = await this.saveFile('audio', `${randomUUID()}.mp3`, audio);
      this.tracer.ttsDone(taskId, Date.now() - t, audio.length);
      await this.tasks.update(taskId, { audioUrl });

      stage = 'rendering';
      await this.tasks.update(taskId, { status: 'rendering' });
      t = Date.now();
      const remoteTaskId = await this.render.submit(persona.avatarUrl, audioUrl, Math.ceil(durationMs / 1000) || undefined);
      this.tracer.renderSubmitted(taskId, Date.now() - t, remoteTaskId);

      const videoUrl = await this.pollAndPersist(taskId, remoteTaskId);
      await this.tasks.update(taskId, { status: 'done', videoUrl, finishedAt: new Date() });
      this.tracer.videoReady(taskId, Date.now() - startedAt);
    } catch (err: any) {
      await this.tasks.update(taskId, { status: 'failed', error: String(err?.message ?? err), finishedAt: new Date() });
      this.tracer.failed(taskId, stage, String(err?.message ?? err), Date.now() - startedAt, err?.stack);
      throw err;
    }
  });
}
```

`pollAndPersist` 里每轮加一条 `this.tracer.renderPolled(taskId, i, result.status)`。

**这一段是本次改造的灵魂**：`runWithTrace(task.traceId, ...)` 让"早就脱离开 HTTP 上下文的后台任务"重新拿回链路身份。

### 6.8 第八步：`kafka-log-sink.ts`

```ts
// apps/api/src/log/kafka-log-sink.ts —— 全项目唯一 import 'kafkajs' 的业务文件
import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { Kafka, Producer } from 'kafkajs';
import type { LogKind, LogRecord, LogSink } from './log-sink';

const TOPIC_BY_KIND: Record<LogKind, string> = {
  access: 'rr.api.access',
  error: 'rr.api.error',
  trace: 'rr.task.trace',
  app: 'rr.api.access',
};

@Injectable()
export class KafkaLogSink implements LogSink, OnApplicationShutdown {
  private readonly logger = new Logger(KafkaLogSink.name);
  private readonly queue: LogRecord[] = [];
  private timer?: NodeJS.Timeout;
  private flushing = false;
  private producer: Producer | null = null;

  constructor(
    private readonly brokers: string[],
    private readonly clientId: string,
    private readonly flushIntervalMs = 500,
    private readonly batchMax = 200,
    private readonly queueMax = 1000,
  ) {}

  async connect(): Promise<void> {
    const kafka = new Kafka({ clientId: this.clientId, brokers: this.brokers });
    this.producer = kafka.producer({ idempotent: true, maxInFlightRequests: 1 });
    await this.producer.connect();
    this.timer = setInterval(() => void this.flush(), this.flushIntervalMs);
    this.timer.unref?.();
  }

  /** 只入队；同步非阻塞；永不抛异常 */
  emit(record: LogRecord): void {
    if (this.queue.length >= this.queueMax) {
      this.queue.shift();                                    // 丢最旧
      process.stderr.write(`[log] queue overflow(${this.queueMax}), dropped oldest\n`);
    }
    this.queue.push(record);
  }

  private async flush(): Promise<void> {
    if (this.flushing || this.queue.length === 0 || !this.producer) return;
    this.flushing = true;
    const batch = this.queue.splice(0, this.batchMax);
    try {
      const byTopic = new Map<string, LogRecord[]>();
      for (const r of batch) {
        const t = TOPIC_BY_KIND[r.kind];
        (byTopic.get(t) ?? byTopic.set(t, []).get(t)!).push(r);
      }
      for (const [topic, records] of byTopic) {
        await this.producer.send({
          topic,
          acks: -1,
          messages: records.map((r) => ({
            key: r.traceId,                                    // 分区键 = traceId → 同链路同分区 → 有序
            value: JSON.stringify(r),
          })),
        });
      }
    } catch (err: any) {
      process.stderr.write(`[log] kafka send failed: ${err?.message ?? err}\n`); // 只告警，不重试阻塞
    } finally {
      this.flushing = false;
    }
  }

  /** 退出前尽力 flush 一次 */
  async onApplicationShutdown(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.flush();
    await this.producer?.disconnect().catch(() => undefined);
  }
}
```

### 6.9 第九步：`log.module.ts`（按开关绑定实现）

```ts
// apps/api/src/log/log.module.ts
import { Global, Module } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { LOG_SINK, type LogSink } from './log-sink';
import { KafkaLogSink } from './kafka-log-sink';
import { NoopLogSink } from './noop-log-sink';
import { TaskTracer } from './task-tracer';
import { TraceMiddleware } from './trace.middleware';
import { AccessLogInterceptor } from './access-log.interceptor';
import { AllExceptionsFilter } from './all-exceptions.filter';

export { LOG_SINK };

@Global()
@Module({
  providers: [
    {
      provide: LOG_SINK,
      inject: [ConfigService],
      useFactory: (cfg: ConfigService): LogSink => {
        if (!cfg.get<boolean>('log.kafkaEnabled')) return new NoopLogSink();
        const sink = new KafkaLogSink(
          cfg.get<string>('log.brokers')!.split(','),
          cfg.get<string>('log.clientId')!,
          cfg.get<number>('log.flushIntervalMs'),
        );
        void sink.connect();     // 异步连接，不阻塞启动
        return sink;
      },
    },
    TraceMiddleware,
    TaskTracer,
    { provide: APP_INTERCEPTOR, useClass: AccessLogInterceptor },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
  exports: [LOG_SINK, TaskTracer, TraceMiddleware],
})
export class LogModule {}
```

> 说明三点：
> 1. `LogSink` 是**类型**，用 `import { type LogSink }` 引入，编译后会被擦除，不产生运行时依赖
> 2. `LOG_SINK` 是**运行时值**（Symbol 令牌），必须正常 import，DI 靠它匹配
> 3. `KafkaLogSink.connect()` 是异步的，用 `void` 触发，**不阻塞应用启动**；连接失败也不影响 API 起来（降级见 4.6）

### 6.10 第十步：`main.ts` 挂载

```ts
// apps/api/src/main.ts（改动部分）
const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
const traceMiddleware = app.get(TraceMiddleware);
app.use((req, res, next) => traceMiddleware.use(req, res, next));
```

`bufferLogs: true` 让启动期日志先缓存，等自定义 logger 就绪后再输出，避免日志丢失。

### 6.11 第十一步：消费端 `consumer/main.ts`

先定义 schema 常量（DDL 只写一次，消费端自举 + 人工排查都复用它）：

```ts
// apps/api/src/log/consumer/clickhouse-schema.ts
export const CREATE_DATABASE_SQL = `CREATE DATABASE IF NOT EXISTS record_replay`;

export const CREATE_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS record_replay.rr_logs
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
SETTINGS index_granularity = 8192`;
```

再写攒批写入器（这是消费端的核心）：

```ts
// apps/api/src/log/consumer/clickhouse-writer.ts
import { createClient, type ClickHouseClient } from '@clickhouse/client';

/** LogRecord（下划线化）→ rr_logs 一行 */
function toRow(r: any) {
  return {
    ts: r.ts,                       // ISO 字符串，靠 best_effort 解析
    level: r.level,
    kind: r.kind,
    trace_id: r.traceId,
    msg: r.msg,
    user_id: r.userId ?? '',
    persona_id: r.personaId ?? '',
    task_id: r.taskId ?? '',
    method: r.method ?? '',
    path: r.path ?? '',
    status: r.status ?? 0,
    duration_ms: r.durationMs ?? 0,
    code: r.code ?? '',
    stack: r.stack ?? '',
    event: r.event ?? '',
    stage: r.stage ?? '',
    total_duration_ms: r.totalDurationMs ?? 0,
    meta: r.meta ? JSON.stringify(r.meta) : '',   // 对象序列化成字符串
  };
}

export class ClickHouseWriter {
  private readonly client: ClickHouseClient;
  private buffer: any[] = [];
  private timer?: NodeJS.Timeout;
  private flushing = false;

  constructor(
    url: string,
    private readonly database: string,
    private readonly user: string,
    private readonly password: string,
    private readonly batchMax = 500,
    private readonly flushIntervalMs = 1000,
    private readonly maxRetry = 3,
  ) {
    this.client = createClient({
      url,
      username: user,
      password,
      database,
      clickhouse_settings: { date_time_input_format: 'best_effort' }, // 让 ISO 字符串可直接解析
    });
  }

  /** 幂等建库建表 */
  async ensureSchema(dbSql: string, tableSql: string): Promise<void> {
    await this.client.command({ query: dbSql });
    await this.client.command({ query: tableSql });
  }

  /** 入缓冲；满 batchMax 立即 flush */
  async insert(records: any[]): Promise<void> {
    this.buffer.push(...records.map(toRow));
    if (this.buffer.length >= this.batchMax) await this.flush();
    else if (!this.timer) this.timer = setTimeout(() => void this.flush(), this.flushIntervalMs);
  }

  /** 发送缓冲内容；失败重试 maxRetry 次，最终失败则抛出（上层据此不提交 offset） */
  async flush(): Promise<void> {
    if (this.flushing || this.buffer.length === 0) return;
    this.flushing = true;
    if (this.timer) { clearTimeout(this.timer); this.timer = undefined; }

    const batch = this.buffer.splice(0, this.batchMax);
    for (let attempt = 1; ; attempt++) {
      try {
        await this.client.insert({ table: 'rr_logs', values: batch, format: 'JSONEachRow' });
        break;
      } catch (err) {
        if (attempt >= this.maxRetry) {
          this.buffer.unshift(...batch);      // 放回去，等下一批重投
          this.flushing = false;
          throw err;
        }
        await new Promise((r) => setTimeout(r, 200 * attempt));  // 退避
      }
    }
    this.flushing = false;
    if (this.buffer.length > 0) await this.flush();   // 还有残留就继续
  }

  async close(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    await this.flush();
    await this.client.close();
  }
}
```

最后是进程入口（消费 → 攒批 → 写库 → 手动提交 offset）：

```ts
// apps/api/src/log/consumer/main.ts
import { Kafka } from 'kafkajs';
import { ClickHouseWriter } from './clickhouse-writer';
import { CREATE_DATABASE_SQL, CREATE_TABLE_SQL } from './clickhouse-schema';

const TOPICS = ['rr.api.access', 'rr.api.error', 'rr.task.trace'];

async function main() {
  const writer = new ClickHouseWriter(
    process.env.CLICKHOUSE_URL ?? 'http://127.0.0.1:8123',
    process.env.CLICKHOUSE_DATABASE ?? 'record_replay',
    process.env.CLICKHOUSE_USER ?? 'default',
    process.env.CLICKHOUSE_PASSWORD ?? '',
  );
  await writer.ensureSchema(CREATE_DATABASE_SQL, CREATE_TABLE_SQL);   // 消费端自举建表

  const kafka = new Kafka({
    clientId: 'rr-log-archiver',
    brokers: (process.env.KAFKA_BROKERS ?? '127.0.0.1:9093').split(','),
  });
  const consumer = kafka.consumer({ groupId: 'rr-log-archiver' });
  await consumer.connect();
  await consumer.subscribe({ topics: TOPICS, fromBeginning: false });

  await consumer.run({
    eachBatchAutoResolve: false,          // ★ 手动提交：写库成功才提交 offset
    eachBatch: async ({ batch, resolveOffset, heartbeat, commitOffsetsIfNecessary }) => {
      const records = batch.messages
        .filter((m) => m.value)
        .map((m) => JSON.parse(m.value!.toString()));

      await writer.insert(records);       // 写库失败会抛错 → 后面不执行 → offset 不提交 → 下次重投

      for (const m of batch.messages) resolveOffset(m.offset);
      await heartbeat();
      await commitOffsetsIfNecessary();
    },
  });

  const shutdown = async () => { await consumer.disconnect(); await writer.close(); process.exit(0); };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => { process.stderr.write(String(err)); process.exit(1); });
```

`package.json` 加：

```json
"log:consumer": "ts-node -r tsconfig-paths/register src/log/consumer/main.ts"
```

> **注意"手动提交"与"写库失败"的配合**：`writer.insert()` 抛错时，`resolveOffset` / `commitOffsetsIfNecessary` 都不会执行 → Kafka 认为这批没消费成功 → 重启或 rebalance 后会重新投递 → **日志不丢**（代价是可能重复，见第 7 章）。

---

## 第 7 章 验证与常见坑

### 7.1 端到端验证

```bash
# 窗口 1：起消费者
pnpm --filter @record-replay/api log:consumer

# 窗口 2：起 API（略）

# 窗口 3：手机走一次「提问 → 出片」，然后查最新一条链路的完整时序
docker exec -it record-replay-clickhouse clickhouse-client --query "
SELECT ts, kind, event, stage, duration_ms, msg
FROM record_replay.rr_logs
WHERE kind = 'trace'
ORDER BY ts DESC
LIMIT 20 FORMAT Vertical"
```

**期望**：看到 7 条事件，`trace_id` 全部相同，顺序为
`task.created → task.answered → task.tts.done → task.render.submitted → task.render.polled* → task.video.ready`

顺手取一条 traceId，验证"一键串起全链路"：

```bash
TRACE_ID=$(docker exec record-replay-clickhouse clickhouse-client --query \
  "SELECT trace_id FROM record_replay.rr_logs WHERE kind='trace' ORDER BY ts DESC LIMIT 1")

docker exec record-replay-clickhouse clickhouse-client --query "
SELECT ts, kind, event, stage, duration_ms, msg
FROM record_replay.rr_logs
WHERE trace_id = '$TRACE_ID'
ORDER BY ts FORMAT Vertical"
```

验证一条 HTTP 请求的响应头：

```bash
curl -i http://127.0.0.1:3000/health | grep -i x-trace-id
```

### 7.2 常见坑清单

| 坑 | 现象 | 解法 |
|---|---|---|
| **ADVERTISED_LISTENERS 写错** | 宿主机上的 API 连不上 / 连上就断 | 必须是宿主机视角的 `127.0.0.1:9093`，不能写容器名 `kafka` |
| **端口冲突** | 起不来 | 本机 9092 被 `li-dify-kafka` 占用 → 映射 9093 |
| **kafkajs 连不上但 kafka 已起** | `ECONNREFUSED` | 差在 healthcheck 未就绪，等 10 秒 |
| **topic 不存在** | `UNKNOWN_TOPIC_OR_PARTITION` | `AUTO_CREATE_TOPICS_ENABLE=false` 时不会自动建 → 靠 `kafka-init` 或 `admin.createTopics` |
| **日志顺序错乱** | 消费端看到的顺序和产生顺序不一致 | 检查 partition key 是否真的传了 `traceId`（key 为 null 会轮询分散） |
| **重复写库** | 同一条日志在 ClickHouse 出现两次 | at-least-once 的正常现象；查询侧按 `trace_id+ts+event` 去重，或换 `ReplacingMergeTree` |
| **看不到后台任务日志** | 出片埋点 traceId 是 `-` | 忘了在 `process()` 里 `runWithTrace(task.traceId, ...)` 重建上下文 |
| **进程退出丢日志** | 最后 500ms 的日志没了 | 正常（内存队列）；`onApplicationShutdown` 已尽力 flush |
| **`Too many parts`** | ClickHouse 拒绝写入 | 写入频率过高 → 必须攒批（`CH_BATCH_MAX` 调大或 `CH_FLUSH_INTERVAL_MS` 调大） |
| **时间戳差 8 小时** | 查出来的 `ts` 比本地时间早 8 小时 | ClickHouse 列是 UTC，查询时用 `toTimeZone(ts,'Asia/Shanghai')` 转换，别改列的时区 |
| **`meta` 查询不出来** | `meta` 是一坨转义 JSON | 存的是 JSON 字符串；查询用 `JSONExtractString(meta,'xxx')` |
| **数据卷权限** | ClickHouse 容器起不来 | Bitnami 镜像按 UID 1001 运行，`chown -R 1001 ./clickhouse_data` |
| **`kafka_data` 目录权限** | 容器起不来 | 同上，`chown -R 1001 ./kafka_data` |

### 7.3 生产与 Demo 的差异（心里要有数）

| 维度 | 本项目（Demo） | 生产 |
|---|---|---|
| Broker 数 | 1 | ≥ 3 |
| 副本因子 | 1 | 3 |
| `min.insync.replicas` | 1 | 2 |
| 认证 | PLAINTEXT（无认证） | SASL_SSL |
| topic 创建 | `kafka-init` 容器 | IaC / 运维平台统一管控 |
| ClickHouse | 单节点、空密码 | 集群（分片 + 副本）、认证、网络隔离 |
| ClickHouse 表结构 | `MergeTree` 单表 | 冷热分层 / `ReplicatedMergeTree` / 物化视图预聚合 |
| 监控 | 无 | Kafka Lag 监控、ClickHouse 慢查询、Grafana 看板 |
| 消费者 | 单实例 | 多实例 + 消费组自动负载均衡 |

**记住**：Demo 里这些"简化"不是不懂，而是**有意为之的取舍**。面试/评审时能说清"为什么这里可以简化、生产该怎么补"，比堆配置更有说服力。

---

## 第 8 章 一张速查表（贴在墙上）

```bash
# 起 Kafka + ClickHouse
docker compose -f docker/docker-compose.yml up -d kafka kafka-init clickhouse

# ---------- Kafka ----------
# 列 topic
docker exec record-replay-kafka /opt/bitnami/kafka/bin/kafka-topics.sh --bootstrap-server 127.0.0.1:9092 --list

# 看 topic 详情（分区、副本、保留期）
docker exec record-replay-kafka /opt/bitnami/kafka/bin/kafka-topics.sh --bootstrap-server 127.0.0.1:9092 --describe --topic rr.task.trace

# 手动生产一条（调试用）
docker exec -it record-replay-kafka /opt/bitnami/kafka/bin/kafka-console-producer.sh --bootstrap-server 127.0.0.1:9092 --topic rr.task.trace

# 从头发消费（看历史）
docker exec -it record-replay-kafka /opt/bitnami/kafka/bin/kafka-console-consumer.sh --bootstrap-server 127.0.0.1:9092 --topic rr.task.trace --from-beginning

# 看消费组 lag（消费有没有跟上）
docker exec record-replay-kafka /opt/bitnami/kafka/bin/kafka-consumer-groups.sh --bootstrap-server 127.0.0.1:9092 --describe --group rr-log-archiver

# ---------- ClickHouse ----------
# 存活检查
curl -s http://127.0.0.1:8123/ping          # 期望：Ok

# 看表结构
docker exec -it record-replay-clickhouse clickhouse-client --query "SHOW CREATE TABLE record_replay.rr_logs FORMAT TSVRaw"

# 最近 10 条日志
docker exec -it record-replay-clickhouse clickhouse-client --query "
SELECT ts, kind, event, trace_id, msg FROM record_replay.rr_logs ORDER BY ts DESC LIMIT 10 FORMAT Vertical"

# 按 traceId 查全链路
docker exec -it record-replay-clickhouse clickhouse-client --query "
SELECT ts, kind, event, stage, duration_ms, msg FROM record_replay.rr_logs
WHERE trace_id='<把traceId粘这里>' ORDER BY ts FORMAT Vertical"

# 各阶段耗时 P95
docker exec -it record-replay-clickhouse clickhouse-client --query "
SELECT event, count() c, round(avg(duration_ms)) avg_ms, quantile(0.95)(duration_ms) p95_ms
FROM record_replay.rr_logs WHERE kind='trace' GROUP BY event ORDER BY c DESC"

# 表占用空间（体验一下列存的压缩率）
docker exec -it record-replay-clickhouse clickhouse-client --query "
SELECT formatReadableSize(sum(bytes_on_disk)) AS size, sum(rows) AS rows
FROM system.parts WHERE database='record_replay' AND table='rr_logs' AND active"
```

**核心概念一句话回顾（Kafka）**：

- **Topic** = 分类；**Partition** = 并行单元（**只增不减**）
- **Key 相同 → 同分区 → 分区内有序**（所以 key = traceId）
- **Offset** = 消费者的书签；**消费组** = 分区只分给组内一人
- **`acks=-1`** = 所有 ISR 写成功才确认；**幂等生产者**防重复
- **KRaft** = 不需要 ZooKeeper 的 Kafka（4.0 起 ZooKeeper 已移除）
- **保留期（retention）** 才是消息的死因，不是"被消费"

**核心概念一句话回顾（ClickHouse）**：

- **列存** = 查一列只读一列；**压缩率极高**
- **MergeTree** = 最核心的表引擎；每次 INSERT 产生一个 **part**，后台 merge
- **ORDER BY** = 排序键，决定"哪些数据能跳过"；最常用的过滤条件放最前
- **PARTITION BY** = 按天分区，查询走分区裁剪，TTL 按分区整块删
- **TTL** = 自动过期删除，不用写清理脚本
- **怕小批写入** → 必须攒批（500 条 / 1 秒）
- **LowCardinality** = 低基数列（kind/level/event）的字典编码优化
