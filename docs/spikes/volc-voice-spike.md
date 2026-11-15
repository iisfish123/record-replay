# Spike: 火山引擎语音接口真实契约（Task 10）

- 日期：2026-11-14 首版 / **2026-11-15 重大更新（TTS 已打通）**
- 目的：用真实凭证实调火山语音接口，确认音色训练 / 状态查询 / TTS 的 HTTP 契约，供 Task 11 适配器为准。
- 凭证（脱敏）：
  - 旧版控制台：`VOLC_TTS_APPID=1119668586`，`VOLC_TTS_ACCESS_TOKEN=wW_Z…JL3F`
  - 新版控制台：`VOLC_API_KEY=b538…7e2e`
- 结论摘要（2026-11-15）：
  1. **TTS 已打通** ✅ —— `POST /api/v3/tts/unidirectional` + `X-Api-Resource-Id: seed-tts-2.0` + 2.0 音色（`_uranus_bigtts` 结尾）返回 **HTTP 200 + 真实 base64 音频**。
  2. **声音复刻训练未授权** ❌ —— `POST /api/v3/tts/voice_clone` 返回 `[resource_id=volc.megatts.timbre] requested resource not granted`。根因：账号只开通了「豆包声音复刻模型2.0（合成）」，**未单独开通「后付费音色服务（音色训练）」**。
  3. **OmniHuman 未开通** ❌ —— `cv` 服务仍 `Access Denied`（见 Task 12）。
- 根因澄清：此前的 `volc.tts.default` / `volc.service_type.10029` 「not granted」错误**不是**账号没开通语音服务，而是 **resource_id 写错了**。正确资源名见下。

---

## 端点与鉴权（实测确认）

| 用途 | 方法/URL | Resource-Id | 鉴权 |
|------|----------|-------------|------|
| **TTS（v3 单向流式，推荐）** | `POST https://openspeech.bytedance.com/api/v3/tts/unidirectional` | `seed-tts-2.0`（公共2.0音色）/ `seed-icl-2.0`（复刻音色） | 旧版：`X-Api-App-Id` + `X-Api-Access-Key`；新版：`X-Api-Key` |
| 音色训练上传（v3） | `POST https://openspeech.bytedance.com/api/v3/tts/voice_clone` | 服务端固定映射 `volc.megatts.timbre` | 同上 |
| 音色训练状态查询（v3） | `POST https://openspeech.bytedance.com/api/v3/tts/get_voice` | — | 同上 |
| TTS（legacy v1，不推荐） | `POST https://openspeech.bytedance.com/api/v1/tts` | `volc.tts.default`（内部） | `Authorization: Bearer;<ACCESS_TOKEN>`（**分号**），body 内 `app.token` 需一致 |
| 训练状态查询（legacy v1，不推荐） | `POST https://openspeech.bytedance.com/api/v1/mega_tts/status` | `Resource-Id: volc.megatts.voiceclone` | `Authorization: Bearer;<TOKEN>` |

**新版控制台鉴权（更简单）**：仅需 `X-Api-Key: <API Key>` + `X-Api-Request-Id: <uuid>`。
**旧版控制台鉴权**：`X-Api-App-Key: <APP ID>` + `X-Api-Access-Key: <Access Token>` + `X-Api-Request-Id: <uuid>`。

关键错误码对照（实测）：

| 错误码 | 含义 |
|--------|------|
| `45000030 … requested resource not granted` | 鉴权通过，但该 appid 无此 resource 授权（resource_id 写错或服务未开通） |
| `45000010 load grant: requested grant not found in SaaS storage` | 凭证类型不对（例如把 Secret Key 当 Access Key 用） |
| `55000000 resource ID is mismatched with speaker related resource` | **该 resource 已授权**，但所选音色与资源不匹配（音色命名规则不符） |
| `3001 … missing Authorization header` | legacy v1 缺 `Authorization` 头 |

---

## 实测记录

### A～G. 首轮探针（2026-11-14，授权/资源名错误阶段，保留备查）

### A. legacy v1 TTS（计划假设 `code: 3000`）
```bash
curl -s -X POST 'https://openspeech.bytedance.com/api/v1/tts' \
  -H 'Authorization: Bearer;<TOKEN>' -H 'Content-Type: application/json' \
  -d '{"app":{"appid":"1119668586","token":"<TOKEN>","cluster":"volcano_tts"},
       "user":{"uid":"spike"},
       "audio":{"voice_type":"BV700_streaming","encoding":"mp3","speed_ratio":1.0},
       "request":{"reqid":"spike-1","text":"这是一次接口验证。","operation":"query"}}'
```
响应（HTTP 403）：`{"reqid":"spike-1","code":3001,"message":"[resource_id=volc.tts.default] requested resource not granted"}`

