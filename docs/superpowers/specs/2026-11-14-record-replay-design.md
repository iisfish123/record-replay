# record-replay 设计文档（Demo）

- 日期：2026-11-14
- 状态：待评审
- 项目根目录：`/Users/lkz/202507/record-replay`

---

## 1. 背景与目标

做一个「怀念亲人 / 赛博永生」方向的 Demo App：用户上传亲人的**一张头像**和**一段语音**，生成一个数字人格；之后用户输入问题，App 返回一段**以克隆音色 + 头像驱动的"真人播报"视频**来回答问题。

本阶段只做 **端到端最短闭环 Demo**，用于验证技术链路与演示体验，不追求产品完整度。

长期竞争力在于**长期数据积累**（不在本次范围内），本 Demo 只验证"生成链路能不能跑通、体验能不能打动人"。

---

## 2. 范围

### 2.1 本次要做（In Scope）

1. 手机号 + 短信验证码登录（**真实短信**，阿里云号码认证服务 Dypnsapi）
2. 上传**一张头像图** + **一段语音**（用于音色复刻）
3. 调火山引擎**声音复刻**，训练出专属音色（`speaker_id`）
4. 用户输入问题 → LLM（DeepSeek 官方）生成回答文本
5. 用克隆音色合成语音（TTS）→ 火山引擎 **OmniHuman** 生成"头像+音频"的播报视频
6. App 内播放播报视频
7. 一套代码在 **iOS / Android** 上均可演示

### 2.2 本次不做（Out of Scope）

- 实时双向视频通话
- 长期记录 / 多亲人档案 / 时间线 / 记忆系统
- 支付、订阅、商业化
- 多租户、复杂权限体系
- 生产级对象存储、内容审核后台、运维监控

---

## 3. 硬约束（第三方能力限制）

| 约束 | 来源 | 影响 |
|---|---|---|
| 音频**建议 < 15 秒**，过长效果劣化 | OmniHuman 文档 | Demo 中将回答控制在约 60–75 个汉字；超长直接截断 |
| 图片 < 5 MB、< 4096×4096，单人正脸效果最好 | OmniHuman 文档 | 上传前做尺寸/大小校验，必要时前端裁剪 |
| 生成结果 `video_url` **仅 1 小时有效** | OmniHuman 文档 | 服务端拿到后**立即异步转存**到本地，不把三方链接直接给前端 |
| 存在**内容审核**，拦截则报错 | 错误码 50411/50412/50413/50511/50512 | 「怀念逝者」类文本可能误触，需兜底话术 |
| 输出带 **AIGC 隐式水印** | 文档 / 合规要求 | 不得去除，保留即可 |
| 音色**训练是异步**的，且预付费音色**仅 15 次训练** | 声音复刻文档 | 上传后轮询训练状态，避免重复训练浪费额度 |
| 视频生成是**异步任务** | OmniHuman 文档 | 走「提交任务 → 轮询结果」模式 |

---

## 4. 架构

### 4.1 目录结构（pnpm workspace monorepo）

```
record-replay/
├─ pnpm-workspace.yaml
├─ package.json
├─ docker/
│  └─ docker-compose.yml          # MySQL + Redis
├─ apps/
│  ├─ app/                        # uni-app (Vue3 + TS + pinia + VueUse)
│  └─ api/                        # NestJS 后端
├─ packages/
│  └─ shared/                     # 前后端共享 zod schema 与 DTO 类型
└─ docs/
   └─ superpowers/specs/
```

### 4.2 技术栈

| 层 | 选型 |
|---|---|
| 跨端 App | uni-app（Vue3 + TypeScript + pinia + VueUse），产出 H5 + iOS/Android 包 |
| 后端 | NestJS + TypeORM + MySQL + Redis + JWT + zod |
| 短信 | 阿里云号码认证服务 Dypnsapi（复用 sso-demo 实现） |
| LLM | DeepSeek 官方 `https://api.deepseek.com`（模型 `deepseek-flash`） |
| 音色复刻 / TTS | 火山引擎 声音复刻 + 语音合成 |
| 口型视频 | 火山引擎 OmniHuman（`realman_avatar_picture_omni_v2`） |
| 公网暴露 | 既有 ChmlFrp 隧道（本机作服务器） |
| 包管理 | pnpm |

