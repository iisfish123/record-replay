# Spike: 火山引擎语音接口真实契约（Task 10）

- 日期：2026-11-14 首版 / 2026-11-15 更新（TTS 打通） / **2026-11-16 更新（声音复刻训练 + 复刻音色合成打通）**
- 目的：用真实凭证实调火山语音接口，确认音色训练 / 状态查询 / TTS 的 HTTP 契约，供 Task 11 适配器为准。
- 凭证（脱敏）：
  - 旧版控制台：`VOLC_TTS_APPID=1119668586`，`VOLC_TTS_ACCESS_TOKEN=wW_Z…JL3F`
  - 新版控制台：`VOLC_API_KEY=b538…7e2e`
- 结论摘要（2026-11-16 最新）：
  1. **TTS 已打通** ✅ —— `POST /api/v3/tts/unidirectional` + `X-Api-Resource-Id: seed-tts-2.0` + 2.0 音色（`_uranus_bigtts` 结尾）返回 **HTTP 200 + 真实 base64 音频**。
  2. **声音复刻训练已打通** ✅（2026-11-16 实调）—— `POST /api/v3/tts/voice_clone` 返回 `HTTP 200`，`status=2`（Success）、`model_type=5`（ICL V3 / 复刻2.0）。**关键：训练接口只认「旧版控制台」鉴权**（`X-Api-App-Key`/`X-Api-App-Id` + `X-Api-Access-Key`），新版 `X-Api-Key` 仍返回 `45000030`。详见「M」。
  3. **复刻音色合成已打通** ✅（2026-11-16 实调）—— `seed-icl-2.0` + `speaker=<custom_speaker_id>` 返回 HTTP 200 + 真实音频。详见「M」。
  4. **OmniHuman 已打通** ✅（2026-11-15 晚实调）—— `cv` 服务 v4 签名通过，OmniHuman2.0（`realman_avatar_picture_omni20_cvtob`）与 1.5（`jimeng_realman_avatar_picture_omni_v15`）均**已授权**；实调 2.0 成功产出 **5.02s 数字人视频**（见下方「L」）。首轮「`cv` Access Denied」结论**作废**（当时服务未开通或探针 action 不对）。
- 根因澄清：此前的 `volc.tts.default` / `volc.service_type.10029` 「not granted」错误**不是**账号没开通语音服务，而是 **resource_id 写错了**。正确资源名见下。

---

## 端点与鉴权（实测确认）

| 用途 | 方法/URL | Resource-Id | 鉴权 |
|------|----------|-------------|------|
| **TTS（v3 单向流式，推荐）** | `POST https://openspeech.bytedance.com/api/v3/tts/unidirectional` | `seed-tts-2.0`（公共2.0音色）/ `seed-icl-2.0`（复刻音色） | 旧版：`X-Api-App-Id` + `X-Api-Access-Key`；新版：`X-Api-Key` |
| 音色训练上传（v3） | `POST https://openspeech.bytedance.com/api/v3/tts/voice_clone` | 服务端固定映射 `volc.megatts.timbre` | **仅旧版**：`X-Api-App-Key`/`X-Api-App-Id` + `X-Api-Access-Key`（新版 `X-Api-Key` 实测 403） |
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

### K. 声音复刻训练实测 ✅（2026-11-16 打通）

> 历史（已解决）：2026-11-15 及 2026-11-16 11:45 复测，均返回 `403 {"code":45000030,"message":"[resource_id=volc.megatts.timbre] requested resource not granted"}`；2026-11-16 15:22 起同一请求返回 200。→ 用户开通后存在**数小时级授权生效延迟**（不是配置问题）。

**可用鉴权 = 旧版控制台**（新版 `X-Api-Key` 至今仍 403）：
```bash
curl -s -X POST 'https://openspeech.bytedance.com/api/v3/tts/voice_clone' \
  -H "X-Api-App-Key: 1119668586" -H "X-Api-Access-Key: <ACCESS_TOKEN>" \
  -H "X-Api-Request-Id: <uuid>" -H 'Content-Type: application/json' \
  -d '{"speaker_id":"custom_speaker_id","custom_speaker_id":"custom_zh_rr_spike03",
       "audio":{"data":"<base64 wav>","format":"wav"},"language":0}'
```
响应（HTTP 200）见「M」。服务端把训练接口固定映射到 `volc.megatts.timbre`。

请求体契约（来自官方文档 声音复刻API-V3）：
- 预付费音色：`{"speaker_id":"S_*******","audio":{"data":"<b64>","format":"wav"},"language":0}`
- 后付费音色：`{"speaker_id":"custom_speaker_id","custom_speaker_id":"custom_zh_xxx","audio":{"data":"<b64>","format":"wav"},"language":0}`
- `audio.format`：`wav/mp3/ogg/m4a/aac/pcm`（pcm 仅 24k 单通道），**单文件 ≤ 10MB**
- `language`：0=cn（默认）、1=en、2=ja、3=es、4=id、5=pt、6=de、7=fr、8=ko
- 返回：`available_training_times`、`status`（0 NotFound/1 Training/2 Success/3 Failed/4 Active）、`speaker_status[].model_type`（2.0 为 4=ICL V2 / 5=ICL V3）、`demo_audio`
- `status` 为 2 或 4 时即可调用 TTS