### B. cluster 扫描（`volcano_tts` / `volcano_mega` / `volcano_icl`）
三种 cluster 结果一致 → 该 appid 对 `volc.tts.default` 无授权（与 cluster 无关）。

### C. v3 单向流式（resource 写错）
`X-Api-Resource-Id: volc.service_type.10029` → 403 `45000030 [resource_id=volc.service_type.10029] requested resource not granted`。

### D. legacy 训练状态查询
`POST /api/v1/mega_tts/status` + `Resource-Id: volc.megatts.voiceclone` → 403 `{"code":0,"message":"parameter license not found for appid 1119668586"}`。

### E. 负面对照 — 鉴权是否通过
省略 `Authorization` → 401 `missing Authorization header`；带上正确 token → 进入业务层返回资源错误（403）。**鉴权本身是通的**。

### F/G. legacy 训练上传 / 克隆音色合成
首轮未执行（前置服务未确认）。

### H. 凭证类型对照（2026-11-15）

同一 v3 端点，仅更换 `X-Api-Access-Key` 取值：

| Key 取值 | 返回 |
|---|---|
| `Access Token`（旧版控制台） | `45000030 resource not granted`（进入资源校验，key 类型正确） |
| `Secret Key` | `45000010 load grant: requested grant not found in SaaS storage`（key 类型错误） |
| `API Key` | `45000010 load grant: …`（key 类型错误） |

→ 旧版 `X-Api-Access-Key` 必须用 **Access Token**，不是 Secret Key。

### I. 资源 id 扫描（定位正确 resource_id）
对 `X-Api-Resource-Id` 逐值探测，用错误的 `speaker` 触发「音色不匹配」判据：

| Resource-Id | 返回 |
|---|---|
| `seed-tts-1.0` | `45000030 [resource_id=volc.service_type.10029] not granted`（1.0 别名映射到旧资源，未授权） |
| `seed-icl-1.0` | `45000030 [resource_id=volc.megatts.default] not granted` |
| `volc.tts.default` | `45000030 not granted` |
| `volc.service_type.10029` | `45000030 not granted` |
| **`seed-tts-2.0`** | **`55000000 resource ID is mismatched with speaker related resource`**（✔ 已授权，只是音色不符） |
| **`seed-icl-2.0`** | **`55000000 …`**（✔ 已授权） |
| `volc.megatts.voiceclone` | `55000000 …`（已授权，但旧版端点另有 timbre 限制） |

→ **`seed-tts-2.0`（豆包音频生成模型）与 `seed-icl-2.0`（声音复刻2.0）已授权。**

### J. TTS 真实成功 ✅
```bash
curl -s -X POST 'https://openspeech.bytedance.com/api/v3/tts/unidirectional' \
  -H "X-Api-App-Id: 1119668586" -H "X-Api-Access-Key: <ACCESS_TOKEN>" \
  -H 'X-Api-Resource-Id: seed-tts-2.0' -H 'Content-Type: application/json' \
  -d '{"user":{"uid":"spike"},
       "req_params":{"text":"你好，这是一次接口验证。",
                     "speaker":"zh_female_cancan_uranus_bigtts",
                     "audio_params":{"format":"mp3","sample_rate":24000}}}'
```
响应（HTTP 200，chunked JSON-lines）：
```json
{"code":0,"message":"","data":"SUQzBAAAAAAAI1RTU0UAAAAP…"}   ← data 为 base64 音频分片（SUQz=ID3=mp3）
{"code":0,"message":"","data":null,"sentence":{"phonemes":[],"text":"你好，这是一次接口验证。","words":[]}}
{"code":20000000,"message":"OK","data":null}                  ← 结束标记
```
**合成方式**：逐行读取，累积 `data` 字段 → base64 解码 → 拼接为完整 mp3。
**响应字段契约**：`code`（0=分片，20000000=结束）、`message`、`data`（base64 或 null）、`sentence`（可选，句级信息）。
**2.0 音色命名规则**：以 `_uranus_bigtts` 结尾（如 `zh_female_cancan_uranus_bigtts`）；`seed-tts-2.0` 仅支持该类音色。