---

## 5. 后端模块设计

| 模块 | 职责 | 依赖 |
|---|---|---|
| `AuthModule` | 短信发码、校验、签发 JWT | 阿里云 Dypnsapi、Redis |
| `MediaModule` | 接收头像/语音上传，落盘到 `apps/api/storage/`，生成**公网可访问 URL** | 本地磁盘 + ChmlFrp |
| `PersonaModule` | 维护人格档案（头像 + speaker_id + 状态） | MySQL |
| `VoiceModule` | 声音复刻训练（上传音频 → speaker_id）、克隆音色 TTS | 火山引擎语音 |
| `ChatModule` | 组装人格 system prompt，调 LLM 生成回答（限长） | DeepSeek |
| `RenderModule` | OmniHuman 提交任务 + 轮询结果 + 立即转存视频 | 火山引擎视觉 |
| `TaskModule` | 统一异步任务模型（状态机 + 轮询） | Redis / MySQL |

---

## 6. 数据模型

```
User
  id            uuid PK
  phone         varchar(11) unique
  created_at    datetime

Persona
  id                uuid PK
  user_id           uuid FK -> User
  avatar_url        varchar      # 公网可访问
  voice_sample_url  varchar      # 公网可访问
  speaker_id        varchar null # 声音复刻成功后写入
  status            enum(pending, training, ready, failed)
  error             text null
  created_at        datetime

RenderTask
  id           uuid PK
  persona_id   uuid FK -> Persona
  question     text
  answer_text  text null
  audio_url    varchar null
  video_url    varchar null    # 转存后的本地地址
  remote_video_url varchar null
  status       enum(pending, answering, tts, rendering, done, failed)
  error        text null
  created_at   datetime
  finished_at  datetime null
```

---

## 7. 接口设计

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| POST | `/auth/sms/send` | 否 | body `{ phone }`；发验证码，Redis 存码 + 频控 |
| POST | `/auth/sms/login` | 否 | body `{ phone, code }`；**手机号未注册则自动创建用户**（Demo 简化）；返回 `{ token }` |
| POST | `/personas` | JWT | multipart `avatar` + `voice`；创建人格，触发音色训练，返回 `{ personaId, status }` |
| GET | `/personas/:id` | JWT | 查询人格状态；`training` 时前端轮询 |
| POST | `/personas/:id/ask` | JWT | body `{ question }`；返回 `{ taskId }` |
| GET | `/tasks/:id` | JWT | 查询任务状态；`done` 时返回 `videoUrl`、`answerText` |
| GET | `/static/*` | 否 | 静态文件服务，供三方 API 拉取图片/音频 |

---

## 8. 端到端时序

```
App                     API                    三方
 │  手机号+验证码        │                       │
 ├──────────────────────► Dypnsapi 校验          │
 │◄── JWT ──────────────┤                       │
 │  上传头像+语音        │                       │
 ├──────────────────────► 落盘 → 公网URL        │
 │                      ├───── 声音复刻训练 ────► 火山语音
 │                      │◄──── speaker_id ──────┤
 │◄── persona ready ────┤                       │
 │  输入问题            │                       │
 ├──────────────────────► DeepSeek 作答(限长)   │
 │                      ├───── 克隆音色 TTS ───► 火山语音
 │                      │◄──── 音频(公网URL) ───┤
 │                      ├───── OmniHuman 提交 ─► 火山视觉
 │                      │  轮询 CVGetResult     │
 │                      │◄──── video_url ───────┤
 │                      ├── 立即转存为本地地址  │
 │◄── 播放播报视频 ─────┤                       │
```