---

### L. OmniHuman 实调成功 ✅（2026-11-15 晚）

**共享契约（`cv` 服务，两代通用）**
- 端点：`POST https://visual.volcengineapi.com`，`Content-Type: application/json`
- 固定签名域：`Region=cn-north-1`，`Service=cv`
- 鉴权：**AK/SK 的 v4 签名**（`Authorization: HMAC-SHA256 Credential=…/…`, `X-Date`, `X-Content-Sha256`），与 TTS 的 `X-Api-Key` 完全不同体系
- 通用错误码：`code=10000` 成功；`50411/50412/50413` 审核未过；`50429/50430` 限流；`50200` 入参非法；`50500/50501` 内部错误（可重试）
- **关键业务约束（`50200` 实测）**：底层模型 `doubao-seedance-2-0-mini (r2v)` 要求 **音频时长 ≥ 4 秒**，否则报 `the parameter audio duration (seconds) specified in the request must be greater than or equal to 4`。

**OmniHuman 2.0（本品采用）**
- 提交：`?Action=CVSync2AsyncSubmitTask&Version=2022-08-31`
  - Body：`req_key="realman_avatar_picture_omni20_cvtob"`
  - 图片：`binary_data_base64: ["<b64>"]`（<4.7MB）**或** `image_urls: ["<公网URL>"]`（二选一，base64 优先）
  - 音频：`audio_url: "<公网URL>"`（**必填，必须公网可访问**，MP3，时长 4s~300s）
  - 可选：`prompt`、`enable_watermark`（默认 true，建议 false）
- 查询：`?Action=CVSync2AsyncGetResult&Version=2022-08-31`，Body `{req_key, task_id}`
  - `data.status`：`processing / in_queue / generating / done / not_found / expired`
  - `data.video_url`（**1 小时有效**）；`data.resp_data` 内含 `video_meta.Duration`

**本节实测记录**
1. 首次提交（示例 404 图 URL）→ `50220 Download Url Error`（证明确实会主动拉取图片，且签名/授权已通过）。
2. 第二次提交（base64 图 + 2.83s 音频）→ 提交 `10000` 拿到 `task_id`，轮询 32s 后 `50200`：**音频 <4s 被拒**。
3. 第三次提交（base64 图 + **4.03s** 音频）→ `task_id=5178985085930850455`，~94s 后 `status=done`，产出 **5.024s / 832×1114 / H.264+AAC / 3.8MB** 视频。产物样例存于 `docs/spikes/omnihuman2-demo.mp4`。

**OmniHuman 1.5（备选/低配）**
- 提交：`?Action=CVSubmitTask&Version=2022-08-31`；查询：`?Action=CVGetResult&Version=2022-08-31`
- Body：`req_key="jimeng_realman_avatar_picture_omni_v15"`，`image_url`（必填）、`audio_url`（必填，**<35s**）、`mask_url?`、`prompt?`、`pe_fast_mode?`
- **注意**：1.5 **不支持 base64**，图片也必须是公网 URL；实测用占位 URL 提交即返回 `10000 + task_id`（提交阶段不校验图片可达性）

**临时公网托管（仅用于联调，非生产方案）**
- 本机无法访问 0x0.st / catbox / tmpfiles / transfer.sh（超时或被重置）；`pomf.lain.la` 可上传且返回 URL。
- 上传：`curl -F "files[]=@file.mp3" https://pomf.lain.la/upload.php` → 返回 `pomf2.lain.la` 域名，**改用 `pomf.lain.la` 主域即可稳定访问**（`pomf2` 在本机不可达，但火山可拉取）。
- ⚠️ 生产必须改用自有对象存储/`PUBLIC_BASE_URL`（见下「未决环境问题」）。

---

### M. 声音复刻训练 + 复刻音色合成实调成功 ✅（2026-11-16）

**Step 1｜训练（`POST /api/v3/tts/voice_clone`）** —— 鉴权用**旧版控制台**（`X-Api-App-Key`/`X-Api-App-Id` + `X-Api-Access-Key`）：
```json
HTTP 200
{
  "status": 2,
  "model_type": 5,
  "model_version": 2,
  "speaker_id": "custom_zh_rr_spike03",
  "icl_speaker_id": "ICL_uranus_6afaaf44988ab0a3",
  "available_training_times": 15,
  "language": 0,
  "create_time": 1794813768234,
  "demo_audio": "https://lf9-lab-speech-tt-sign.bytespeech.com/...",
  "extra_params": "{\"client_request_id\":\"\"}",
  "version": "V1",
  "speaker_status": [
    { "model_type": 5, "model_version": 2, "icl_speaker_id": "ICL_uranus_6afaaf44988ab0a3", "demo_audio": "..." },
    { "model_type": 1, "model_version": 1, "icl_speaker_id": "ICL_6afaaf449f9ae435", "demo_audio": "..." }
  ]
}
```