### K. 声音复刻训练实测 ❌（未授权）
```bash
curl -s -X POST 'https://openspeech.bytedance.com/api/v3/tts/voice_clone' \
  -H "X-Api-Key: <API_KEY>" -H "X-Api-Request-Id: <uuid>" \
  -H 'X-Api-Resource-Id: seed-icl-2.0' -H 'Content-Type: application/json' \
  -d '{"speaker_id":"custom_speaker_id","custom_speaker_id":"custom_zh_demo001",
       "audio":{"data":"<base64 wav>","format":"wav"},"language":0}'
```
响应（HTTP 403，4 种 header 组合结果一致）：
```json
{"code":45000030,"message":"[resource_id=volc.megatts.timbre] requested resource not granted"}
```
→ 服务端把训练接口固定映射到 `volc.megatts.timbre`，**该资源未授权**。

请求体契约（来自官方文档 声音复刻API-V3）：
- 预付费音色：`{"speaker_id":"S_*******","audio":{"data":"<b64>","format":"wav"},"language":0}`
- 后付费音色：`{"speaker_id":"custom_speaker_id","custom_speaker_id":"custom_zh_xxx","audio":{"data":"<b64>","format":"wav"},"language":0}`
- `audio.format`：`wav/mp3/ogg/m4a/aac/pcm`（pcm 仅 24k 单通道），**单文件 ≤ 10MB**
- `language`：0=cn（默认）、1=en、2=ja、3=es、4=id、5=pt、6=de、7=fr、8=ko
- 返回：`available_training_times`、`status`（0 NotFound/1 Training/2 Success/3 Failed/4 Active）、`speaker_status[].model_type`（2.0 为 4=ICL V2 / 5=ICL V3）、`demo_audio`
- `status` 为 2 或 4 时即可调用 TTS

---

## 根因判定（首轮，保留）：凭证有效性问题已排除

| 实验（OmniHuman `CVGetResult`，v4 签名） | 结果 | 含义 |
|---|---|---|
| 正确 AK + 正确 SK | `50400 Access Denied` | 签名校验通过，进入授权层被拒 → 该账号无 `cv` 权限 |
| 正确 AK + 错误 SK | `SignatureDoesNotMatch` | 对照：错误 SK 先在签名层被拒 |
| 错误 AK + 正确 SK | `InvalidAccessKey` | 对照：错误 AK 在 AK 层被拒 |

> `VOLC_ACCESS_KEY_SECRET` 原值带 `==`、形似 base64，但对照实验证明**原值即为正确密钥**，无需解码。

---

## 需要的操作（待用户处理）

1. **后付费音色服务** —— 这是当前唯一阻断 Task 11 的缺口。
   官方原文：「**后付费音色需要开通声音复刻模型2.0服务，并单独开通后付费音色服务。**」
   - 新版控制台：`console.volcengine.com/speech/new/overview` → 开通管理 → 勾选「豆包声音复刻模型2.0」+「后付费音色服务」
   - 旧版控制台：`console.volcengine.com/speech/app` → 创建/编辑应用 → 勾选「声音复刻模型2.0」+「音色服务」，并**手动开通「后付费音色服务」**
   - 对应未授权资源：`volc.megatts.timbre`
2. **OmniHuman（即梦AI）** —— 控制台开通「OmniHuman1.5」，对应 `cv` 服务（Task 12 用）。

开通后重跑 `K` 与 OmniHuman 探针，把真实成功响应补录于此。

## 已确认可用的真实契约（可直接据此写 Task 11）

- TTS：`POST /api/v3/tts/unidirectional`，头 `X-Api-App-Id` + `X-Api-Access-Key`（或 `X-Api-Key`）+ `X-Api-Resource-Id: seed-tts-2.0`，体 `{user:{uid},req_params:{text,speaker,audio_params:{format,sample_rate}}}`，响应 JSON-lines 累积 base64。
- 训练：`POST /api/v3/tts/voice_clone`（后付费用 `speaker_id:"custom_speaker_id"` + `custom_speaker_id`），体含 base64 音频。
- 状态：`POST /api/v3/tts/get_voice` 或 legacy `/api/v1/mega_tts/status`。

## 未验证

- Step 3 训练 / Step 5 克隆音色合成：`volc.megatts.timbre` 未授权，未执行。
- Task 12 Step 6（OmniHuman 真实 submit + 轮询）：未开通，未执行。
- `seed-icl-2.0` 下克隆音色合成时的 `req_params.model` / `additions` 具体取值：待训练成功后验证。
