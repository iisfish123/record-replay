# record-replay 实施计划（二）：跨端 App（uni-app）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用 uni-app 做一套 iOS / Android / H5 通用的 Demo App，跑通「短信登录 → 上传头像与语音 → 建数字人格 → 提问 → 播放播报视频」的完整前端闭环。

**Architecture:** 单工程多页面 uni-app（Vue3 + TS + pinia + VueUse）。网络层用一层薄封装包住 `uni.request` / `uni.uploadFile`，统一注入 JWT 与 API 基址；跨页状态用 pinia（`auth` / `session`）；所有异步任务（音色训练、视频生成）统一用 `poll` 工具轮询 `GET /tasks/:id`。可纯逻辑化的部分（config / request / api / poll / stores）**全部 TDD**，设备胶水（录音、选图、视频播放）按手工真机验收。

**Tech Stack:** uni-app (Vue3 + TypeScript) · pinia · @vueuse/core · Vitest + jsdom · pnpm workspace · 复用 `@record-replay/shared` 的 zod 契约

**关联规格：** `docs/superpowers/specs/2026-11-14-record-replay-design.md`
**关联计划：** `docs/superpowers/plans/2026-11-14-record-replay-backend.md`（后端必须先完成，本计划依赖其后端接口与 `packages/shared`）

---

## 后端接口契约（本计划依赖，来自后端计划）

| 方法 | 路径 | 鉴权 | 请求 | 响应 |
|---|---|---|---|---|
| POST | `/auth/sms/send` | 否 | `{ phone }` | `{ ok: true }` |
| POST | `/auth/sms/login` | 否 | `{ phone, code }` | `{ token, userId }` |
| POST | `/media/upload` | JWT | multipart `file` | `{ url, kind: 'image' \| 'audio' }` |
| POST | `/personas` | JWT | `{ avatarUrl, voiceSampleUrl }` | `Persona` 实体 |
| GET | `/personas/:id` | JWT | — | `Persona` 实体 |
| POST | `/personas/:personaId/ask` | JWT | `{ question }` | `{ taskId }` |
| GET | `/tasks/:id` | JWT | — | `RenderTask` 实体 |

- `Persona.status`：`pending \| training \| ready \| failed`
- `RenderTask.status`：`pending \| answering \| tts \| rendering \| done \| failed`
- `RenderTask.videoUrl`：返回的是**相对路径**，形如 `/static/videos/xxx.mp4`；播放前需拼上 API 基址
- 后端监听 `0.0.0.0:3000`；公网基址 `http://23.147.68.16:31527/record-replay`（经 ChmlFrp）

---

## 文件结构（本计划涉及）

```
record-replay/
└─ apps/app/
   ├─ package.json                       # @record-replay/app
   ├─ vite.config.ts                     # uni 插件 + @ / shared 别名
   ├─ vitest.config.ts                   # 纯逻辑单测配置
   ├─ tsconfig.json
   ├─ index.html
   ├─ .env.example / .env.development
   ├─ tests/
   │  ├─ setup.ts                        # 全局 mock uni
   │  ├─ config.spec.ts
   │  ├─ request.spec.ts
   │  ├─ poll.spec.ts
   │  ├─ api-auth.spec.ts
   │  ├─ api-media.spec.ts
   │  ├─ api-persona.spec.ts
   │  ├─ api-task.spec.ts
   │  └─ stores.spec.ts
   └─ src/
      ├─ App.vue
      ├─ main.ts                         # 注册 pinia
      ├─ pages.json                      # 三个页面路由
      ├─ manifest.json
      ├─ uni.scss
      ├─ env.d.ts
      ├─ config/index.ts                 # API_BASE_URL + absoluteUrl
      ├─ api/
      │  ├─ request.ts                   # uni.request 封装 + token 持有
      │  ├─ auth.ts
      │  ├─ media.ts                     # uni.uploadFile 封装
      │  ├─ persona.ts
      │  └─ task.ts
      ├─ utils/
      │  ├─ poll.ts                      # 通用轮询
      │  └─ recorder.ts                  # 录音 composable（设备胶水）
      ├─ stores/
      │  ├─ auth.ts
      │  └─ session.ts
      └─ pages/
         ├─ login/index.vue
         ├─ home/index.vue
         └─ chat/index.vue
```

**说明**：`utils/recorder.ts` 与页面的选图/播放属设备胶水，单测不覆盖，由第 12 节手工清单验收。

---

## Task 1: 初始化 uni-app 工程与测试工具链

**Files:**
- Create: `apps/app/`（由官方模板生成）
- Modify: `apps/app/package.json`
- Create: `apps/app/vitest.config.ts`
- Create: `apps/app/tests/setup.ts`

- [ ] **Step 1: 用官方模板生成工程**

```bash
cd /Users/lkz/202507/record-replay
npx degit dcloudio/uni-preset-vue#vite-ts apps/app
```

Expected: `apps/app/` 下出现 `src/`、`index.html`、`vite.config.ts`、`package.json` 等。

- [ ] **Step 2: 改写 `apps/app/package.json`**

```json
{
  "name": "@record-replay/app",
  "version": "0.0.1",
  "private": true,
  "scripts": {
    "dev:h5": "uni",
    "dev:app": "uni -p app",
    "build:h5": "uni build",
    "build:app": "uni build -p app",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@dcloudio/uni-app": "3.0.0-4060620250520001",
    "@dcloudio/uni-app-plus": "3.0.0-4060620250520001",
    "@dcloudio/uni-components": "3.0.0-4060620250520001",
    "@dcloudio/uni-h5": "3.0.0-4060620250520001",
    "@record-replay/shared": "workspace:*",
    "@vueuse/core": "^13.0.0",
    "pinia": "^3.0.0",
    "vue": "^3.5.0"
  },
  "devDependencies": {
    "@dcloudio/types": "^3.4.8",
    "@dcloudio/uni-automator": "3.0.0-4060620250520001",
    "@dcloudio/uni-cli-shared": "3.0.0-4060620250520001",
    "@dcloudio/uni-stacktracey": "3.0.0-4060620250520001",
    "@dcloudio/vite-plugin-uni": "3.0.0-4060620250520001",
    "@vue/tsconfig": "^0.7.0",
    "jsdom": "^26.0.0",
    "typescript": "^5.9.3",
    "vite": "^5.4.0",
    "vitest": "^3.0.0",
    "vue-tsc": "^2.2.0"
  }
}
```

> 说明：`@dcloudio/*` 版本号请与模板生成时的版本保持一致（模板生成后 `package.json` 内即是该批版本号，直接沿用，勿跨版本混用）。若模板版本与上面不同，以模板为准。

- [ ] **Step 3: 安装依赖**

```bash
cd /Users/lkz/202507/record-replay
pnpm install
```

Expected: 无报错，`apps/app/node_modules` 建好，`@record-replay/shared` 软链成功。

- [ ] **Step 4: 写 `apps/app/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.spec.ts'],
    passWithNoTests: true,
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@record-replay/shared': fileURLToPath(
        new URL('../../packages/shared/src/index.ts', import.meta.url),
      ),
    },
  },
});
```

- [ ] **Step 5: 写 `apps/app/tests/setup.ts`**

```ts
import { vi } from 'vitest';

const storage = new Map<string, unknown>();

vi.stubGlobal('uni', {
  request: vi.fn(),
  uploadFile: vi.fn(),
  getStorageSync: (k: string) => storage.get(k) ?? '',
  setStorageSync: (k: string, v: unknown) => {
    storage.set(k, v);
  },
  removeStorageSync: (k: string) => {
    storage.delete(k);
  },
  showToast: vi.fn(),
  chooseImage: vi.fn(),
  getRecorderManager: vi.fn(),
  navigateTo: vi.fn(),
  reLaunch: vi.fn(),
});

export {};
```