要点（与计划基线的 legacy v1 语义**不同**）：
- **同步返回结果**：POST 直接返回 `status=2`（Success）并附带 `demo_audio`，**无需再轮询训练状态**。
- `status`：`0` NotFound / `1` Training / `2` Success / `3` Failed / `4` Active；`2` 或 `4` 即可用于合成。
- `model_type`：`4`=ICL V2、`5`=ICL V3（本次拿到 `5`，即复刻 2.0）。
- `speaker_status[]` 会同时给出多代模型产物；音频均可用 `demo_audio` 试听。
- 消费 `available_training_times`（每次调用 -= 1，本次回包仍显示 15，疑似返回的是配额上限而非剩余数，需以控制台为准）。
- ⚠️ **每次 POST 都会新建一个训练任务**，不要把提交接口当作状态查询接口反复调用。

**Step 2｜用复刻音色合成（`POST /api/v3/tts/unidirectional`）**：
```bash
curl -s -X POST 'https://openspeech.bytedance.com/api/v3/tts/unidirectional' \
  -H "X-Api-App-Id: 1119668586" -H "X-Api-Access-Key: <ACCESS_TOKEN>" \
  -H 'X-Api-Resource-Id: seed-icl-2.0' -H 'Content-Type: application/json' \
  -d '{"user":{"uid":"spike"},
       "req_params":{"text":"孩子，妈妈一直都在。",
                     "speaker":"custom_zh_rr_spike03",
                     "audio_params":{"format":"mp3","sample_rate":24000}}}'
```
→ `HTTP 200`，JSON-lines 累积 base64，产出 **18093 bytes MP3**（`/tmp/icl_tts.mp3`）。

**结论**：合成时 `speaker` 直接用训练时传入的 `custom_speaker_id`（**不用** `icl_speaker_id`），资源头用 `seed-icl-2.0`。

**Step 3｜`status=` 不足时状态查询**：本次训练同步返回 `status=2`，未触发轮询；`POST /api/v3/tts/get_voice` 的请求/响应格式**尚未实测**（见「未验证」）。

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

1. ~~**后付费音色服务**~~ ✅ **已完成**（2026-11-16）—— 用户开通后生效，`voice_clone` 已返回 `status=2`；注意开通存在**数小时级生效延迟**。
2. ~~**OmniHuman（即梦AI）**~~ ✅ **已完成** —— 2.0 与 1.5 均已开通并实调成功。

## 未决环境问题（阻断 Task 12 联调，非火山侧）

- **公网入口不可达**：`PUBLIC_BASE_URL=http://23.147.68.16:31527/record-replay`；实测该主机 `ping 100% 丢包`，端口 `7000/31527/80/443/22` 全部 filtered。ChmlFrp 隧道客户端也因 `dial tcp 23.147.68.16:7000: i/o timeout` 无法建立。
- **隧道端口配错**：`~/Library/Application Support/net.chmlfrp.launcher/g_373833.ini` 中 `local_port=5501`，但本机 API 实际监听 `:3000`（5501 被别的进程占用）。即使隧道恢复也会指向错误端口。
- **生产替代方案**：OmniHuman 要求 `audio_url` 公网可访问，需改用自有对象存储（如火山 TOS / 阿里云 OSS）或修好 `PUBLIC_BASE_URL` 反向代理。

## 已确认可用的真实契约（可直接据此写 Task 11 / Task 12）

- TTS（公共音色）：`POST /api/v3/tts/unidirectional`，头 `X-Api-App-Id` + `X-Api-Access-Key`（或 `X-Api-Key`）+ `X-Api-Resource-Id: seed-tts-2.0`，体 `{user:{uid},req_params:{text,speaker,audio_params:{format,sample_rate}}}`，响应 JSON-lines 累积 base64。
- TTS（复刻音色）：同上，`X-Api-Resource-Id: seed-icl-2.0`，`speaker` = 训练时的 `custom_speaker_id`。
- 训练：`POST /api/v3/tts/voice_clone`（后付费用 `speaker_id:"custom_speaker_id"` + `custom_speaker_id`），体含 base64 音频；**鉴权仅支持旧版控制台头**（`X-Api-App-Key`/`X-Api-App-Id` + `X-Api-Access-Key`）；**同步返回 `status=2` 即成功**，无需轮询。
- 状态：`POST /api/v3/tts/get_voice` 或 legacy `/api/v1/mega_tts/status`（**均未实测**）。
- **OmniHuman 2.0**：见上方「L」，`req_key=realman_avatar_picture_omni20_cvtob`，图片 base64、音频公网 URL 且 **≥4s**。

## 未验证

- `POST /api/v3/tts/get_voice` 的请求/响应格式：本次训练同步返回 `status=2`，未触发轮询，故未实测。
- 训练失败/进行中（`status=1/3`）时的返回形态：未构造。
- OmniHuman 1.5 端到端产出（仅验证到提交返回 `task_id`，未轮询到 `done`）。
