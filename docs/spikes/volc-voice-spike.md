# Spike: 火山引擎语音接口真实契约（Task 10）

- 日期：2026-11-14
- 目的：用真实凭证实调火山语音接口，确认音色训练 / 状态查询 / TTS 的 HTTP 契约，供 Task 11 适配器为准。
- 凭证：`VOLC_TTS_APPID=1119668586`，`VOLC_TTS_ACCESS_TOKEN=wW_Z…JL3F`（脱敏）。
- 结论摘要：**凭证可通过鉴权，但该 appid 未开通「语音合成 / 声音复刻」服务授权（license）**，因此无法完成 Step 2-5 的字段级验证。计划 Task 11 的字段假设**尚未被证实，也未被证伪**。

---

## 端点（实测）

| 用途 | 方法/URL |
|------|----------|
| TTS（legacy v1） | `POST https://openspeech.bytedance.com/api/v1/tts` |
| TTS（v3 单向流式） | `POST https://openspeech.bytedance.com/api/v3/tts/unidirectional` |
| 音色训练上传 | `POST https://openspeech.bytedance.com/api/v1/mega_tts/audio/upload` |
| 训练状态查询 | `POST https://openspeech.bytedance.com/api/v1/mega_tts/status` |

鉴权：legacy v1 需要 `Authorization: Bearer;<ACCESS_TOKEN>`（注意是**分号**），且 body 内 `app.token` 需一致；仅用 `X-Api-*` 头会返回 `missing Authorization header`（HTTP 401）。

---

## 实测记录

### A. Step 2 — 公共音色 TTS（计划假设：`code: 3000` + base64 音频）

请求：
```bash
curl -s -X POST 'https://openspeech.bytedance.com/api/v1/tts' \
  -H 'Authorization: Bearer;<TOKEN>' -H 'Content-Type: application/json' \
  -d '{"app":{"appid":"1119668586","token":"<TOKEN>","cluster":"volcano_tts"},
       "user":{"uid":"spike"},
       "audio":{"voice_type":"BV700_streaming","encoding":"mp3","speed_ratio":1.0},
       "request":{"reqid":"spike-1","text":"这是一次接口验证。","operation":"query"}}'
```

真实响应（HTTP 403）：
```json
{"reqid":"spike-1","code":3001,"message":"[resource_id=volc.tts.default] requested resource not granted"}
```

### B. cluster 取值扫描（`volcano_tts` / `volcano_mega` / `volcano_icl`）

三种 cluster 全部返回同一结果（HTTP 403）：
```json
{"code":3001,"message":"[resource_id=volc.tts.default] requested resource not granted"}
```
→ 说明该 appid 对 `volc.tts.default` 资源无授权，与 cluster 无关。

### C. v3 单向流式

```bash
curl -s -X POST 'https://openspeech.bytedance.com/api/v3/tts/unidirectional' \
  -H "X-Api-App-Id: 1119668586" -H "X-Api-Access-Key: <TOKEN>" \
  -H 'X-Api-Resource-Id: volc.service_type.10029' -H 'Content-Type: application/json' \
  -d '{"user":{"uid":"spike"},"req_params":{"text":"这是一次接口验证。","speaker":"zh_female_shuangkuaisisi_moon_bigtts","audio_params":{"format":"mp3","sample_rate":24000}}}'
```

真实响应（HTTP 403）：
```json
{"header":{"reqid":"7f3ecdd3-…","code":45000030,"message":"[resource_id=volc.service_type.10029] requested resource not granted"}}
```

### D. Step 4 — 音色训练状态查询（鉴权探针）

```bash
curl -s -X POST 'https://openspeech.bytedance.com/api/v1/mega_tts/status' \
  -H 'Authorization: Bearer;<TOKEN>' -H 'Resource-Id: volc.megatts.voiceclone' \
  -H 'Content-Type: application/json' \
  -d '{"appid":"1119668586","speaker_id":"spike_demo"}'
```

真实响应（HTTP 403）：
```json
{"reqid":"","code":0,"message":"parameter license not found for appid 1119668586"}
```

### E. 负面对照 — 鉴权是否通过？

- 省略 `Authorization` 头 → `{"code":3001,"message":"missing Authorization header"}`（HTTP 401）
- 带上 `Authorization: Bearer;<TOKEN>` → 进入业务层，返回资源/授权错误（HTTP 403）

→ **鉴权本身是通的**（token 被识别），失败发生在服务授权层。

### F. Step 3 — 音色训练上传

未执行：在 D 已确认 appid 无 voiceclone license 的前提下，上传必然失败，且需要先将一段真实音频准备为符合要求的 wav（未做，避免无意义调用）。

### G. Step 5 — 克隆音色合成

未执行：依赖 Step 3/4 成功，前置条件未满足。

---

## 与计划假设的差异 / 待确认项

1. 计划 Task 10 Step 2 预期 `code: 3000`；实测全部为 `code: 3001 / 45000030` 的**授权缺失**错误。这不是字段名问题，而是**账号服务未开通**。
2. voice-clone 相关接口返回 `parameter license not found for appid 1119668586`，指向同一根因。
3. 因此，计划 Task 11 中关于训练/状态/TTS 的**具体字段名仍未被真实响应证实**，需在服务开通后重跑本 spike 再定稿。

## 根因判定（重要）

对两组凭证做了「正/误」对照实验，结论一致：**凭证本身有效，失败发生在服务授权（license）层**。

| 实验（OmniHuman `CVGetResult`，v4 签名） | 结果 | 含义 |
|---|---|---|
| 正确 AK + 正确 SK（用户所给原值） | `50400 Access Denied` | 签名校验**通过**，进入授权层后被拒 → 该账号无 `cv`（OmniHuman）权限 |
| 正确 AK + 故意错误的 SK | `SignatureDoesNotMatch` | 对照：错误 SK 会先在签名层被拒 |
| 故意错误的 AK + 正确 SK | `InvalidAccessKey` | 对照：错误 AK 会在 AK 层被拒 |

同理，语音侧：省略 `Authorization` → `missing Authorization header`（401，鉴权层）；带上正确 token → 进入业务层返回资源/授权错误（403）。**说明 token 被识别，问题只在服务未开通。**

> 注：`VOLC_ACCESS_KEY_SECRET` 用户所给原值带 `==` 后缀、形似 base64；但如果它是错的，服务端会返回 `SignatureDoesNotMatch`，而实测返回的是 `Access Denied`，**证明原值即为正确密钥**。无需再做 base64 解码。

## 需要的操作（待用户处理）

以下服务当前对该账号**未开通/未授权**，需在火山引擎控制台开通并绑定到对应应用：

1. **语音合成大模型（TTS）** —— 对应 `volc.tts.default` / `volc.service_type.10029`
2. **声音复刻（voice clone / megatts）** —— 对应 `volc.megatts.voiceclone`（错误信息：`parameter license not found for appid 1119668586`）
3. **OmniHuman（视觉 / realman 数字人）** —— 对应 `cv` 服务的 `CVSubmitTask` / `CVGetResult`

开通后重跑本文件 Step A / D 与 OmniHuman 探针，把真实成功响应补录于此，再据此定稿 Task 11 / Task 12 的字段假设。

## 未验证

- Task 10 Step 3（音色训练上传）/ Step 5（克隆音色合成）：前置服务未开通，未执行。
- Task 12 Step 6（OmniHuman 真实 submit + 轮询）：前置服务未开通，未执行。
- 计划 Task 11 / Task 12 中训练/状态/TTS/提交/查询的**具体字段名**仍未被真实成功响应证实。