---

## 9. 关键设计决策

1. **公网 URL 用既有 ChmlFrp 隧道**
   OmniHuman 要求 `image_url` / `audio_url` 必须公网可达。本机作为服务器，经 ChmlFrp 映射到公网地址（已实测 `http://23.147.68.16:31527/...` 可达）。
   实现上增加配置项 `PUBLIC_BASE_URL`，由环境变量注入，不硬编码。

2. **回答限长（< 15 秒音频）**
   Demo 阶段不引入分段合成+拼接，直接在 LLM 输出处做长度约束（约 60–75 汉字），超长截断。

3. **异步任务统一模型**
   音色训练、视频生成都慢，统一「提交 → taskId → 前端轮询」。前端每 2–3 秒轮询一次 `/tasks/:id`。

4. **视频立即转存**
   拿到 `video_url` 后服务端立即下载保存到本地静态目录，落库为本地地址；避免 1 小时过期导致演示失败。

5. **共享 schema 用 zod 放 `packages/shared`**
   前后端复用同一份校验与类型定义，避免接口漂移。

---

## 10. 错误处理

- **三方 API 超时/5xx**：指数退避重试（最多 3 次），仍失败则任务置 `failed` 并记录 `error`
- **内容审核拦截**：映射错误码 50411/50412/50413/50511/50512 为可读提示，前端给兜底话术
- **音色训练额度**：`Persona` 上防止重复触发训练；失败才允许重试
- **上传校验**：图片大小/分辨率、音频时长/格式，不合格直接拒绝
- **任务超时**：超过阈值（如视频 5 分钟）置 `failed`，允许用户重试

---

## 11. 测试策略

| 层面 | 方式 |
|---|---|
| 短信 | **实发实收**验证，使用手机号 `15920328477` |
| Provider 单测 | `VoiceProvider` / `RenderProvider` / `ChatProvider` 用 mock，校验编排与状态流转 |
| 业务单测 | `TaskModule` 状态机、`AuthModule` 频控与校验 |
| E2E | 一条最短链路：登录 → 建人格 → 提问 → 拿到视频 |
| 手工验收 | 真机（iOS/Android）打开 H5 走一遍完整演示 |

---

## 12. 部署与演示

- **本机**跑 `apps/api` + MySQL + Redis（docker-compose）
- 经 **ChmlFrp** 映射公网端口，配置一个新的路径前缀给本项目（需你在 ChmlFrp 侧加一条映射）
- 演示：手机浏览器打开 H5 链接；需要"真 App"时用 HBuilderX 云打包 iOS/Android

---

## 13. 外部依赖与待办（需要你提供）

| 项 | 来源 | 用途 |
|---|---|---|
| 阿里云 `accessKeyId` / `accessKeySecret` | 复用 `sso-demo/packages/sms/.env` | 短信发码/校验 |
| 火山 `AK` / `SK` | IAM 密钥管理 | OmniHuman v4 签名 |
| 火山语音 `appid` + `access_token`（或 API Key） | 豆包语音控制台 | 声音复刻 + TTS |
| 已训练 `speaker_id`（或允许 Demo 现场用样例音频训练） | 音色库 | TTS 合成 |
| ChmlFrp 新增映射 | ChmlFrp 控制台 | 公网 URL |
| DeepSeek API Key | 已提供（实测可用） | LLM |

**火山控制台需开通的服务**：声音复刻大模型、豆包声音复刻模型2.0、语音合成大模型、（后付费音色需单独开通）后付费音色服务、图像生成大模型→视频生成→OmniHuman。

---

## 14. 未来演进（非本次范围）

- 实时双向"伪视频通话"
- 长期记录端（数据护城河）
- 记忆系统 / 时间线 / 多人格
- 分段合成长回答
- 对象存储 + CDN 替换本地静态文件
- 合规：家属授权、逝者肖像权、隐私协议