- [ ] **Step 6: 跑测试确认工具链可用**

```bash
cd /Users/lkz/202507/record-replay/apps/app
pnpm test
```

Expected: `No test files found` 但退出码为 0（因 `passWithNoTests: true`）。

- [ ] **Step 7: 提交**

```bash
cd /Users/lkz/202507/record-replay
git add apps/app pnpm-lock.yaml
git commit -m "chore(app): init uni-app project with vitest toolchain"
```

---

## Task 2: 环境配置与 API 基址

**Files:**
- Create: `apps/app/src/config/index.ts`
- Create: `apps/app/.env.example`
- Create: `apps/app/.env.development`
- Test: `apps/app/tests/config.spec.ts`
- Modify: `apps/app/vite.config.ts`（加别名）

- [ ] **Step 1: 写失败测试 `tests/config.spec.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { API_BASE_URL, absoluteUrl } from '../src/config';

describe('config', () => {
  it('API_BASE_URL 默认去掉结尾斜杠', () => {
    expect(API_BASE_URL.endsWith('/')).toBe(false);
  });

  it('absoluteUrl 给相对路径拼上基址', () => {
    expect(absoluteUrl('/static/videos/a.mp4')).toBe(`${API_BASE_URL}/static/videos/a.mp4`);
  });

  it('absoluteUrl 对已是绝对地址的输入原样返回', () => {
    expect(absoluteUrl('https://v/x.mp4')).toBe('https://v/x.mp4');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd /Users/lkz/202507/record-replay/apps/app
pnpm vitest run tests/config.spec.ts
```

Expected: FAIL，`Cannot find module '../src/config'`。

- [ ] **Step 3: 写 `src/config/index.ts`**

```ts
const RAW_BASE = (import.meta.env?.VITE_API_BASE_URL as string | undefined) ?? 'http://localhost:3000';

export const API_BASE_URL = RAW_BASE.replace(/\/+$/, '');

export function absoluteUrl(pathOrUrl: string): string {
  if (!pathOrUrl) return '';
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  return `${API_BASE_URL}${pathOrUrl.startsWith('/') ? '' : '/'}${pathOrUrl}`;
}
```

- [ ] **Step 4: 写 `src/env.d.ts`（若模板已有则补充）**

```ts
/// <reference types="vite/client" />
/// <reference types="@dcloudio/types" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
```

- [ ] **Step 5: 写 `apps/app/.env.example`**

```
# 后端 API 基址：H5 本地开发用 localhost，真机演示用 ChmlFrp 公网地址
VITE_API_BASE_URL=http://localhost:3000
```

- [ ] **Step 6: 写 `apps/app/.env.development`**

```
VITE_API_BASE_URL=http://localhost:3000
```

- [ ] **Step 7: 改 `vite.config.ts` 补别名**

```ts
import { defineConfig } from 'vite';
import uni from '@dcloudio/vite-plugin-uni';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [uni()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@record-replay/shared': fileURLToPath(
        new URL('../../packages/shared/src/index.ts', import.meta.url),
      ),
    },
  },
});
```

> `@record-replay/shared` 的 `main` 指向源码 `src/index.ts`，必须用别名指向源码，vite 才能转译 TS。

- [ ] **Step 8: 跑测试确认通过**

```bash
pnpm vitest run tests/config.spec.ts
```

Expected: `3 passed`。

- [ ] **Step 9: 提交**

```bash
cd /Users/lkz/202507/record-replay
git add apps/app/src/config apps/app/src/env.d.ts apps/app/.env.example apps/app/.env.development apps/app/vite.config.ts apps/app/tests/config.spec.ts
git commit -m "feat(app): add api base url config and absoluteUrl helper"
```

---

## Task 3: request 封装（uni.request + JWT）

**Files:**
- Create: `apps/app/src/api/request.ts`
- Test: `apps/app/tests/request.spec.ts`

- [ ] **Step 1: 写失败测试 `tests/request.spec.ts`**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { request, setAuthToken, getAuthToken } from '../src/api/request';
import { API_BASE_URL } from '../src/config';

const uniRequest = uni.request as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  uniRequest.mockReset();
  setAuthToken(null);
});

describe('request', () => {
  it('成功时 resolve data', async () => {
    uniRequest.mockImplementation((opts: any) =>
      opts.success({ statusCode: 200, data: { ok: true } }),
    );
    await expect(request({ url: '/health' })).resolves.toEqual({ ok: true });
  });

  it('拼上基址、默认 GET、带 Content-Type', async () => {
    uniRequest.mockImplementation((opts: any) => opts.success({ statusCode: 200, data: {} }));
    await request({ url: '/auth/sms/send', method: 'POST', data: { phone: '15920328477' } });
    const arg = uniRequest.mock.calls[0][0];
    expect(arg.url).toBe(`${API_BASE_URL}/auth/sms/send`);
    expect(arg.method).toBe('POST');
    expect(arg.header['Content-Type']).toBe('application/json');
  });

  it('有 token 时带 Authorization', async () => {
    setAuthToken('jwt-abc');
    uniRequest.mockImplementation((opts: any) => opts.success({ statusCode: 200, data: {} }));
    await request({ url: '/personas' });
    expect(uniRequest.mock.calls[0][0].header.Authorization).toBe('Bearer jwt-abc');
    expect(getAuthToken()).toBe('jwt-abc');
  });

  it('无 token 时不带 Authorization', async () => {
    uniRequest.mockImplementation((opts: any) => opts.success({ statusCode: 200, data: {} }));
    await request({ url: '/health' });
    expect(uniRequest.mock.calls[0][0].header.Authorization).toBeUndefined();
  });

  it('非 2xx 时 reject 并带后端 message', async () => {
    uniRequest.mockImplementation((opts: any) =>
      opts.success({ statusCode: 400, data: { message: '验证码错误' } }),
    );
    await expect(request({ url: '/auth/sms/login' })).rejects.toThrow('验证码错误');
  });

  it('message 为数组时拼接', async () => {
    uniRequest.mockImplementation((opts: any) =>
      opts.success({ statusCode: 400, data: { message: ['手机号不正确', '验证码为 6 位数字'] } }),
    );
    await expect(request({ url: '/x' })).rejects.toThrow('手机号不正确；验证码为 6 位数字');
  });

  it('无 message 时回退到状态码文案', async () => {
    uniRequest.mockImplementation((opts: any) => opts.success({ statusCode: 500, data: {} }));
    await expect(request({ url: '/x' })).rejects.toThrow('请求失败（500）');
  });

  it('fail 时 reject', async () => {
    uniRequest.mockImplementation((opts: any) => opts.fail({ errMsg: 'request:fail' }));
    await expect(request({ url: '/health' })).rejects.toThrow('request:fail');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
pnpm vitest run tests/request.spec.ts
```

Expected: FAIL，`Cannot find module '../src/api/request'`。

- [ ] **Step 3: 写 `src/api/request.ts`**

```ts
import { API_BASE_URL } from '../config';

let authToken: string | null = null;

export function setAuthToken(token: string | null): void {
  authToken = token;
}

export function getAuthToken(): string | null {
  return authToken;
}

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

export interface RequestOptions {
  url: string;
  method?: HttpMethod;
  data?: Record<string, unknown>;
  header?: Record<string, string>;
}

interface UniSuccessResponse {
  statusCode: number;
  data: unknown;
}

interface UniFailResponse {
  errMsg?: string;
}

export function request<T>(options: RequestOptions): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    uni.request({
      url: `${API_BASE_URL}${options.url}`,
      method: options.method ?? 'GET',
      data: options.data,
      header: {
        'Content-Type': 'application/json',
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        ...options.header,
      },
      success: (raw: unknown) => {
        const res = raw as UniSuccessResponse;
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.data as T);
        } else {
          reject(new Error(extractMessage(res.data, res.statusCode)));
        }
      },
      fail: (err: unknown) => {
        reject(new Error((err as UniFailResponse)?.errMsg ?? '网络请求失败'));
      },
    });
  });
}

function extractMessage(data: unknown, statusCode: number): string {
  if (data && typeof data === 'object' && 'message' in data) {
    const m = (data as { message?: unknown }).message;
    if (Array.isArray(m)) return m.join('；');
    if (typeof m === 'string' && m) return m;
  }
  return `请求失败（${statusCode}）`;
}
```

- [ ] **Step 4: 跑测试确认通过**

```bash
pnpm vitest run tests/request.spec.ts
```

Expected: `8 passed`。

- [ ] **Step 5: 提交**

```bash
cd /Users/lkz/202507/record-replay
git add apps/app/src/api/request.ts apps/app/tests/request.spec.ts
git commit -m "feat(app): wrap uni.request with base url, jwt and error mapping"
```

---

## Task 4: poll 轮询工具

**Files:**
- Create: `apps/app/src/utils/poll.ts`
- Test: `apps/app/tests/poll.spec.ts`

- [ ] **Step 1: 写失败测试 `tests/poll.spec.ts`**

```ts
import { describe, it, expect, vi } from 'vitest';
import { poll } from '../src/utils/poll';

const noSleep = () => Promise.resolve();

describe('poll', () => {
  it('第一次就满足 done 时立即返回，不再等待', async () => {
    const fn = vi.fn().mockResolvedValue({ status: 'ready' });
    const result = await poll({
      fn,
      isDone: (v) => v.status === 'ready',
      sleep: noSleep,
    });
    expect(result).toEqual({ status: 'ready' });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('多次轮询后满足 done', async () => {
    const seq = [{ status: 'pending' }, { status: 'training' }, { status: 'ready' }];
    let i = 0;
    const fn = vi.fn(() => Promise.resolve(seq[i++]));
    const result = await poll({
      fn,
      isDone: (v) => v.status === 'ready',
      sleep: noSleep,
    });
    expect(result.status).toBe('ready');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('命中 failed 时抛错', async () => {
    const fn = vi.fn().mockResolvedValue({ status: 'failed' });
    await expect(
      poll({ fn, isDone: () => false, isFailed: (v) => v.status === 'failed', sleep: noSleep }),
    ).rejects.toThrow('任务失败');
  });

  it('超时抛错', async () => {
    const fn = vi.fn().mockResolvedValue({ status: 'pending' });
    let t = 0;
    await expect(
      poll({
        fn,
        isDone: () => false,
        timeoutMs: 1000,
        sleep: async () => {
          t += 600;
        },
        now: () => t,
      }),
    ).rejects.toThrow('任务超时');
  });

  it('每次轮询之间调用 sleep', async () => {
    const sleep = vi.fn(noSleep);
    const seq = [{ status: 'pending' }, { status: 'ready' }];
    let i = 0;
    await poll({ fn: () => Promise.resolve(seq[i++]), isDone: (v) => v.status === 'ready', sleep });
    expect(sleep).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
pnpm vitest run tests/poll.spec.ts
```

Expected: FAIL，`Cannot find module '../src/utils/poll'`。

- [ ] **Step 3: 写 `src/utils/poll.ts`**

```ts
export interface PollOptions<T> {
  fn: () => Promise<T>;
  isDone: (value: T) => boolean;
  isFailed?: (value: T) => boolean;
  intervalMs?: number;
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export async function poll<T>(options: PollOptions<T>): Promise<T> {
  const intervalMs = options.intervalMs ?? 2500;
  const timeoutMs = options.timeoutMs ?? 300_000;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = options.now ?? (() => Date.now());
  const start = now();

  for (;;) {
    const value = await options.fn();
    if (options.isDone(value)) return value;
    if (options.isFailed?.(value)) throw new Error('任务失败');
    if (now() - start >= timeoutMs) throw new Error('任务超时');
    await sleep(intervalMs);
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

```bash
pnpm vitest run tests/poll.spec.ts
```

Expected: `5 passed`。

- [ ] **Step 5: 提交**

```bash
cd /Users/lkz/202507/record-replay
git add apps/app/src/utils/poll.ts apps/app/tests/poll.spec.ts
git commit -m "feat(app): add generic poll helper with timeout and failure handling"
```

---

## Task 5: auth / media api 模块

**Files:**
- Create: `apps/app/src/api/auth.ts`
- Create: `apps/app/src/api/media.ts`
- Test: `apps/app/tests/api-auth.spec.ts`
- Test: `apps/app/tests/api-media.spec.ts`

- [ ] **Step 1: 写失败测试 `tests/api-auth.spec.ts`**

```ts
import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/api/request', () => ({ request: vi.fn(), setAuthToken: vi.fn(), getAuthToken: vi.fn() }));
import { request } from '../src/api/request';
import { sendCode, login } from '../src/api/auth';

const mocked = request as unknown as ReturnType<typeof vi.fn>;

describe('auth api', () => {
  it('sendCode 调对路径与参数', async () => {
    mocked.mockResolvedValue({ ok: true });
    await sendCode('15920328477');
    expect(mocked).toHaveBeenCalledWith({
      url: '/auth/sms/send',
      method: 'POST',
      data: { phone: '15920328477' },
    });
  });

  it('login 调对路径与参数并返回 token', async () => {
    mocked.mockResolvedValue({ token: 't', userId: 'u' });
    const res = await login('15920328477', '123456');
    expect(mocked).toHaveBeenCalledWith({
      url: '/auth/sms/login',
      method: 'POST',
      data: { phone: '15920328477', code: '123456' },
    });
    expect(res).toEqual({ token: 't', userId: 'u' });
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
pnpm vitest run tests/api-auth.spec.ts
```

Expected: FAIL，`Cannot find module '../src/api/auth'`。

- [ ] **Step 3: 写 `src/api/auth.ts`**

```ts
import { request } from './request';

export interface LoginResult {
  token: string;
  userId: string;
}

export function sendCode(phone: string): Promise<{ ok: boolean }> {
  return request({ url: '/auth/sms/send', method: 'POST', data: { phone } });
}

export function login(phone: string, code: string): Promise<LoginResult> {
  return request({ url: '/auth/sms/login', method: 'POST', data: { phone, code } });
}
```

- [ ] **Step 4: 跑测试确认通过**

```bash
pnpm vitest run tests/api-auth.spec.ts
```

Expected: `2 passed`。

- [ ] **Step 5: 写失败测试 `tests/api-media.spec.ts`**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { uploadFile } from '../src/api/media';
import { setAuthToken } from '../src/api/request';
import { API_BASE_URL } from '../src/config';

const uniUpload = uni.uploadFile as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  uniUpload.mockReset();
  setAuthToken(null);
});

describe('media api', () => {
  it('上传成功后解析 JSON 结果', async () => {
    uniUpload.mockImplementation((opts: any) =>
      opts.success({ statusCode: 200, data: JSON.stringify({ url: '/static/uploads/a.jpg', kind: 'image' }) }),
    );
    await expect(uploadFile('/tmp/a.jpg')).resolves.toEqual({
      url: '/static/uploads/a.jpg',
      kind: 'image',
    });
  });

  it('拼上基址、name=file、带 token', async () => {
    setAuthToken('jwt-1');
    uniUpload.mockImplementation((opts: any) =>
      opts.success({ statusCode: 200, data: JSON.stringify({ url: '/x', kind: 'audio' }) }),
    );
    await uploadFile('/tmp/v.mp3');
    const arg = uniUpload.mock.calls[0][0];
    expect(arg.url).toBe(`${API_BASE_URL}/media/upload`);
    expect(arg.name).toBe('file');
    expect(arg.filePath).toBe('/tmp/v.mp3');
    expect(arg.header.Authorization).toBe('Bearer jwt-1');
  });

  it('非 2xx 时 reject', async () => {
    uniUpload.mockImplementation((opts: any) => opts.success({ statusCode: 413, data: 'too large' }));
    await expect(uploadFile('/tmp/big.mp4')).rejects.toThrow('上传失败（413）');
  });

  it('响应不是 JSON 时 reject', async () => {
    uniUpload.mockImplementation((opts: any) => opts.success({ statusCode: 200, data: 'not-json' }));
    await expect(uploadFile('/tmp/a.jpg')).rejects.toThrow('上传响应解析失败');
  });

  it('fail 时 reject', async () => {
    uniUpload.mockImplementation((opts: any) => opts.fail({ errMsg: 'uploadFile:fail' }));
    await expect(uploadFile('/tmp/a.jpg')).rejects.toThrow('uploadFile:fail');
  });
});
```

- [ ] **Step 6: 跑测试确认失败**

```bash
pnpm vitest run tests/api-media.spec.ts
```

Expected: FAIL，`Cannot find module '../src/api/media'`。

- [ ] **Step 7: 写 `src/api/media.ts`**

```ts
import { API_BASE_URL } from '../config';
import { getAuthToken } from './request';

export interface UploadResult {
  url: string;
  kind: 'image' | 'audio';
}

interface UniUploadSuccess {
  statusCode: number;
  data: string;
}

export function uploadFile(filePath: string, name = 'file'): Promise<UploadResult> {
  const token = getAuthToken();
  return new Promise<UploadResult>((resolve, reject) => {
    uni.uploadFile({
      url: `${API_BASE_URL}/media/upload`,
      filePath,
      name,
      header: token ? { Authorization: `Bearer ${token}` } : {},
      success: (raw: unknown) => {
        const res = raw as UniUploadSuccess;
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(JSON.parse(res.data) as UploadResult);
          } catch {
            reject(new Error('上传响应解析失败'));
          }
        } else {
          reject(new Error(`上传失败（${res.statusCode}）`));
        }
      },
      fail: (err: unknown) => {
        reject(new Error((err as { errMsg?: string })?.errMsg ?? '上传失败'));
      },
    });
  });
}
```

- [ ] **Step 8: 跑测试确认通过**

```bash
pnpm vitest run tests/api-media.spec.ts
```

Expected: `5 passed`。

- [ ] **Step 9: 提交**

```bash
cd /Users/lkz/202507/record-replay
git add apps/app/src/api/auth.ts apps/app/src/api/media.ts apps/app/tests/api-auth.spec.ts apps/app/tests/api-media.spec.ts
git commit -m "feat(app): add auth and media api modules"
```

---

## Task 6: persona / task api 模块

**Files:**
- Create: `apps/app/src/api/persona.ts`
- Create: `apps/app/src/api/task.ts`
- Test: `apps/app/tests/api-persona.spec.ts`
- Test: `apps/app/tests/api-task.spec.ts`

- [ ] **Step 1: 写失败测试 `tests/api-persona.spec.ts`**

```ts
import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/api/request', () => ({ request: vi.fn(), setAuthToken: vi.fn(), getAuthToken: vi.fn() }));
import { request } from '../src/api/request';
import { createPersona, getPersona } from '../src/api/persona';

const mocked = request as unknown as ReturnType<typeof vi.fn>;

describe('persona api', () => {
  it('createPersona 传 avatarUrl 与 voiceSampleUrl', async () => {
    mocked.mockResolvedValue({ id: 'p1', status: 'pending' });
    const res = await createPersona('/static/uploads/a.jpg', '/static/uploads/v.mp3');
    expect(mocked).toHaveBeenCalledWith({
      url: '/personas',
      method: 'POST',
      data: { avatarUrl: '/static/uploads/a.jpg', voiceSampleUrl: '/static/uploads/v.mp3' },
    });
    expect(res.id).toBe('p1');
  });

  it('getPersona 走 GET /personas/:id', async () => {
    mocked.mockResolvedValue({ id: 'p1', status: 'ready' });
    await getPersona('p1');
    expect(mocked).toHaveBeenCalledWith({ url: '/personas/p1' });
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
pnpm vitest run tests/api-persona.spec.ts
```

Expected: FAIL，`Cannot find module '../src/api/persona'`。

- [ ] **Step 3: 写 `src/api/persona.ts`**

```ts
import type { PersonaStatus } from '@record-replay/shared';
import { request } from './request';

export interface PersonaDto {
  id: string;
  userId: string;
  avatarUrl: string;
  voiceSampleUrl: string;
  speakerId: string | null;
  status: PersonaStatus;
  error: string | null;
  createdAt: string;
}

export function createPersona(avatarUrl: string, voiceSampleUrl: string): Promise<PersonaDto> {
  return request({ url: '/personas', method: 'POST', data: { avatarUrl, voiceSampleUrl } });
}

export function getPersona(id: string): Promise<PersonaDto> {
  return request({ url: `/personas/${id}` });
}
```

- [ ] **Step 4: 跑测试确认通过**

```bash
pnpm vitest run tests/api-persona.spec.ts
```

Expected: `2 passed`。

- [ ] **Step 5: 写失败测试 `tests/api-task.spec.ts`**

```ts
import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/api/request', () => ({ request: vi.fn(), setAuthToken: vi.fn(), getAuthToken: vi.fn() }));
import { request } from '../src/api/request';
import { ask, getTask } from '../src/api/task';

const mocked = request as unknown as ReturnType<typeof vi.fn>;

describe('task api', () => {
  it('ask 走 POST /personas/:id/ask', async () => {
    mocked.mockResolvedValue({ taskId: 't1' });
    const res = await ask('p1', '爸爸，你最近还好吗？');
    expect(mocked).toHaveBeenCalledWith({
      url: '/personas/p1/ask',
      method: 'POST',
      data: { question: '爸爸，你最近还好吗？' },
    });
    expect(res).toEqual({ taskId: 't1' });
  });

  it('getTask 走 GET /tasks/:id', async () => {
    mocked.mockResolvedValue({ id: 't1', status: 'done', videoUrl: '/static/videos/x.mp4' });
    const res = await getTask('t1');
    expect(mocked).toHaveBeenCalledWith({ url: '/tasks/t1' });
    expect(res.status).toBe('done');
  });
});
```

- [ ] **Step 6: 跑测试确认失败**

```bash
pnpm vitest run tests/api-task.spec.ts
```

Expected: FAIL，`Cannot find module '../src/api/task'`。

- [ ] **Step 7: 写 `src/api/task.ts`**

```ts
import type { TaskStatus } from '@record-replay/shared';
import { request } from './request';

export interface TaskDto {
  id: string;
  personaId: string;
  question: string;
  answerText: string | null;
  audioUrl: string | null;
  videoUrl: string | null;
  status: TaskStatus;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
}

export function ask(personaId: string, question: string): Promise<{ taskId: string }> {
  return request({ url: `/personas/${personaId}/ask`, method: 'POST', data: { question } });
}

export function getTask(id: string): Promise<TaskDto> {
  return request({ url: `/tasks/${id}` });
}
```

- [ ] **Step 8: 跑测试确认通过**

```bash
pnpm vitest run tests/api-task.spec.ts
```

Expected: `2 passed`。

- [ ] **Step 9: 提交**

```bash
cd /Users/lkz/202507/record-replay
git add apps/app/src/api/persona.ts apps/app/src/api/task.ts apps/app/tests/api-persona.spec.ts apps/app/tests/api-task.spec.ts
git commit -m "feat(app): add persona and task api modules"
```

---

## Task 7: auth store（pinia）

**Files:**
- Create: `apps/app/src/stores/auth.ts`
- Test: `apps/app/tests/stores.spec.ts`

- [ ] **Step 1: 写失败测试 `tests/stores.spec.ts`（先只覆盖 auth）**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';

vi.mock('../src/api/auth', () => ({ sendCode: vi.fn(), login: vi.fn() }));
import { login as apiLogin } from '../src/api/auth';
import { useAuthStore } from '../src/stores/auth';

const mockedLogin = apiLogin as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  setActivePinia(createPinia());
  uni.removeStorageSync('token');
  uni.removeStorageSync('userId');
  mockedLogin.mockReset();
});

describe('auth store', () => {
  it('初始 token 为空', () => {
    const store = useAuthStore();
    expect(store.token).toBe('');
  });

  it('login 成功后写入 token/userId 并持久化', async () => {
    mockedLogin.mockResolvedValue({ token: 'jwt-1', userId: 'u-1' });
    const store = useAuthStore();
    await store.login('15920328477', '123456');
    expect(store.token).toBe('jwt-1');
    expect(store.userId).toBe('u-1');
    expect(uni.getStorageSync('token')).toBe('jwt-1');
    expect(uni.getStorageSync('userId')).toBe('u-1');
  });

  it('setSession 会同步 token 到 request 层', async () => {
    const store = useAuthStore();
    store.setSession('jwt-2', 'u-2');
    const { getAuthToken } = await import('../src/api/request');
    expect(getAuthToken()).toBe('jwt-2');
  });

  it('logout 清空 token 与 storage', () => {
    const store = useAuthStore();
    store.setSession('jwt-3', 'u-3');
    store.logout();
    expect(store.token).toBe('');
    expect(uni.getStorageSync('token')).toBe('');
  });

  it('从 storage 恢复 token', () => {
    uni.setStorageSync('token', 'restored');
    uni.setStorageSync('userId', 'u-9');
    const store = useAuthStore();
    expect(store.token).toBe('restored');
    expect(store.userId).toBe('u-9');
  });
});
```

> 注：`tests/setup.ts` 的 storage 是跨用例共享的 Map，所以 `beforeEach` 里要主动清。

- [ ] **Step 2: 跑测试确认失败**

```bash
pnpm vitest run tests/stores.spec.ts
```

Expected: FAIL，`Cannot find module '../src/stores/auth'`。

- [ ] **Step 3: 写 `src/stores/auth.ts`**

```ts
import { defineStore } from 'pinia';
import { ref } from 'vue';
import { login as apiLogin } from '../api/auth';
import { setAuthToken } from '../api/request';

export const useAuthStore = defineStore('auth', () => {
  const token = ref<string>((uni.getStorageSync('token') as string) || '');
  const userId = ref<string>((uni.getStorageSync('userId') as string) || '');

  if (token.value) setAuthToken(token.value);

  function setSession(nextToken: string, nextUserId: string): void {
    token.value = nextToken;
    userId.value = nextUserId;
    setAuthToken(nextToken);
    uni.setStorageSync('token', nextToken);
    uni.setStorageSync('userId', nextUserId);
  }

  async function login(phone: string, code: string): Promise<void> {
    const res = await apiLogin(phone, code);
    setSession(res.token, res.userId);
  }

  function logout(): void {
    token.value = '';
    userId.value = '';
    setAuthToken(null);
    uni.removeStorageSync('token');
    uni.removeStorageSync('userId');
  }

  return { token, userId, setSession, login, logout };
});
```

- [ ] **Step 4: 跑测试确认通过**

```bash
pnpm vitest run tests/stores.spec.ts
```

Expected: `5 passed`。

- [ ] **Step 5: 提交**

```bash
cd /Users/lkz/202507/record-replay
git add apps/app/src/stores/auth.ts apps/app/tests/stores.spec.ts
git commit -m "feat(app): add auth store with token persistence"
```

---

## Task 8: session store（当前人格与任务）

**Files:**
- Create: `apps/app/src/stores/session.ts`
- Modify: `apps/app/tests/stores.spec.ts`（追加 session 用例）

- [ ] **Step 1: 追加测试到 `tests/stores.spec.ts`**

```ts
import { useSessionStore } from '../src/stores/session';

describe('session store', () => {
  it('初始 personaId 为空', () => {
    uni.removeStorageSync('personaId');
    const store = useSessionStore();
    expect(store.personaId).toBe('');
  });

  it('setPersona 写入并持久化', () => {
    const store = useSessionStore();
    store.setPersona('p-1');
    expect(store.personaId).toBe('p-1');
    expect(uni.getStorageSync('personaId')).toBe('p-1');
  });

  it('setTask 记录 taskId（不持久化）', () => {
    const store = useSessionStore();
    store.setTask('t-1');
    expect(store.taskId).toBe('t-1');
    expect(uni.getStorageSync('taskId')).toBe('');
  });

  it('reset 清空并删除持久化', () => {
    const store = useSessionStore();
    store.setPersona('p-1');
    store.setTask('t-1');
    store.reset();
    expect(store.personaId).toBe('');
    expect(store.taskId).toBe('');
    expect(uni.getStorageSync('personaId')).toBe('');
  });

  it('从 storage 恢复 personaId', () => {
    uni.setStorageSync('personaId', 'p-restored');
    const store = useSessionStore();
    expect(store.personaId).toBe('p-restored');
    uni.removeStorageSync('personaId');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
pnpm vitest run tests/stores.spec.ts
```

Expected: FAIL，`Cannot find module '../src/stores/session'`。

- [ ] **Step 3: 写 `src/stores/session.ts`**

```ts
import { defineStore } from 'pinia';
import { ref } from 'vue';

export const useSessionStore = defineStore('session', () => {
  const personaId = ref<string>((uni.getStorageSync('personaId') as string) || '');
  const taskId = ref<string>('');

  function setPersona(id: string): void {
    personaId.value = id;
    uni.setStorageSync('personaId', id);
  }

  function setTask(id: string): void {
    taskId.value = id;
  }

  function reset(): void {
    personaId.value = '';
    taskId.value = '';
    uni.removeStorageSync('personaId');
  }

  return { personaId, taskId, setPersona, setTask, reset };
});
```

- [ ] **Step 4: 跑测试确认通过**

```bash
pnpm vitest run tests/stores.spec.ts
```

Expected: `10 passed`。

- [ ] **Step 5: 提交**

```bash
cd /Users/lkz/202507/record-replay
git add apps/app/src/stores/session.ts apps/app/tests/stores.spec.ts
git commit -m "feat(app): add session store for current persona and task"
```

---

## Task 9: 登录页

**Files:**
- Create: `apps/app/src/pages/login/index.vue`
- Modify: `apps/app/src/pages.json`
- Modify: `apps/app/src/main.ts`（注册 pinia）

- [ ] **Step 1: 写 `src/main.ts`**

```ts
import { createSSRApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';

export function createApp() {
  const app = createSSRApp(App);
  app.use(createPinia());
  return { app };
}
```

- [ ] **Step 2: 写 `src/App.vue`**

```vue
<script setup lang="ts">
import { onLaunch } from '@dcloudio/uni-app';
import { setAuthToken } from '@/api/request';

onLaunch(() => {
  const token = uni.getStorageSync('token') as string;
  if (token) setAuthToken(token);
});
</script>

<style>
page {
  background-color: #f6f6f8;
}
</style>
```

- [ ] **Step 3: 写 `src/pages.json`**

```json
{
  "pages": [
    {
      "path": "pages/login/index",
      "style": { "navigationBarTitleText": "登录" }
    },
    {
      "path": "pages/home/index",
      "style": { "navigationBarTitleText": "创建数字人格" }
    },
    {
      "path": "pages/chat/index",
      "style": { "navigationBarTitleText": "对话" }
    }
  ],
  "globalStyle": {
    "navigationBarTextStyle": "black",
    "navigationBarTitleText": "怀念亲人",
    "navigationBarBackgroundColor": "#FFFFFF",
    "backgroundColor": "#F6F6F8"
  }
}
```

> 注意：此时 `pages/home/index.vue` 与 `pages/chat/index.vue` 还不存在，先建**占位文件**（Step 4），否则编译报错；Task 10、Task 11 会覆盖它们。

- [ ] **Step 4: 建两个占位页面**

`src/pages/home/index.vue`：

```vue
<template>
  <view>待实现</view>
</template>

<script setup lang="ts"></script>
```

`src/pages/chat/index.vue`：

```vue
<template>
  <view>待实现</view>
</template>

<script setup lang="ts"></script>
```

- [ ] **Step 5: 写 `src/pages/login/index.vue`**

```vue
<template>
  <view class="page">
    <view class="brand">
      <view class="title">怀念亲人</view>
      <view class="subtitle">让思念，有回声</view>
    </view>

    <input
      class="input"
      v-model="phone"
      type="number"
      maxlength="11"
      placeholder="请输入手机号"
      placeholder-class="ph"
    />

    <view class="row">
      <input
        class="input code"
        v-model="code"
        type="number"
        maxlength="6"
        placeholder="验证码"
        placeholder-class="ph"
      />
      <button class="btn-send" :disabled="counting > 0" @click="onSend">
        {{ counting > 0 ? `${counting}s` : '获取验证码' }}
      </button>
    </view>

    <button class="btn-primary" :loading="loading" :disabled="loading" @click="onLogin">登录</button>

    <view class="agreement">登录即代表同意《用户协议》与《隐私政策》</view>
  </view>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { PhoneSchema, CodeSchema } from '@record-replay/shared';
import { sendCode } from '@/api/auth';
import { useAuthStore } from '@/stores/auth';

const auth = useAuthStore();

const phone = ref('');
const code = ref('');
const counting = ref(0);
const loading = ref(false);

function toast(title: string) {
  uni.showToast({ title, icon: 'none' });
}

async function onSend() {
  if (!PhoneSchema.safeParse(phone.value).success) return toast('请输入正确的手机号');
  try {
    await sendCode(phone.value);
    toast('验证码已发送');
    counting.value = 60;
    const timer = setInterval(() => {
      counting.value -= 1;
      if (counting.value <= 0) clearInterval(timer);
    }, 1000);
  } catch (e) {
    toast((e as Error).message);
  }
}

async function onLogin() {
  if (!PhoneSchema.safeParse(phone.value).success) return toast('请输入正确的手机号');
  if (!CodeSchema.safeParse(code.value).success) return toast('请输入 6 位验证码');
  loading.value = true;
  try {
    await auth.login(phone.value, code.value);
    uni.reLaunch({ url: '/pages/home/index' });
  } catch (e) {
    toast((e as Error).message);
  } finally {
    loading.value = false;
  }
}
</script>

<style scoped>
.page {
  padding: 120rpx 48rpx 0;
}
.brand {
  margin-bottom: 80rpx;
}
.title {
  font-size: 52rpx;
  font-weight: 700;
  color: #1a1a1a;
}
.subtitle {
  margin-top: 16rpx;
  font-size: 28rpx;
  color: #8a8a94;
}
.input {
  height: 96rpx;
  padding: 0 28rpx;
  background: #ffffff;
  border-radius: 20rpx;
  font-size: 30rpx;
  margin-bottom: 24rpx;
}
.ph {
  color: #b6b6bf;
}
.row {
  display: flex;
  align-items: flex-start;
  gap: 20rpx;
}
.code {
  flex: 1;
  margin-bottom: 0;
}
.btn-send {
  width: 240rpx;
  height: 96rpx;
  line-height: 96rpx;
  font-size: 28rpx;
  color: #2b6cff;
  background: #eaf1ff;
  border-radius: 20rpx;
  margin: 0;
}
.btn-send[disabled] {
  color: #9d9da8;
  background: #efeff3;
}
.btn-primary {
  margin-top: 48rpx;
  height: 96rpx;
  line-height: 96rpx;
  font-size: 32rpx;
  color: #ffffff;
  background: #2b6cff;
  border-radius: 20rpx;
}
.agreement {
  margin-top: 40rpx;
  text-align: center;
  font-size: 24rpx;
  color: #a8a8b2;
}
</style>
```

- [ ] **Step 6: 编译验证（H5）**

```bash
cd /Users/lkz/202507/record-replay/apps/app
pnpm dev:h5
```

Expected: 控制台出现本地预览地址；浏览器打开能看到登录页（此时点收验证码会因后端未起而失败，属正常）。

- [ ] **Step 7: 提交**

```bash
cd /Users/lkz/202507/record-replay
git add apps/app/src/main.ts apps/app/src/App.vue apps/app/src/pages.json apps/app/src/pages
git commit -m "feat(app): add pinia bootstrap, routes and sms login page"
```

---

## Task 10: 录音 composable + 首页（上传与建立人格）

**Files:**
- Create: `apps/app/src/utils/recorder.ts`
- Modify: `apps/app/src/pages/home/index.vue`

- [ ] **Step 1: 写 `src/utils/recorder.ts`**

```ts
import { ref, onUnmounted } from 'vue';

interface RecorderStopResult {
  tempFilePath: string;
}

export interface RecorderManagerLike {
  start(options: { duration: number; format: string }): void;
  stop(): void;
  onStop(cb: (res: RecorderStopResult) => void): void;
  onError(cb: (err: { errMsg?: string }) => void): void;
}

export const MAX_RECORD_SECONDS = 20;

export function useRecorder(maxSeconds = MAX_RECORD_SECONDS) {
  const recording = ref(false);
  const seconds = ref(0);
  const tempFilePath = ref('');
  let timer: ReturnType<typeof setInterval> | null = null;

  const manager = uni.getRecorderManager() as unknown as RecorderManagerLike;

  function stopTimer() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  manager.onStop((res) => {
    recording.value = false;
    stopTimer();
    tempFilePath.value = res.tempFilePath;
  });

  manager.onError((err) => {
    recording.value = false;
    stopTimer();
    uni.showToast({ title: err?.errMsg ?? '录音失败', icon: 'none' });
  });

  function start() {
    tempFilePath.value = '';
    seconds.value = 0;
    recording.value = true;
    manager.start({ duration: maxSeconds * 1000, format: 'mp3' });
    stopTimer();
    timer = setInterval(() => {
      seconds.value += 1;
      if (seconds.value >= maxSeconds) manager.stop();
    }, 1000);
  }

  function stop() {
    if (recording.value) manager.stop();
  }

  onUnmounted(stopTimer);

  return { recording, seconds, tempFilePath, start, stop, maxSeconds };
}
```

> 该文件是设备胶水（依赖 `uni.getRecorderManager`），不进单测，由第 12 节手工验收。

- [ ] **Step 2: 写 `src/pages/home/index.vue`**

```vue
<template>
  <view class="page">
    <view class="section">
      <view class="label">1 · 上传一张正面照</view>
      <view class="hint">单人正脸、光线充足效果最好</view>
      <image v-if="avatarPath" class="avatar" :src="avatarPath" mode="aspectFill" @click="chooseAvatar" />
      <button v-else class="btn-ghost" @click="chooseAvatar">选择照片</button>
    </view>

    <view class="section">
      <view class="label">2 · 录一段 10–20 秒的朗读</view>
      <view class="hint">
        {{ recording ? `录音中 ${seconds}s，点击停止` : tempFilePath ? '已录制，可重录' : '安静环境下，像平时说话一样念一段' }}
      </view>
      <button class="btn-ghost" @click="toggleRecord">
        {{ recording ? '停止录音' : tempFilePath ? '重新录音' : '开始录音' }}
      </button>
    </view>

    <button class="btn-primary" :loading="submitting" :disabled="submitting" @click="onCreate">
      生成数字人格
    </button>

    <view v-if="statusText" class="status">{{ statusText }}</view>
  </view>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import type { PersonaStatus } from '@record-replay/shared';
import { uploadFile } from '@/api/media';
import { createPersona, getPersona } from '@/api/persona';
import { poll } from '@/utils/poll';
import { useRecorder } from '@/utils/recorder';
import { useSessionStore } from '@/stores/session';

const session = useSessionStore();
const { recording, seconds, tempFilePath, start, stop } = useRecorder();

const avatarPath = ref('');
const submitting = ref(false);
const status = ref<PersonaStatus | ''>('');

const statusText = computed(() => {
  switch (status.value) {
    case 'pending':
    case 'training':
      return '正在学习他/她的声音，请稍候…';
    case 'ready':
      return '数字人格已就绪';
    case 'failed':
      return '创建失败，请重试';
    default:
      return '';
  }
});

function toast(title: string) {
  uni.showToast({ title, icon: 'none' });
}

function chooseAvatar() {
  uni.chooseImage({
    count: 1,
    sizeType: ['compressed'],
    sourceType: ['album', 'camera'],
    success: (res) => {
      const paths = res.tempFilePaths as string[];
      if (paths.length) avatarPath.value = paths[0];
    },
  });
}

function toggleRecord() {
  if (recording.value) stop();
  else start();
}

async function onCreate() {
  if (!avatarPath.value) return toast('请先选择照片');
  if (!tempFilePath.value) return toast('请先录制语音');
  submitting.value = true;
  status.value = '';
  try {
    const [avatar, voice] = await Promise.all([
      uploadFile(avatarPath.value),
      uploadFile(tempFilePath.value),
    ]);
    const persona = await createPersona(avatar.url, voice.url);
    session.setPersona(persona.id);
    status.value = persona.status;

    await poll({
      fn: () => getPersona(persona.id),
      isDone: (p) => p.status === 'ready',
      isFailed: (p) => p.status === 'failed',
      intervalMs: 3000,
      timeoutMs: 180_000,
    });
    status.value = 'ready';
    toast('数字人格已就绪');
    uni.navigateTo({ url: `/pages/chat/index?personaId=${persona.id}` });
  } catch (e) {
    status.value = 'failed';
    toast((e as Error).message);
  } finally {
    submitting.value = false;
  }
}
</script>

<style scoped>
.page {
  padding: 40rpx 40rpx 80rpx;
}
.section {
  background: #ffffff;
  border-radius: 24rpx;
  padding: 40rpx;
  margin-bottom: 32rpx;
}
.label {
  font-size: 32rpx;
  font-weight: 600;
  color: #1a1a1a;
}
.hint {
  margin: 12rpx 0 28rpx;
  font-size: 26rpx;
  color: #8a8a94;
}
.avatar {
  width: 100%;
  height: 560rpx;
  border-radius: 20rpx;
}
.btn-ghost {
  height: 92rpx;
  line-height: 92rpx;
  font-size: 30rpx;
  color: #2b6cff;
  background: #eaf1ff;
  border-radius: 20rpx;
  margin: 0;
}
.btn-primary {
  height: 96rpx;
  line-height: 96rpx;
  font-size: 32rpx;
  color: #ffffff;
  background: #2b6cff;
  border-radius: 20rpx;
}
.status {
  margin-top: 32rpx;
  text-align: center;
  font-size: 26rpx;
  color: #6a6a74;
}
</style>
```

- [ ] **Step 3: 编译验证（H5）**

```bash
pnpm dev:h5
```

Expected: 登录后进入首页，可选择照片、录音、点「生成数字人格」（后端未起时会报网络错误，属正常）。

- [ ] **Step 4: 提交**

```bash
cd /Users/lkz/202507/record-replay
git add apps/app/src/utils/recorder.ts apps/app/src/pages/home/index.vue
git commit -m "feat(app): add recorder composable and persona creation page"
```

---

## Task 11: 对话页（提问 → 轮询 → 播放）

**Files:**
- Modify: `apps/app/src/pages/chat/index.vue`

- [ ] **Step 1: 写 `src/pages/chat/index.vue`**

```vue
<template>
  <view class="page">
    <view class="stage">
      <video
        v-if="videoUrl"
        class="video"
        :src="videoUrl"
        :poster="poster"
        controls
        autoplay
        object-fit="cover"
      />
      <view v-else class="placeholder">
        <image v-if="poster" class="poster" :src="poster" mode="aspectFill" />
        <view class="phase">{{ phaseText }}</view>
      </view>
    </view>

    <view v-if="answerText" class="bubble">
      <text class="quote">“{{ answerText }}”</text>
    </view>

    <view class="input-row">
      <input
        class="input"
        v-model="question"
        placeholder="对他说点什么…"
        placeholder-class="ph"
        :disabled="asking"
        confirm-type="send"
        @confirm="onAsk"
      />
      <button class="btn-send" :loading="asking" :disabled="asking" @click="onAsk">发送</button>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { onLoad } from '@dcloudio/uni-app';
import { AskSchema } from '@record-replay/shared';
import { ask, getTask } from '@/api/task';
import { getPersona } from '@/api/persona';
import { absoluteUrl } from '@/config';
import { poll } from '@/utils/poll';
import { useSessionStore } from '@/stores/session';

const session = useSessionStore();

const personaId = ref('');
const poster = ref('');
const question = ref('');
const answerText = ref('');
const videoUrl = ref('');
const asking = ref(false);
const phaseText = ref('输入一句话，让他/她来回答你');

onLoad(async (query) => {
  personaId.value = (query?.personaId as string) || session.personaId;
  if (!personaId.value) {
    uni.showToast({ title: '未找到人格档案', icon: 'none' });
    return;
  }
  try {
    const persona = await getPersona(personaId.value);
    poster.value = absoluteUrl(persona.avatarUrl);
  } catch {
    /* 头像加载失败不阻塞主流程 */
  }
});

async function onAsk() {
  const q = question.value.trim();
  if (!AskSchema.safeParse({ question: q }).success) {
    uni.showToast({ title: '请输入 1–200 字的问题', icon: 'none' });
    return;
  }
  asking.value = true;
  answerText.value = '';
  videoUrl.value = '';
  phaseText.value = '正在思考…';
  try {
    const { taskId } = await ask(personaId.value, q);
    session.setTask(taskId);

    const task = await poll({
      fn: () => getTask(taskId),
      isDone: (t) => t.status === 'done',
      isFailed: (t) => t.status === 'failed',
      intervalMs: 3000,
      timeoutMs: 300_000,
    });

    answerText.value = task.answerText ?? '';
    videoUrl.value = absoluteUrl(task.videoUrl ?? '');
    phaseText.value = '';
    question.value = '';
  } catch (e) {
    phaseText.value = (e as Error).message;
    uni.showToast({ title: (e as Error).message, icon: 'none' });
  } finally {
    asking.value = false;
  }
}
</script>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  padding: 32rpx;
  box-sizing: border-box;
}
.stage {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #101014;
  border-radius: 24rpx;
  overflow: hidden;
  min-height: 760rpx;
}
.video {
  width: 100%;
  height: 900rpx;
}
.placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
}
.poster {
  width: 320rpx;
  height: 320rpx;
  border-radius: 50%;
  opacity: 0.55;
}
.phase {
  margin-top: 32rpx;
  color: #cfcfd8;
  font-size: 28rpx;
}
.bubble {
  margin-top: 28rpx;
  background: #ffffff;
  border-radius: 20rpx;
  padding: 28rpx 32rpx;
}
.quote {
  font-size: 30rpx;
  color: #2a2a33;
  line-height: 1.6;
}
.input-row {
  display: flex;
  align-items: center;
  gap: 20rpx;
  margin-top: 24rpx;
  padding-bottom: env(safe-area-inset-bottom);
}
.input {
  flex: 1;
  height: 92rpx;
  padding: 0 28rpx;
  background: #ffffff;
  border-radius: 20rpx;
  font-size: 30rpx;
}
.ph {
  color: #b6b6bf;
}
.btn-send {
  width: 180rpx;
  height: 92rpx;
  line-height: 92rpx;
  font-size: 30rpx;
  color: #ffffff;
  background: #2b6cff;
  border-radius: 20rpx;
  margin: 0;
}
</style>
```

- [ ] **Step 2: 编译验证（H5）**

```bash
pnpm dev:h5
```

Expected: 进入对话页，输入问题点发送，出现「正在思考…」占位（后端未起时报网络错误，属正常）。

- [ ] **Step 3: 跑全量单测回归**

```bash
pnpm test
```

Expected: 全部通过（config 3 + request 8 + poll 5 + auth 2 + media 5 + persona 2 + task 2 + stores 10 = 37 passed）。

- [ ] **Step 4: 提交**

```bash
cd /Users/lkz/202507/record-replay
git add apps/app/src/pages/chat/index.vue
git commit -m "feat(app): add chat page with ask, poll and video playback"
```

---

## Task 12: manifest、真机演示配置与端到端验收

**Files:**
- Modify: `apps/app/src/manifest.json`
- Modify: `apps/app/.env.development`（真机演示时改公网基址）

- [ ] **Step 1: 确认 `src/manifest.json` 关键字段**

打开 `src/manifest.json`，确保：

```json
{
  "name": "怀念亲人",
  "appid": "",
  "description": "数字人格演示",
  "versionName": "1.0.0",
  "versionCode": "100",
  "app-plus": {
    "usingComponents": true,
    "nvueStyleCompiler": "uni-app",
    "compilerVersion": 3,
    "splashscreen": { "alwaysShowBeforeRender": true, "waiting": true, "autoclose": true, "delay": 0 },
    "modules": {},
    "distribute": {
      "android": {
        "permissions": [
          "<uses-permission android:name=\"android.permission.RECORD_AUDIO\"/>",
          "<uses-permission android:name=\"android.permission.CAMERA\"/>",
          "<uses-permission android:name=\"android.permission.INTERNET\"/>"
        ]
      },
      "ios": {
        "privacyDescription": {
          "NSMicrophoneUsageDescription": "用于录制声音样本，训练数字人格音色",
          "NSCameraUsageDescription": "用于拍摄或选择亲人照片",
          "NSPhotoLibraryUsageDescription": "用于选择亲人照片"
        }
      }
    }
  },
  "h5": {
    "router": { "mode": "hash" }
  }
}
```

> `appid` 留空即可：H5 演示不需要；用 HBuilderX 云打包 App 时再填 DCloud 分配的应用标识。

- [ ] **Step 2: 真机演示改用公网基址**

把 `apps/app/.env.development` 改为：

```
VITE_API_BASE_URL=http://23.147.68.16:31527/record-replay
```

> 手机与后端不在同一网络时，必须用 ChmlFrp 公网地址；本机同一局域网内也可用 `http://<本机内网IP>:3000`。
> 注意：H5 页面若通过 `https` 打开而后端是 `http`，会被浏览器混合内容策略拦截——演示统一用 `http` 打开 H5。

- [ ] **Step 3: 启动后端与 App，走完整链路**

```bash
# 终端 A（后端 + 基础设施）
cd /Users/lkz/202507/record-replay
pnpm infra:up
pnpm dev:api

# 终端 B（App H5）
pnpm dev:app
```

在浏览器（或手机浏览器）打开 App 地址，依次验证：

1. 登录页输入 `15920328477`，点「获取验证码」，手机收到真实短信
2. 输入收到的 6 位验证码，点「登录」，跳转首页
3. 首页选择一张单人正脸照，录一段 10–20 秒语音，点「生成数字人格」
4. 首页出现「正在学习他/她的声音…」，轮询至「数字人格已就绪」并自动跳转对话页
5. 对话页输入一句话（例如「爸爸，你最近还好吗？」），点「发送」
6. 先出现回答文字，随后自动播放播报视频

Expected: 6 步全部成功；视频可播放且带克隆音色。

- [ ] **Step 4: 真机（iOS / Android）打包验证**

用 HBuilderX 打开 `apps/app`，在 `manifest.json` 填好 DCloud `appid` 后「发行 → 原生 App 云打包」，分别出 iOS 与 Android 调试包，安装到手机重复 Step 3 的 6 步。

> 真机需授权麦克风与相册权限；因 Step 2 使用 `http` 公网地址，iOS 需在 manifest 勾选「允许 HTTP 请求」（ATS 例外）。

- [ ] **Step 5: 提交**

```bash
cd /Users/lkz/202507/record-replay
git add apps/app/src/manifest.json apps/app/.env.development
git commit -m "chore(app): configure permissions and public base url for device demo"
```

---

## 手工验收清单（真机）

- [ ] iOS / Android 均可安装启动，无白屏
- [ ] 真实短信能收到，60 秒倒计时正常
- [ ] 选择照片后在首页正确预览
- [ ] 录音有秒数递增，停止后提示「已录制」
- [ ] 上传进度后人格状态从「学习中」到「就绪」
- [ ] 提问后先出文字，再自动播放视频，音色是克隆音色
- [ ] 视频带 AIGC 水印（正常，不得去除）
- [ ] 断网时给出可读错误提示，不崩溃
- [ ] 长问题（>200 字）被前端拦截并提示

---

## 与后端计划的依赖关系

1. 本计划的单测（Task 2–8）**不依赖后端**，可独立完成与验收。
2. Task 9–11 的页面编译也不需要后端。
3. Task 12 的端到端验收**依赖后端计划全部完成**，且需要用户在 ChmlFrp 侧加好映射、提供火山与阿里云凭证。
4. 若后端接口字段有调整，同步修改 `packages/shared` 与 `src/api/*.ts` 的类型定义。
