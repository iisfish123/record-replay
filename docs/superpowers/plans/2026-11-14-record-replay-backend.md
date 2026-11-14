# record-replay 实施计划（一）：后端与基础设施

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 搭起 `record-replay` 的 pnpm monorepo 与 NestJS 后端，打通「短信登录 → 上传 → 人格 → 提问 → 生成播报视频」的全部服务端能力。

**Architecture:** NestJS 分层，第三方能力（短信 / LLM / 声音复刻 / 口型视频）各自封装成可替换的 Provider，业务层只依赖接口；音色训练与视频生成都是异步任务，统一由 `TaskModule` 编排与轮询。

**Tech Stack:** pnpm workspace · NestJS 11 · TypeORM · MySQL 8 · Redis 7 · JWT · zod · Jest + supertest · 阿里云 Dypnsapi · DeepSeek · 火山引擎（声音复刻 / OmniHuman）

**关联规格：** `docs/superpowers/specs/2026-11-14-record-replay-design.md`

---

## 文件结构（本计划涉及）

```
record-replay/
├─ package.json                                  # workspace 根脚本
├─ pnpm-workspace.yaml
├─ .gitignore
├─ docker/docker-compose.yml                     # MySQL + Redis
├─ packages/shared/
│  ├─ package.json
│  ├─ tsconfig.json
│  └─ src/
│     ├─ index.ts                                # 统一导出
│     └─ dto.ts                                  # zod schema + 类型
└─ apps/api/
   ├─ package.json
   ├─ tsconfig.json
   ├─ jest.config.js
   ├─ .env.development / .env.example
   ├─ storage/                                   # 上传文件与生成视频落盘目录
   ├─ src/
   │  ├─ main.ts
   │  ├─ app.module.ts
   │  ├─ config/configuration.ts                 # 环境变量集中读取
   │  ├─ health/health.controller.ts
   │  ├─ auth/
   │  │  ├─ auth.module.ts
   │  │  ├─ auth.controller.ts
   │  │  ├─ auth.service.ts
   │  │  ├─ sms.service.ts
   │  │  ├─ jwt.guard.ts
   │  │  └─ entities/user.entity.ts
   │  ├─ media/
   │  │  ├─ media.module.ts
   │  │  ├─ media.controller.ts
   │  │  ├─ media.service.ts
   │  │  └─ storage.config.ts
   │  ├─ persona/
   │  │  ├─ persona.module.ts
   │  │  ├─ persona.controller.ts
   │  │  ├─ persona.service.ts
   │  │  └─ entities/persona.entity.ts
   │  ├─ providers/
   │  │  ├─ providers.module.ts
   │  │  ├─ chat/chat.provider.ts                 # 接口 + DeepSeek 实现
   │  │  ├─ voice/voice.provider.ts               # 接口 + 火山实现
   │  │  └─ render/render.provider.ts             # 接口 + OmniHuman 实现
   │  └─ task/
   │     ├─ task.module.ts
   │     ├─ task.controller.ts
   │     ├─ task.service.ts
   │     ├─ entities/render-task.entity.ts
   │     └─ answer-limiter.ts
   └─ test/
      └─ e2e.spec.ts
```

---

## Task 1: 初始化 pnpm monorepo 骨架

**Files:**
- Create: `record-replay/package.json`
- Create: `record-replay/pnpm-workspace.yaml`
- Create: `record-replay/.gitignore`
- Create: `record-replay/packages/shared/package.json`

- [ ] **Step 1: 建目录并初始化 git**

```bash
mkdir -p /Users/lkz/202507/record-replay/{apps,packages/shared/src,docker,docs}
cd /Users/lkz/202507/record-replay && git init
```

- [ ] **Step 2: 写 workspace 根 package.json**

`package.json`：

```json
{
  "name": "record-replay",
  "private": true,
  "packageManager": "pnpm@10.20.0",
  "scripts": {
    "infra:up": "docker compose -f docker/docker-compose.yml up -d",
    "infra:down": "docker compose -f docker/docker-compose.yml down",
    "dev:api": "pnpm --filter @record-replay/api start:dev",
    "dev:app": "pnpm --filter @record-replay/app dev:h5",
    "build": "pnpm -r build",
    "test": "pnpm -r test"
  },
  "devDependencies": {
    "typescript": "^5.9.3"
  }
}
```

- [ ] **Step 3: 写 pnpm-workspace.yaml**

```yaml
packages:
  - 'apps/*'
  - 'packages/*'
```

- [ ] **Step 4: 写 .gitignore**

```
node_modules/
dist/
.env
.env.*
!.env.example
apps/api/storage/
*.log
.DS_Store
unpackage/
```

- [ ] **Step 5: 写 packages/shared/package.json**

```json
{
  "name": "@record-replay/shared",
  "version": "0.0.1",
  "private": true,
  "main": "src/index.ts",
  "types": "src/index.ts",
  "scripts": {
    "build": "tsc --noEmit",
    "test": "echo \"no tests\" && exit 0"
  },
  "dependencies": {
    "zod": "^4.1.12"
  },
  "devDependencies": {
    "typescript": "^5.9.3"
  }
}
```

- [ ] **Step 6: 安装依赖并验证**

```bash
cd /Users/lkz/202507/record-replay && pnpm install
```
Expected: 生成 `pnpm-lock.yaml`，无报错。

- [ ] **Step 7: 提交**

```bash
cd /Users/lkz/202507/record-replay
git add package.json pnpm-workspace.yaml .gitignore packages/shared/package.json
git commit -m "chore: init pnpm workspace skeleton"
```

---

## Task 2: 起基础设施（MySQL + Redis）

**Files:**
- Create: `record-replay/docker/docker-compose.yml`

- [ ] **Step 1: 写 docker-compose.yml**

```yaml
name: record-replay

services:
  mysql:
    image: mysql:8.4
    container_name: record-replay-mysql
    environment:
      MYSQL_ROOT_PASSWORD: recordreplay
      MYSQL_DATABASE: record_replay
    ports:
      - "3316:3306"
    command: --character-set-server=utf8mb4 --collation-server=utf8mb4_unicode_ci
    volumes:
      - ./mysql_data:/var/lib/mysql
    healthcheck:
      test: ["CMD", "mysqladmin", "ping", "-h", "127.0.0.1", "-precordreplay"]
      interval: 5s
      timeout: 5s
      retries: 20

  redis:
    image: redis:7-alpine
    container_name: record-replay-redis
    ports:
      - "6389:6379"
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 20
```

> 端口刻意避开 3306/6379，防止与你机器上已有服务冲突。

- [ ] **Step 2: 启动并验证**

```bash
cd /Users/lkz/202507/record-replay && pnpm infra:up
docker compose -f docker/docker-compose.yml ps
```
Expected: 两个容器 `STATUS` 均为 `Up (healthy)`。

- [ ] **Step 3: 验证连通性**

```bash
docker exec record-replay-redis redis-cli ping
```
Expected: `PONG`

- [ ] **Step 4: 提交**

```bash
git add docker/docker-compose.yml
git commit -m "chore: add mysql and redis compose"
```

---

## Task 3: NestJS 骨架 + TypeORM + 健康检查

**Files:**
- Create: `apps/api/package.json`
- Create: `apps/api/tsconfig.json`
- Create: `apps/api/jest.config.js`
- Create: `apps/api/src/main.ts`
- Create: `apps/api/src/app.module.ts`
- Create: `apps/api/src/config/configuration.ts`
- Create: `apps/api/src/health/health.controller.ts`
- Test: `apps/api/test/health.e2e-spec.ts`

- [ ] **Step 1: 写 apps/api/package.json**

```json
{
  "name": "@record-replay/api",
  "version": "0.0.1",
  "private": true,
  "scripts": {
    "build": "nest build",
    "start:dev": "nest start --watch",
    "test": "jest",
    "test:e2e": "jest --config jest.config.js --runInBand"
  },
  "dependencies": {
    "@nestjs/common": "^11.1.6",
    "@nestjs/config": "^4.0.2",
    "@nestjs/core": "^11.1.6",
    "@nestjs/jwt": "^11.0.1",
    "@nestjs/platform-express": "^11.1.6",
    "@nestjs/typeorm": "^11.0.0",
    "@record-replay/shared": "workspace:*",
    "@alicloud/credentials": "^2.4.4",
    "@alicloud/dypnsapi20170525": "2.0.0",
    "@alicloud/openapi-client": "^0.4.15",
    "@alicloud/tea-util": "^1.4.11",
    "ioredis": "^5.8.1",
    "mysql2": "^3.15.0",
    "reflect-metadata": "^0.2.2",
    "rxjs": "^7.8.2",
    "typeorm": "^0.3.27",
    "zod": "^4.1.12"
  },
  "devDependencies": {
    "@nestjs/cli": "^11.0.10",
    "@nestjs/schematics": "^11.0.8",
    "@nestjs/testing": "^11.1.6",
    "@types/express": "^5.0.3",
    "@types/jest": "^30.0.0",
    "@types/multer": "^2.0.0",
    "@types/node": "^22.15.0",
    "@types/supertest": "^6.0.3",
    "jest": "^30.0.0",
    "supertest": "^7.1.4",
    "ts-jest": "^29.4.0",
    "ts-node": "^10.9.2",
    "typescript": "^5.9.3"
  }
}
```

- [ ] **Step 2: 写 tsconfig.json**

```json
{
  "compilerOptions": {
    "module": "commonjs",
    "declaration": false,
    "removeComments": true,
    "emitDecoratorMetadata": true,
    "experimentalDecorators": true,
    "allowSyntheticDefaultImports": true,
    "target": "ES2022",
    "sourceMap": true,
    "outDir": "./dist",
    "baseUrl": "./",
    "incremental": true,
    "skipLibCheck": true,
    "strictNullChecks": true,
    "esModuleInterop": true,
    "moduleResolution": "node"
  },
  "include": ["src/**/*", "test/**/*"]
}
```

- [ ] **Step 3: 写 configuration.ts**

```ts
export interface AppConfig {
  port: number;
  publicBaseUrl: string;
  jwtSecret: string;
  jwtExpiresIn: string;
  mysql: { host: string; port: number; username: string; password: string; database: string };
  redis: { host: string; port: number };
  aliyun: { accessKeyId: string; accessKeySecret: string; signName: string; templateCode: string };
  deepseek: { apiKey: string; baseUrl: string; model: string };
  volcVoice: { appid: string; accessToken: string; cluster: string };
  volcOmni: { accessKeyId: string; accessKeySecret: string; reqKey: string };
  answerMaxChars: number;
}

export default (): AppConfig => ({
  port: parseInt(process.env.PORT ?? '3000', 10),
  publicBaseUrl: process.env.PUBLIC_BASE_URL ?? 'http://127.0.0.1:3000',
  jwtSecret: process.env.JWT_SECRET ?? 'dev-secret-change-me',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '7d',
  mysql: {
    host: process.env.MYSQL_HOST ?? '127.0.0.1',
    port: parseInt(process.env.MYSQL_PORT ?? '3316', 10),
    username: process.env.MYSQL_USER ?? 'root',
    password: process.env.MYSQL_PASSWORD ?? 'recordreplay',
    database: process.env.MYSQL_DATABASE ?? 'record_replay',
  },
  redis: {
    host: process.env.REDIS_HOST ?? '127.0.0.1',
    port: parseInt(process.env.REDIS_PORT ?? '6389', 10),
  },
  aliyun: {
    accessKeyId: process.env.ALIYUN_ACCESS_KEY_ID ?? '',
    accessKeySecret: process.env.ALIYUN_ACCESS_KEY_SECRET ?? '',
    signName: process.env.ALIYUN_SMS_SIGN_NAME ?? '速通互联验证码',
    templateCode: process.env.ALIYUN_SMS_TEMPLATE_CODE ?? '100001',
  },
  deepseek: {
    apiKey: process.env.DEEPSEEK_API_KEY ?? '',
    baseUrl: process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com',
    model: process.env.DEEPSEEK_MODEL ?? 'deepseek-flash',
  },
  volcVoice: {
    appid: process.env.VOLC_TTS_APPID ?? '',
    accessToken: process.env.VOLC_TTS_ACCESS_TOKEN ?? '',
    cluster: process.env.VOLC_TTS_CLUSTER ?? 'volcano_icl',
  },
  volcOmni: {
    accessKeyId: process.env.VOLC_ACCESS_KEY_ID ?? '',
    accessKeySecret: process.env.VOLC_ACCESS_KEY_SECRET ?? '',
    reqKey: process.env.VOLC_OMNI_REQ_KEY ?? 'realman_avatar_picture_omni_v2',
  },
  answerMaxChars: parseInt(process.env.ANSWER_MAX_CHARS ?? '70', 10),
});
```

- [ ] **Step 4: 写 .env.example**

```
PORT=3000
PUBLIC_BASE_URL=http://23.147.68.16:31527/record-replay
JWT_SECRET=change-me
JWT_EXPIRES_IN=7d

MYSQL_HOST=127.0.0.1
MYSQL_PORT=3316
MYSQL_USER=root
MYSQL_PASSWORD=recordreplay
MYSQL_DATABASE=record_replay

REDIS_HOST=127.0.0.1
REDIS_PORT=6389

ALIYUN_ACCESS_KEY_ID=
ALIYUN_ACCESS_KEY_SECRET=
ALIYUN_SMS_SIGN_NAME=速通互联验证码
ALIYUN_SMS_TEMPLATE_CODE=100001

DEEPSEEK_API_KEY=
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-flash

VOLC_TTS_APPID=
VOLC_TTS_ACCESS_TOKEN=
VOLC_TTS_CLUSTER=volcano_icl

VOLC_ACCESS_KEY_ID=
VOLC_ACCESS_KEY_SECRET=
VOLC_OMNI_REQ_KEY=realman_avatar_picture_omni_v2

ANSWER_MAX_CHARS=70
```

- [ ] **Step 5: 写 health.controller.ts**

```ts
import { Controller, Get } from '@nestjs/common';

@Controller('health')
export class HealthController {
  @Get()
  check() {
    return { ok: true, ts: Date.now() };
  }
}
```

- [ ] **Step 6: 写 app.module.ts**

```ts
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import configuration from './config/configuration';
import { HealthController } from './health/health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration], envFilePath: ['.env.development', '.env'] }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => ({
        type: 'mysql',
        host: cfg.get<string>('mysql.host'),
        port: cfg.get<number>('mysql.port'),
        username: cfg.get<string>('mysql.username'),
        password: cfg.get<string>('mysql.password'),
        database: cfg.get<string>('mysql.database'),
        autoLoadEntities: true,
        synchronize: true,
        timezone: 'Z',
      }),
    }),
  ],
  controllers: [HealthController],
})
export class AppModule {}
```

- [ ] **Step 7: 写 main.ts**

```ts
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors({ origin: true, credentials: true });
  await app.listen(process.env.PORT ?? 3000, '0.0.0.0');
  console.log(`api listening on ${process.env.PORT ?? 3000}`);
}
bootstrap();
```

- [ ] **Step 8: 写 jest.config.js**

```js
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: '.*\\.(spec|e2e-spec)\\.ts$',
  transform: { '^.+\\.ts$': 'ts-jest' },
  testEnvironment: 'node',
  testTimeout: 30000,
};
```

- [ ] **Step 9: 写失败测试 test/health.e2e-spec.ts**

```ts
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';

describe('health', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /health -> 200 ok', async () => {
    const res = await request(app.getHttpServer()).get('/health').expect(200);
    expect(res.body.ok).toBe(true);
  });
});
```

- [ ] **Step 10: 跑测试确认通过**

```bash
cd /Users/lkz/202507/record-replay
cp apps/api/.env.example apps/api/.env.development
pnpm install
pnpm --filter @record-replay/api test:e2e -- health
```
Expected: `Tests: 1 passed`

- [ ] **Step 11: 提交**

```bash
git add apps/api
git commit -m "feat(api): bootstrap nestjs with typeorm and health check"
```

---

## Task 4: packages/shared 定义共享契约

**Files:**
- Create: `packages/shared/src/dto.ts`
- Create: `packages/shared/src/index.ts`
- Test: `packages/shared/src/dto.spec.ts`

- [ ] **Step 1: 写失败测试 dto.spec.ts**

```ts
import { PhoneSchema, SendCodeSchema, LoginSchema, AskSchema, TaskStatusSchema } from './dto';

describe('shared dto', () => {
  it('接受合法手机号', () => {
    expect(PhoneSchema.safeParse('15920328477').success).toBe(true);
  });

  it('拒绝非法手机号', () => {
    expect(PhoneSchema.safeParse('12345').success).toBe(false);
  });

  it('验证码必须 6 位数字', () => {
    expect(SendCodeSchema.safeParse({ phone: '15920328477' }).success).toBe(true);
    expect(LoginSchema.safeParse({ phone: '15920328477', code: 'abc' }).success).toBe(false);
  });

  it('提问非空且不超过 200 字', () => {
    expect(AskSchema.safeParse({ question: '爸爸，你最近还好吗？' }).success).toBe(true);
    expect(AskSchema.safeParse({ question: '' }).success).toBe(false);
    expect(AskSchema.safeParse({ question: 'x'.repeat(201) }).success).toBe(false);
  });

  it('任务状态枚举完整', () => {
    expect(TaskStatusSchema.options).toEqual([
      'pending', 'answering', 'tts', 'rendering', 'done', 'failed',
    ]);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd /Users/lkz/202507/record-replay/packages/shared
pnpm dlx jest src/dto.spec.ts
```
Expected: FAIL，报 `Cannot find module './dto'`。

- [ ] **Step 3: 写 dto.ts**

```ts
import { z } from 'zod';

export const PhoneSchema = z.string().regex(/^1[3-9]\d{9}$/, '手机号格式不正确');
export const CodeSchema = z.string().regex(/^\d{6}$/, '验证码为 6 位数字');

export const SendCodeSchema = z.object({ phone: PhoneSchema });
export const LoginSchema = z.object({ phone: PhoneSchema, code: CodeSchema });
export const AskSchema = z.object({ question: z.string().min(1).max(200) });

export const PersonaStatusSchema = z.enum(['pending', 'training', 'ready', 'failed']);
export const TaskStatusSchema = z.enum([
  'pending', 'answering', 'tts', 'rendering', 'done', 'failed',
]);

export type SendCodeDto = z.infer<typeof SendCodeSchema>;
export type LoginDto = z.infer<typeof LoginSchema>;
export type AskDto = z.infer<typeof AskSchema>;
export type PersonaStatus = z.infer<typeof PersonaStatusSchema>;
export type TaskStatus = z.infer<typeof TaskStatusSchema>;
```

- [ ] **Step 4: 写 index.ts**

```ts
export * from './dto';
```

- [ ] **Step 5: 跑测试确认通过**

```bash
pnpm dlx jest src/dto.spec.ts
```
Expected: `Tests: 5 passed`

- [ ] **Step 6: 提交**

```bash
cd /Users/lkz/202507/record-replay
git add packages/shared
git commit -m "feat(shared): add zod contracts for phone, sms, ask and task status"
```

---

## Task 5: SmsService（阿里云 Dypnsapi 发码 + 校验）

**Files:**
- Create: `apps/api/src/auth/sms.service.ts`
- Test: `apps/api/src/auth/sms.service.spec.ts`

**接口契约**（阿里云 Dypnsapi 20170525，已核实）：
- 发码：`SendSmsVerifyCode({ PhoneNumber, SignName, TemplateCode, TemplateParam: '{"code":"123456","min":"5"}' })`
- 校验：`CheckSmsVerifyCode({ PhoneNumber, VerifyCode, CountryCode: '86' })`，返回体 `body.code === 'OK'` 即通过

- [ ] **Step 1: 写失败测试 sms.service.spec.ts**

```ts
import { SmsService } from './sms.service';

describe('SmsService', () => {
  const createClient = () => ({
    sendSmsVerifyCodeWithOptions: jest.fn().mockResolvedValue({ body: { code: 'OK' } }),
    checkSmsVerifyCodeWithOptions: jest.fn().mockResolvedValue({ body: { code: 'OK', verifyResult: 'PASS' } }),
  });

  it('发码时生成 6 位数字并带上签名与模板', async () => {
    const client = createClient();
    const svc = new SmsService(client as any, {
      signName: '速通互联验证码', templateCode: '100001',
    } as any);

    await svc.send('15920328477');

    const req = client.sendSmsVerifyCodeWithOptions.mock.calls[0][0];
    expect(req.phoneNumber).toBe('15920328477');
    expect(req.signName).toBe('速通互联验证码');
    expect(req.templateCode).toBe('100001');
    const param = JSON.parse(req.templateParam);
    expect(param.code).toMatch(/^\d{6}$/);
    expect(param.min).toBe('5');
  });

  it('校验通过返回 true', async () => {
    const client = createClient();
    const svc = new SmsService(client as any, { signName: 's', templateCode: 't' } as any);
    await expect(svc.check('15920328477', '123456')).resolves.toBe(true);
    expect(client.checkSmsVerifyCodeWithOptions).toHaveBeenCalled();
  });

  it('校验失败返回 false', async () => {
    const client = createClient();
    client.checkSmsVerifyCodeWithOptions.mockResolvedValue({ body: { code: 'isv.INVALID_PARAMETERS' } });
    const svc = new SmsService(client as any, { signName: 's', templateCode: 't' } as any);
    await expect(svc.check('15920328477', '000000')).resolves.toBe(false);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd /Users/lkz/202507/record-replay/apps/api
pnpm test -- sms.service
```
Expected: FAIL，`Cannot find module './sms.service'`。

- [ ] **Step 3: 写 sms.service.ts**

```ts
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Dypnsapi20170525, * as $Dypnsapi from '@alicloud/dypnsapi20170525';
import Util, * as $Util from '@alicloud/tea-util';

export interface SmsClient {
  sendSmsVerifyCodeWithOptions(req: $Dypnsapi.SendSmsVerifyCodeRequest, runtime?: $Util.RuntimeOptions): Promise<any>;
  checkSmsVerifyCodeWithOptions(req: $Dypnsapi.CheckSmsVerifyCodeRequest, runtime?: $Util.RuntimeOptions): Promise<any>;
}

export interface SmsOptions {
  signName: string;
  templateCode: string;
}

export const SMS_CLIENT = Symbol('SMS_CLIENT');
export const SMS_OPTIONS = Symbol('SMS_OPTIONS');

@Injectable()
export class SmsService {
  constructor(
    @Inject(SMS_CLIENT) private readonly client: SmsClient,
    @Inject(SMS_OPTIONS) private readonly options: SmsOptions,
  ) {}

  async send(phone: string): Promise<void> {
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const req = new $Dypnsapi.SendSmsVerifyCodeRequest({
      phoneNumber: phone,
      signName: this.options.signName,
      templateCode: this.options.templateCode,
      templateParam: JSON.stringify({ code, min: '5' }),
    });
    const resp = await this.client.sendSmsVerifyCodeWithOptions(req, new $Util.RuntimeOptions({}));
    const bodyCode = resp?.body?.code ?? resp?.body?.Code;
    if (bodyCode !== 'OK') {
      throw new Error(`短信发送失败: ${JSON.stringify(resp?.body ?? resp)}`);
    }
  }

  async check(phone: string, verifyCode: string): Promise<boolean> {
    const req = new $Dypnsapi.CheckSmsVerifyCodeRequest({
      phoneNumber: phone,
      verifyCode,
      countryCode: '86',
    });
    const resp = await this.client.checkSmsVerifyCodeWithOptions(req, new $Util.RuntimeOptions({}));
    return (resp?.body?.code ?? resp?.body?.Code) === 'OK';
  }
}
```

> `SmsService` 只依赖注入进来的 `client`，不自己 new 客户端——这样单测可以注入假客户端，生产环境在 Task 6 里由工厂创建真客户端。

- [ ] **Step 4: 跑测试确认通过**

```bash
pnpm test -- sms.service
```
Expected: `Tests: 3 passed`

- [ ] **Step 5: 提交**

```bash
cd /Users/lkz/202507/record-replay
git add apps/api/src/auth/sms.service.ts apps/api/src/auth/sms.service.spec.ts
git commit -m "feat(api): add aliyun dypnsapi sms service"
```

---

## Task 6: AuthModule（发码 / 登录 / JWT 守卫）

**Files:**
- Create: `apps/api/src/auth/entities/user.entity.ts`
- Create: `apps/api/src/auth/auth.service.ts`
- Create: `apps/api/src/auth/auth.controller.ts`
- Create: `apps/api/src/auth/jwt.guard.ts`
- Create: `apps/api/src/auth/auth.module.ts`
- Modify: `apps/api/src/app.module.ts`
- Test: `apps/api/src/auth/auth.e2e-spec.ts`

- [ ] **Step 1: 写 user.entity.ts**

```ts
import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 11, unique: true })
  phone: string;

  @CreateDateColumn()
  createdAt: Date;
}
```

- [ ] **Step 2: 写失败测试 auth.e2e-spec.ts**

```ts
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { SMS_CLIENT } from '../src/auth/sms.service';

describe('auth e2e', () => {
  let app: INestApplication;
  const smsClient = {
    sendSmsVerifyCodeWithOptions: jest.fn().mockResolvedValue({ body: { code: 'OK' } }),
    checkSmsVerifyCodeWithOptions: jest.fn().mockResolvedValue({ body: { code: 'OK' } }),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(SMS_CLIENT)
      .useValue(smsClient)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('POST /auth/sms/send -> 200', async () => {
    await request(app.getHttpServer())
      .post('/auth/sms/send')
      .send({ phone: '15920328477' })
      .expect(200);
    expect(smsClient.sendSmsVerifyCodeWithOptions).toHaveBeenCalled();
  });

  it('POST /auth/sms/send 手机号非法 -> 400', async () => {
    await request(app.getHttpServer()).post('/auth/sms/send').send({ phone: 'abc' }).expect(400);
  });

  it('POST /auth/sms/login -> 返回 token，且自动建用户', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/sms/login')
      .send({ phone: '15920328477', code: '123456' })
      .expect(200);
    expect(typeof res.body.token).toBe('string');
    expect(res.body.token.length).toBeGreaterThan(20);
  });

  it('POST /auth/sms/login 验证码错误 -> 401', async () => {
    smsClient.checkSmsVerifyCodeWithOptions.mockResolvedValueOnce({ body: { code: 'FAIL' } });
    await request(app.getHttpServer())
      .post('/auth/sms/login')
      .send({ phone: '15920328477', code: '000000' })
      .expect(401);
  });
});
```

- [ ] **Step 3: 跑测试确认失败**

```bash
pnpm --filter @record-replay/api test:e2e -- auth
```
Expected: FAIL，404（路由不存在）。

- [ ] **Step 4: 写 auth.service.ts**

```ts
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import { Repository } from 'typeorm';
import { User } from './entities/user.entity';
import { SmsService } from './sms.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly sms: SmsService,
    private readonly jwt: JwtService,
    @InjectRepository(User) private readonly users: Repository<User>,
  ) {}

  async sendCode(phone: string): Promise<void> {
    await this.sms.send(phone);
  }

  async login(phone: string, code: string): Promise<{ token: string; userId: string }> {
    const ok = await this.sms.check(phone, code);
    if (!ok) throw new UnauthorizedException('验证码错误或已过期');

    let user = await this.users.findOne({ where: { phone } });
    if (!user) {
      user = await this.users.save(this.users.create({ phone }));
    }
    const token = await this.jwt.signAsync({ sub: user.id, phone: user.phone });
    return { token, userId: user.id };
  }
}
```

- [ ] **Step 5: 写 auth.controller.ts**

```ts
import { BadRequestException, Body, Controller, Post } from '@nestjs/common';
import { LoginSchema, SendCodeSchema } from '@record-replay/shared';
import { AuthService } from './auth.service';

@Controller('auth/sms')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('send')
  async send(@Body() body: unknown) {
    const parsed = SendCodeSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues[0].message);
    await this.auth.sendCode(parsed.data.phone);
    return { ok: true };
  }

  @Post('login')
  async login(@Body() body: unknown) {
    const parsed = LoginSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues[0].message);
    return this.auth.login(parsed.data.phone, parsed.data.code);
  }
}
```

- [ ] **Step 6: 写 jwt.guard.ts**

```ts
import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

@Injectable()
export class JwtGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const header: string | undefined = req.headers['authorization'];
    if (!header?.startsWith('Bearer ')) throw new UnauthorizedException('缺少令牌');
    try {
      req.user = await this.jwt.verifyAsync(header.slice(7));
      return true;
    } catch {
      throw new UnauthorizedException('令牌无效或已过期');
    }
  }
}
```

- [ ] **Step 7: 写 auth.module.ts**

```ts
import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import Credential, { Config } from '@alicloud/credentials';
import * as $OpenApi from '@alicloud/openapi-client';
import Dypnsapi20170525 from '@alicloud/dypnsapi20170525';
import { User } from './entities/user.entity';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { SMS_CLIENT, SMS_OPTIONS, SmsService } from './sms.service';
import { JwtGuard } from './jwt.guard';

@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([User]),
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => ({
        secret: cfg.get<string>('jwtSecret'),
        signOptions: { expiresIn: cfg.get<string>('jwtExpiresIn') },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    SmsService,
    JwtGuard,
    {
      provide: SMS_OPTIONS,
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => ({
        signName: cfg.get<string>('aliyun.signName'),
        templateCode: cfg.get<string>('aliyun.templateCode'),
      }),
    },
    {
      provide: SMS_CLIENT,
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => {
        const credential = new Credential(
          new Config({
            type: 'access_key',
            accessKeyId: cfg.get<string>('aliyun.accessKeyId'),
            accessKeySecret: cfg.get<string>('aliyun.accessKeySecret'),
          }),
        );
        const openApiConfig = new $OpenApi.Config({ credential });
        openApiConfig.endpoint = 'dypnsapi.aliyuncs.com';
        return new Dypnsapi20170525(openApiConfig);
      },
    },
  ],
  exports: [JwtModule, JwtGuard, SmsService],
})
export class AuthModule {}
```

- [ ] **Step 8: 在 app.module.ts 里挂上 AuthModule**

修改 `apps/api/src/app.module.ts` 的 `imports` 数组，追加 `AuthModule`：

```ts
import { AuthModule } from './auth/auth.module';
// ...
      }),
    }),
    AuthModule,
  ],
  controllers: [HealthController],
})
```

- [ ] **Step 9: 跑测试确认通过**

```bash
pnpm --filter @record-replay/api test:e2e -- auth
```
Expected: `Tests: 4 passed`

- [ ] **Step 10: 真实发一条短信验证**

```bash
cd /Users/lkz/202507/record-replay/apps/api
# 把 .env.development 里的 ALIYUN_ACCESS_KEY_ID / SECRET 填上（沿用 sso-demo/packages/sms/.env）
pnpm start:dev
# 另开终端：
curl -s -X POST http://127.0.0.1:3000/auth/sms/send \
  -H 'Content-Type: application/json' \
  -d '{"phone":"15920328477"}'
```
Expected: 返回 `{"ok":true}`，且 **15920328477 收到验证码短信**。用收到的码调 `/auth/sms/login`，应返回 `token`。

- [ ] **Step 11: 提交**

```bash
git add apps/api/src/auth apps/api/src/app.module.ts
git commit -m "feat(api): add sms login with jwt"
```

---

## Task 7: MediaModule（上传 + 静态服务 + 公网 URL）

**Files:**
- Create: `apps/api/src/media/storage.config.ts`
- Create: `apps/api/src/media/media.service.ts`
- Create: `apps/api/src/media/media.controller.ts`
- Create: `apps/api/src/media/media.module.ts`
- Modify: `apps/api/src/app.module.ts`
- Test: `apps/api/src/media/media.e2e-spec.ts`

- [ ] **Step 1: 写 storage.config.ts**

```ts
import { join } from 'node:path';

export const STORAGE_ROOT = join(process.cwd(), 'storage');
export const PUBLIC_URL_PREFIX = '/static';

export function toPublicUrl(publicBaseUrl: string, relativePath: string): string {
  const base = publicBaseUrl.replace(/\/+$/, '');
  const rel = relativePath.replace(/^\/+/, '');
  return `${base}${PUBLIC_URL_PREFIX}/${rel}`;
}
```

- [ ] **Step 2: 写失败测试 media.e2e-spec.ts**

```ts
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';

describe('media e2e', () => {
  let app: INestApplication;
  let token: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider('SMS_CLIENT')
      .useValue({
        sendSmsVerifyCodeWithOptions: jest.fn().mockResolvedValue({ body: { code: 'OK' } }),
        checkSmsVerifyCodeWithOptions: jest.fn().mockResolvedValue({ body: { code: 'OK' } }),
      })
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    const res = await request(app.getHttpServer())
      .post('/auth/sms/login')
      .send({ phone: '15920328477', code: '123456' });
    token = res.body.token;
  });

  afterAll(async () => {
    await app.close();
  });

  it('上传图片 -> 返回公网 URL', async () => {
    const res = await request(app.getHttpServer())
      .post('/media/upload')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', Buffer.from('fake-image-bytes'), 'avatar.jpg')
      .expect(201);
    expect(res.body.url).toMatch(/^https?:\/\/.+\/static\/uploads\/.+/);
  });

  it('未带 token -> 401', async () => {
    await request(app.getHttpServer())
      .post('/media/upload')
      .attach('file', Buffer.from('x'), 'a.jpg')
      .expect(401);
  });
});
```

> 注意：`SMS_CLIENT` 是 Symbol，`overrideProvider('SMS_CLIENT')` 不生效，直接改用 `overrideProvider(SMS_CLIENT)` 并 `import { SMS_CLIENT } from '../src/auth/sms.service'`。

- [ ] **Step 3: 跑测试确认失败**

```bash
pnpm --filter @record-replay/api test:e2e -- media
```
Expected: FAIL，404。

- [ ] **Step 4: 写 media.service.ts**

```ts
import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mkdir, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { STORAGE_ROOT, toPublicUrl } from './storage.config';

const IMAGE_MAX_BYTES = 5 * 1024 * 1024;

@Injectable()
export class MediaService {
  constructor(private readonly cfg: ConfigService) {}

  async saveUpload(file: { originalname: string; mimetype: string; size: number; buffer: Buffer }, kind: 'image' | 'audio'): Promise<string> {
    if (!file) throw new BadRequestException('缺少文件');
    if (kind === 'image' && file.size > IMAGE_MAX_BYTES) {
      throw new BadRequestException('图片不能超过 5MB');
    }
    const dir = join(STORAGE_ROOT, 'uploads');
    await mkdir(dir, { recursive: true });
    const ext = extname(file.originalname) || (kind === 'image' ? '.jpg' : '.mp3');
    const name = `${randomUUID()}${ext}`;
    await writeFile(join(dir, name), file.buffer);
    return toPublicUrl(this.cfg.get<string>('publicBaseUrl')!, `uploads/${name}`);
  }
}
```

- [ ] **Step 5: 写 media.controller.ts**

```ts
import { BadRequestException, Controller, Post, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtGuard } from '../auth/jwt.guard';
import { MediaService } from './media.service';

@Controller('media')
@UseGuards(JwtGuard)
export class MediaController {
  constructor(private readonly media: MediaService) {}

  @Post('upload')
  @UseInterceptors(FileInterceptor('file'))
  async upload(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('缺少文件');
    const kind = file.mimetype.startsWith('image/') ? 'image' : 'audio';
    const url = await this.media.saveUpload(file, kind);
    return { url, kind };
  }
}
```

- [ ] **Step 6: 写 media.module.ts**

```ts
import { Module } from '@nestjs/common';
import { MediaController } from './media.controller';
import { MediaService } from './media.service';

@Module({
  controllers: [MediaController],
  providers: [MediaService],
  exports: [MediaService],
})
export class MediaModule {}
```

- [ ] **Step 7: 挂静态目录 + 注册模块**

在 `apps/api/src/main.ts` 的 `NestFactory.create` 之后、`listen` 之前加：

```ts
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'node:path';
import { STORAGE_ROOT, PUBLIC_URL_PREFIX } from './media/storage.config';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.useStaticAssets(STORAGE_ROOT, { prefix: PUBLIC_URL_PREFIX });
  app.enableCors({ origin: true, credentials: true });
  // ...
}
```

在 `app.module.ts` 的 `imports` 追加 `MediaModule`。

- [ ] **Step 8: 跑测试确认通过**

```bash
pnpm --filter @record-replay/api test:e2e -- media
```
Expected: `Tests: 2 passed`

- [ ] **Step 9: 提交**

```bash
git add apps/api/src/media apps/api/src/main.ts apps/api/src/app.module.ts
git commit -m "feat(api): add media upload and static hosting"
```

---

## Task 8: PersonaModule（人格档案）

**Files:**
- Create: `apps/api/src/persona/entities/persona.entity.ts`
- Create: `apps/api/src/persona/persona.service.ts`
- Create: `apps/api/src/persona/persona.controller.ts`
- Create: `apps/api/src/persona/persona.module.ts`
- Modify: `apps/api/src/app.module.ts`
- Test: `apps/api/src/persona/persona.e2e-spec.ts`

- [ ] **Step 1: 写 persona.entity.ts**

```ts
import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('personas')
export class Persona {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'char', length: 36 })
  userId: string;

  @Column({ type: 'varchar', length: 512 })
  avatarUrl: string;

  @Column({ type: 'varchar', length: 512 })
  voiceSampleUrl: string;

  @Column({ type: 'varchar', length: 128, nullable: true })
  speakerId: string | null;

  @Column({ type: 'varchar', length: 16, default: 'pending' })
  status: 'pending' | 'training' | 'ready' | 'failed';

  @Column({ type: 'text', nullable: true })
  error: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
```

- [ ] **Step 2: 写 persona.service.ts**

```ts
import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Persona } from './entities/persona.entity';

@Injectable()
export class PersonaService {
  constructor(@InjectRepository(Persona) private readonly repo: Repository<Persona>) {}

  async create(userId: string, avatarUrl: string, voiceSampleUrl: string): Promise<Persona> {
    return this.repo.save(this.repo.create({ userId, avatarUrl, voiceSampleUrl, status: 'pending' }));
  }

  async findOwned(id: string, userId: string): Promise<Persona> {
    const persona = await this.repo.findOne({ where: { id } });
    if (!persona) throw new NotFoundException('人格不存在');
    if (persona.userId !== userId) throw new ForbiddenException('无权访问该人格');
    return persona;
  }

  async updateStatus(id: string, status: Persona['status'], patch: Partial<Persona> = {}): Promise<void> {
    await this.repo.update(id, { status, ...patch });
  }
}
```

- [ ] **Step 3: 写失败测试 persona.e2e-spec.ts**

```ts
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { SMS_CLIENT } from '../src/auth/sms.service';

describe('persona e2e', () => {
  let app: INestApplication;
  let token: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(SMS_CLIENT)
      .useValue({
        sendSmsVerifyCodeWithOptions: jest.fn().mockResolvedValue({ body: { code: 'OK' } }),
        checkSmsVerifyCodeWithOptions: jest.fn().mockResolvedValue({ body: { code: 'OK' } }),
      })
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    const res = await request(app.getHttpServer())
      .post('/auth/sms/login')
      .send({ phone: '15920328477', code: '123456' });
    token = res.body.token;
  });

  afterAll(async () => {
    await app.close();
  });

  it('创建人格 -> status=pending', async () => {
    const res = await request(app.getHttpServer())
      .post('/personas')
      .set('Authorization', `Bearer ${token}`)
      .field('avatarUrl', 'http://x/a.jpg')
      .field('voiceSampleUrl', 'http://x/v.mp3')
      .expect(201);
    expect(res.body.status).toBe('pending');
    expect(res.body.id).toBeTruthy();
  });

  it('查询人格 -> 200', async () => {
    const created = await request(app.getHttpServer())
      .post('/personas')
      .set('Authorization', `Bearer ${token}`)
      .field('avatarUrl', 'http://x/a.jpg')
      .field('voiceSampleUrl', 'http://x/v.mp3');
    const res = await request(app.getHttpServer())
      .get(`/personas/${created.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(res.body.id).toBe(created.body.id);
  });
});
```

- [ ] **Step 4: 跑测试确认失败**

```bash
pnpm --filter @record-replay/api test:e2e -- persona
```
Expected: FAIL，404。

- [ ] **Step 5: 写 persona.controller.ts**

```ts
import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { JwtGuard } from '../auth/jwt.guard';
import { PersonaService } from './persona.service';

@Controller('personas')
@UseGuards(JwtGuard)
export class PersonaController {
  constructor(private readonly personas: PersonaService) {}

  @Post()
  async create(
    @Req() req: any,
    @Body() body: { avatarUrl: string; voiceSampleUrl: string },
  ) {
    return this.personas.create(req.user.sub, body.avatarUrl, body.voiceSampleUrl);
  }

  @Get(':id')
  async get(@Req() req: any, @Param('id') id: string) {
    return this.personas.findOwned(id, req.user.sub);
  }
}
```

- [ ] **Step 6: 写 persona.module.ts**

```ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Persona } from './entities/persona.entity';
import { PersonaController } from './persona.controller';
import { PersonaService } from './persona.service';

@Module({
  imports: [TypeOrmModule.forFeature([Persona])],
  controllers: [PersonaController],
  providers: [PersonaService],
  exports: [PersonaService],
})
export class PersonaModule {}
```

- [ ] **Step 7: 在 app.module.ts 追加 PersonaModule，跑测试**

```bash
pnpm --filter @record-replay/api test:e2e -- persona
```
Expected: `Tests: 2 passed`

- [ ] **Step 8: 提交**

```bash
git add apps/api/src/persona apps/api/src/app.module.ts
git commit -m "feat(api): add persona module"
```

---

## Task 9: ChatProvider（DeepSeek，回答限长）

**Files:**
- Create: `apps/api/src/providers/chat/chat.provider.ts`
- Create: `apps/api/src/task/answer-limiter.ts`
- Test: `apps/api/src/providers/chat/chat.provider.spec.ts`
- Test: `apps/api/src/task/answer-limiter.spec.ts`

**背景：** DeepSeek 官方接口已实测可用（`POST https://api.deepseek.com/v1/chat/completions`，模型 `deepseek-flash`）。回答必须控制在 `ANSWER_MAX_CHARS` 内，因为 OmniHuman 音频建议 < 15 秒。

- [ ] **Step 1: 写失败测试 answer-limiter.spec.ts**

```ts
import { limitAnswer } from './answer-limiter';

describe('limitAnswer', () => {
  it('短文本原样返回', () => {
    expect(limitAnswer('想你了，我很好。', 70)).toBe('想你了，我很好。');
  });

  it('超长时在标点处截断并补省略号', () => {
    const long = '今天天气不错。' + '我很想你。'.repeat(30);
    const out = limitAnswer(long, 20);
    expect(out.length).toBeLessThanOrEqual(21);
    expect(out.endsWith('…')).toBe(true);
  });

  it('无标点时硬截断', () => {
    const out = limitAnswer('啊'.repeat(100), 10);
    expect(out.length).toBe(11);
    expect(out.endsWith('…')).toBe(true);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
pnpm --filter @record-replay/api test -- answer-limiter
```
Expected: FAIL。

- [ ] **Step 3: 写 answer-limiter.ts**

```ts
const PUNCTUATION = ['。', '！', '？', '，', '；', '.', '!', '?', ',', ';'];

export function limitAnswer(text: string, maxChars: number): string {
  const clean = text.replace(/\s+/g, '').trim();
  if (clean.length <= maxChars) return clean;

  const window = clean.slice(0, maxChars);
  let cut = -1;
  for (let i = window.length - 1; i >= 0; i--) {
    if (PUNCTUATION.includes(window[i])) {
      cut = i;
      break;
    }
  }
  const body = cut >= 0 ? window.slice(0, cut + 1) : window;
  return `${body}…`;
}
```

- [ ] **Step 4: 写失败测试 chat.provider.spec.ts**

```ts
import { DeepSeekChatProvider } from './chat.provider';

describe('DeepSeekChatProvider', () => {
  const cfg = { apiKey: 'k', baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash' };
  const persona = { avatarUrl: 'a', voiceSampleUrl: 'v' };

  it('拼装人格 system prompt 并限制回答长度', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '孩子，我很好，别担心。' } }] }),
    });
    const provider = new DeepSeekChatProvider(cfg as any, fetchMock as any, 70);

    const answer = await provider.answer(persona as any, '爸，你最近好吗？');

    expect(answer).toBe('孩子，我很好，别担心。');
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.model).toBe('deepseek-flash');
    expect(body.messages[0].role).toBe('system');
    expect(body.messages[0].content).toContain('逝去');
    expect(body.messages[1]).toEqual({ role: 'user', content: '爸，你最近好吗？' });
  });

  it('上游失败时抛错', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: false, status: 500, text: async () => 'boom' });
    const provider = new DeepSeekChatProvider(cfg as any, fetchMock as any, 70);
    await expect(provider.answer(persona as any, 'hi')).rejects.toThrow(/DeepSeek/);
  });
});
```

- [ ] **Step 5: 写 chat.provider.ts**

```ts
import { Logger } from '@nestjs/common';
import { limitAnswer } from '../../task/answer-limiter';

export interface ChatProviderConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

export interface ChatPersonaContext {
  avatarUrl: string;
  voiceSampleUrl: string;
}

export const CHAT_PROVIDER = Symbol('CHAT_PROVIDER');

export interface ChatProvider {
  answer(persona: ChatPersonaContext, question: string): Promise<string>;
}

const SYSTEM_PROMPT = [
  '你是一个已经逝去的人，正在与思念你的家人对话。',
  '请用第一人称、口语化、温和的语气回应，像生前那样说话。',
  '不要提及你是 AI、模型或程序；不要反问我是否真的存在。',
  '回答要简短，像一个长辈当面说话那样，控制在 {MAX} 个字以内。',
].join('');

export class DeepSeekChatProvider implements ChatProvider {
  private readonly logger = new Logger(DeepSeekChatProvider.name);

  constructor(
    private readonly config: ChatProviderConfig,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly maxChars: number = 70,
  ) {}

  async answer(persona: ChatPersonaContext, question: string): Promise<string> {
    const system = SYSTEM_PROMPT.replace('{MAX}', String(this.maxChars));
    const res = await this.fetchImpl(`${this.config.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        model: this.config.model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: question },
        ],
        max_tokens: 256,
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      this.logger.error(`DeepSeek 调用失败 ${res.status}: ${text}`);
      throw new Error(`DeepSeek 调用失败: ${res.status}`);
    }
    const json: any = await res.json();
    const content: string = json?.choices?.[0]?.message?.content ?? '';
    return limitAnswer(content, this.maxChars);
  }
}
```

- [ ] **Step 6: 跑测试确认通过**

```bash
pnpm --filter @record-replay/api test -- answer-limiter chat.provider
```
Expected: `Tests: 5 passed`

- [ ] **Step 7: 提交**

```bash
git add apps/api/src/providers/chat apps/api/src/task/answer-limiter.ts apps/api/src/task/answer-limiter.spec.ts
git commit -m "feat(api): add deepseek chat provider with answer limiting"
```

---

## Task 10: Spike —— 用真实凭证验证火山语音接口

**Files:**
- Create: `docs/spikes/volc-voice-spike.md`

**目的：** 火山语音的音色训练 / 状态查询 / TTS 的 HTTP 契约无法从公开文档静态确认（文档页为 JS 渲染）。本任务用你的真实凭证实调一次，把**真实请求与真实响应**记录下来，Task 11 的适配器以本任务的证据为准。

- [ ] **Step 1: 准备凭证**

在 `apps/api/.env.development` 填好 `VOLC_TTS_APPID`、`VOLC_TTS_ACCESS_TOKEN`（豆包语音控制台 → API Key 管理），并确认已开通「声音复刻大模型 / 豆包声音复刻模型2.0 / 语音合成大模型」。

- [ ] **Step 2: 实调 TTS（用公共音色先跑通链路）**

```bash
curl -s -X POST 'https://openspeech.bytedance.com/api/v1/tts' \
  -H 'Authorization: Bearer;<你的 ACCESS_TOKEN>' \
  -H 'Content-Type: application/json' \
  -d '{
    "app": {"appid":"<APPID>","token":"<ACCESS_TOKEN>","cluster":"volcano_tts"},
    "user": {"uid":"spike"},
    "audio": {"voice_type":"BV700_streaming","encoding":"mp3","speed_ratio":1.0},
    "request": {"reqid":"spike-1","text":"这是一次接口验证。","operation":"query"}
  }'
```
把**完整响应**贴进 `docs/spikes/volc-voice-spike.md`。预期：`code: 3000`，`data` 为 base64 音频。

- [ ] **Step 3: 实调音色训练上传**

```bash
curl -s -X POST 'https://openspeech.bytedance.com/api/v1/mega_tts/audio/upload' \
  -H 'Authorization: Bearer;<你的 ACCESS_TOKEN>' \
  -H 'Resource-Id: volc.megatts.voiceclone' \
  -H 'Content-Type: application/json' \
  -d '{
    "appid":"<APPID>",
    "speaker_id":"spike_demo",
    "audios":[{"audio_bytes":"<音频 base64>","audio_format":"wav"}],
    "source":2,
    "language":0,
    "model_type":1
  }'
```
把响应记录到 spike 文档。预期：`BaseResp.StatusCode: 0`。

- [ ] **Step 4: 实调训练状态查询**

```bash
curl -s -X POST 'https://openspeech.bytedance.com/api/v1/mega_tts/status' \
  -H 'Authorization: Bearer;<你的 ACCESS_TOKEN>' \
  -H 'Resource-Id: volc.megatts.voiceclone' \
  -H 'Content-Type: application/json' \
  -d '{"appid":"<APPID>","speaker_id":"spike_demo"}'
```
记录响应。状态含义：`1=训练中`、`2=成功`、`4=已激活`。

- [ ] **Step 5: 用克隆音色合成一次**

拿到 `speaker_id` 后，把 Step 2 的 `cluster` 换成 `volcano_icl`、`voice_type` 换成你的 `speaker_id`，重跑一次，确认能合成。

- [ ] **Step 6: 落文档并提交**

把以上真实请求与响应（脱敏 token）写入 `docs/spikes/volc-voice-spike.md`，并注明与本文档假设不一致的字段。

```bash
git add docs/spikes/volc-voice-spike.md
git commit -m "docs: spike volc voice api contracts"
```

> **门禁：** 若 Step 2/3/4 的字段名与本文档假设不一致，**先改本文档的 Task 11 代码**再继续，不要带着猜测往下写。

---

## Task 11: VoiceProvider（火山声音复刻 + 克隆音色 TTS）

**Files:**
- Create: `apps/api/src/providers/voice/voice.provider.ts`
- Test: `apps/api/src/providers/voice/voice.provider.spec.ts`

**说明：** 端点与字段以 Task 10 的 spike 证据为准；下方为基线实现，若 spike 有出入按 spike 修改。

- [ ] **Step 1: 写失败测试 voice.provider.spec.ts**

```ts
import { VolcanoVoiceProvider } from './voice.provider';

describe('VolcanoVoiceProvider', () => {
  const cfg = { appid: 'app', accessToken: 'tok', cluster: 'volcano_icl' };

  it('train: 提交音色训练，返回 speakerId', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true, json: async () => ({ BaseResp: { StatusCode: 0 } }),
    });
    const p = new VolcanoVoiceProvider(cfg as any, fetchMock as any);
    const out = await p.train('persona-1', Buffer.from('audio'), 'wav');
    expect(out.speakerId).toBe('persona-1');
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.speaker_id).toBe('persona-1');
    expect(fetchMock.mock.calls[0][1].headers['Resource-Id']).toBe('volc.megatts.voiceclone');
  });

  it('queryTrainStatus: 2 视为 ready', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true, json: async () => ({ BaseResp: { StatusCode: 0 }, speaker_status: 2 }),
    });
    const p = new VolcanoVoiceProvider(cfg as any, fetchMock as any);
    await expect(p.queryTrainStatus('persona-1')).resolves.toBe('ready');
  });

  it('queryTrainStatus: 1 视为 training', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true, json: async () => ({ BaseResp: { StatusCode: 0 }, speaker_status: 1 }),
    });
    const p = new VolcanoVoiceProvider(cfg as any, fetchMock as any);
    await expect(p.queryTrainStatus('persona-1')).resolves.toBe('training');
  });

  it('synthesize: 返回 mp3 Buffer', async () => {
    const audio = Buffer.from('mp3-bytes');
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true, json: async () => ({ code: 3000, data: audio.toString('base64') }),
    });
    const p = new VolcanoVoiceProvider(cfg as any, fetchMock as any);
    const out = await p.synthesize('你好呀', 'persona-1');
    expect(out.toString()).toBe('mp3-bytes');
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.audio.voice_type).toBe('persona-1');
    expect(body.audio.encoding).toBe('mp3');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
pnpm --filter @record-replay/api test -- voice.provider
```
Expected: FAIL。

- [ ] **Step 3: 写 voice.provider.ts**

```ts
export interface VoiceProviderConfig {
  appid: string;
  accessToken: string;
  cluster: string;
}

export const VOICE_PROVIDER = Symbol('VOICE_PROVIDER');

export interface VoiceProvider {
  train(speakerId: string, audio: Buffer, format: string): Promise<{ speakerId: string }>;
  queryTrainStatus(speakerId: string): Promise<'training' | 'ready' | 'failed'>;
  synthesize(text: string, speakerId: string): Promise<Buffer>;
}

const TTS_URL = 'https://openspeech.bytedance.com/api/v1/tts';
const TRAIN_URL = 'https://openspeech.bytedance.com/api/v1/mega_tts/audio/upload';
const STATUS_URL = 'https://openspeech.bytedance.com/api/v1/mega_tts/status';

export class VolcanoVoiceProvider implements VoiceProvider {
  constructor(
    private readonly config: VoiceProviderConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private authHeader(): Record<string, string> {
    return {
      Authorization: `Bearer;${this.config.accessToken}`,
      'Content-Type': 'application/json',
    };
  }

  async train(speakerId: string, audio: Buffer, format: string) {
    const res = await this.fetchImpl(TRAIN_URL, {
      method: 'POST',
      headers: { ...this.authHeader(), 'Resource-Id': 'volc.megatts.voiceclone' },
      body: JSON.stringify({
        appid: this.config.appid,
        speaker_id: speakerId,
        audios: [{ audio_bytes: audio.toString('base64'), audio_format: format }],
        source: 2,
        language: 0,
        model_type: 1,
      }),
    });
    const json: any = await res.json();
    if (json?.BaseResp?.StatusCode !== 0) {
      throw new Error(`音色训练提交失败: ${JSON.stringify(json?.BaseResp ?? json)}`);
    }
    return { speakerId };
  }

  async queryTrainStatus(speakerId: string): Promise<'training' | 'ready' | 'failed'> {
    const res = await this.fetchImpl(STATUS_URL, {
      method: 'POST',
      headers: { ...this.authHeader(), 'Resource-Id': 'volc.megatts.voiceclone' },
      body: JSON.stringify({ appid: this.config.appid, speaker_id: speakerId }),
    });
    const json: any = await res.json();
    if (json?.BaseResp?.StatusCode !== 0) throw new Error(`音色状态查询失败: ${JSON.stringify(json)}`);
    const status = json?.speaker_status;
    if (status === 2 || status === 4) return 'ready';
    if (status === 3) return 'failed';
    return 'training';
  }

  async synthesize(text: string, speakerId: string): Promise<Buffer> {
    const res = await this.fetchImpl(TTS_URL, {
      method: 'POST',
      headers: this.authHeader(),
      body: JSON.stringify({
        app: { appid: this.config.appid, token: this.config.accessToken, cluster: this.config.cluster },
        user: { uid: 'record-replay' },
        audio: { voice_type: speakerId, encoding: 'mp3', speed_ratio: 1.0 },
        request: { reqid: `${speakerId}-${Date.now()}`, text, operation: 'query' },
      }),
    });
    const json: any = await res.json();
    if (json?.code !== 3000 || !json?.data) {
      throw new Error(`语音合成失败: ${JSON.stringify(json).slice(0, 300)}`);
    }
    return Buffer.from(json.data, 'base64');
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

```bash
pnpm --filter @record-replay/api test -- voice.provider
```
Expected: `Tests: 4 passed`

- [ ] **Step 5: 提交**

```bash
git add apps/api/src/providers/voice
git commit -m "feat(api): add volcengine voice clone provider"
```

---

## Task 12: RenderProvider（OmniHuman 提交 / 轮询 / 转存）

**Files:**
- Create: `apps/api/src/providers/render/render.provider.ts`
- Create: `apps/api/src/providers/render/volc-signer.ts`
- Test: `apps/api/src/providers/render/render.provider.spec.ts`

**已核实的接口契约（来源：火山引擎 OmniHuman 文档）**
- 域名 `https://visual.volcengineapi.com`，`Region=cn-north-1`，`Service=cv`，`Version=2022-08-31`
- 提交：`Action=CVSubmitTask`，body `{ req_key, image_url, audio_url }` → `data.task_id`
- 查询：`Action=CVGetResult`，body `{ req_key, task_id }` → `data.status`(in_queue/generating/done) + `data.video_url`（**仅 1 小时有效**）

- [ ] **Step 1: 写失败测试 render.provider.spec.ts**

```ts
import { OmniHumanRenderProvider } from './render.provider';

describe('OmniHumanRenderProvider', () => {
  const cfg = { accessKeyId: 'ak', accessKeySecret: 'sk', reqKey: 'realman_avatar_picture_omni_v2' };

  it('submit 返回 taskId', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true, json: async () => ({ code: 10000, data: { task_id: 't-1' } }),
    });
    const p = new OmniHumanRenderProvider(cfg as any, fetchMock as any);
    await expect(p.submit('http://x/a.jpg', 'http://x/v.mp3')).resolves.toBe('t-1');
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('Action=CVSubmitTask');
    expect(url).toContain('Version=2022-08-31');
  });

  it('query: generating 时无 videoUrl', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true, json: async () => ({ code: 10000, data: { status: 'generating' } }),
    });
    const p = new OmniHumanRenderProvider(cfg as any, fetchMock as any);
    await expect(p.query('t-1')).resolves.toEqual({ status: 'generating', videoUrl: null });
  });

  it('query: done 时返回 videoUrl', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true, json: async () => ({ code: 10000, data: { status: 'done', video_url: 'https://v/x.mp4' } }),
    });
    const p = new OmniHumanRenderProvider(cfg as any, fetchMock as any);
    await expect(p.query('t-1')).resolves.toEqual({ status: 'done', videoUrl: 'https://v/x.mp4' });
  });

  it('审核拦截时抛出可读错误', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true, json: async () => ({ code: 50413, message: 'Post Text Risk Not Pass' }),
    });
    const p = new OmniHumanRenderProvider(cfg as any, fetchMock as any);
    await expect(p.submit('http://x/a.jpg', 'http://x/v.mp3')).rejects.toThrow(/内容审核/);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
pnpm --filter @record-replay/api test -- render.provider
```
Expected: FAIL。

- [ ] **Step 3: 写 volc-signer.ts（火山 v4 签名）**

```ts
import { createHash, createHmac } from 'node:crypto';

const SERVICE = 'cv';
const REGION = 'cn-north-1';
const HOST = 'visual.volcengineapi.com';

function sha256Hex(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex');
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data).digest();
}

export interface SignedRequest {
  url: string;
  headers: Record<string, string>;
  body: string;
}

export function signVolcRequest(
  params: { accessKeyId: string; accessKeySecret: string; query: Record<string, string> },
  bodyObj: Record<string, unknown>,
): SignedRequest {
  const body = JSON.stringify(bodyObj);
  const now = new Date();
  const xDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const shortDate = xDate.slice(0, 8);
  const payloadHash = sha256Hex(body);

  const signedHeaders = 'content-type;host;x-content-sha256;x-date';
  const canonicalHeaders =
    `content-type:application/json\n` +
    `host:${HOST}\n` +
    `x-content-sha256:${payloadHash}\n` +
    `x-date:${xDate}\n`;

  const canonicalQuery = Object.keys(params.query)
    .sort()
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(params.query[k])}`)
    .join('&');

  const canonicalRequest = [
    'POST',
    '/',
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const credentialScope = `${shortDate}/${REGION}/${SERVICE}/request`;
  const stringToSign = [
    'HMAC-SHA256',
    xDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join('\n');

  const kDate = hmac(params.accessKeySecret, shortDate);
  const kRegion = hmac(kDate, REGION);
  const kService = hmac(kRegion, SERVICE);
  const kSigning = hmac(kService, 'request');
  const signature = createHmac('sha256', kSigning).update(stringToSign).digest('hex');

  const authorization =
    `HMAC-SHA256 Credential=${params.accessKeyId}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return {
    url: `https://${HOST}/?${canonicalQuery}`,
    headers: {
      'Content-Type': 'application/json',
      'X-Date': xDate,
      'X-Content-Sha256': payloadHash,
      Authorization: authorization,
    },
    body,
  };
}
```

- [ ] **Step 4: 写 render.provider.ts**

```ts
const AUDIT_ERRORS: Record<number, string> = {
  50411: '输入图片未通过内容审核',
  50511: '输出图片未通过内容审核',
  50412: '输入文本未通过内容审核',
  50512: '输出文本未通过内容审核',
  50413: '内容审核未通过',
};

export interface RenderProviderConfig {
  accessKeyId: string;
  accessKeySecret: string;
  reqKey: string;
}

export const RENDER_PROVIDER = Symbol('RENDER_PROVIDER');

export interface RenderQueryResult {
  status: 'in_queue' | 'generating' | 'done' | 'failed';
  videoUrl: string | null;
}

export interface RenderProvider {
  submit(imageUrl: string, audioUrl: string): Promise<string>;
  query(taskId: string): Promise<RenderQueryResult>;
}

export class OmniHumanRenderProvider implements RenderProvider {
  constructor(
    private readonly config: RenderProviderConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async call(action: string, bodyObj: Record<string, unknown>): Promise<any> {
    const signed = signVolcRequest(
      {
        accessKeyId: this.config.accessKeyId,
        accessKeySecret: this.config.accessKeySecret,
        query: { Action: action, Version: '2022-08-31' },
      },
      bodyObj,
    );
    const res = await this.fetchImpl(signed.url, {
      method: 'POST',
      headers: signed.headers,
      body: signed.body,
    });
    const json: any = await res.json();
    if (json?.code !== 10000) {
      const readable = AUDIT_ERRORS[json?.code];
      throw new Error(readable ?? `OmniHuman 调用失败(${json?.code}): ${json?.message}`);
    }
    return json.data;
  }

  async submit(imageUrl: string, audioUrl: string): Promise<string> {
    const data = await this.call('CVSubmitTask', {
      req_key: this.config.reqKey,
      image_url: imageUrl,
      audio_url: audioUrl,
    });
    return data.task_id as string;
  }

  async query(taskId: string): Promise<RenderQueryResult> {
    const data = await this.call('CVGetResult', {
      req_key: this.config.reqKey,
      task_id: taskId,
    });
    const status = data.status as string;
    if (status === 'done') {
      return { status: 'done', videoUrl: (data.video_url as string) ?? null };
    }
    if (status === 'not_found' || status === 'expired') {
      return { status: 'failed', videoUrl: null };
    }
    return { status: status === 'in_queue' ? 'in_queue' : 'generating', videoUrl: null };
  }
}
```

> 顶部 `import { signVolcRequest } from './volc-signer';` 不要漏。

- [ ] **Step 5: 跑测试确认通过**

```bash
pnpm --filter @record-replay/api test -- render.provider
```
Expected: `Tests: 4 passed`

- [ ] **Step 6: 用真实凭证走一次**

用 `apps/api/.env.development` 里的 `VOLC_ACCESS_KEY_ID/SECRET`，写一个一次性脚本调用 `submit` + 轮询 `query`，确认能拿到 `video_url`。把结果补充到 `docs/spikes/volc-voice-spike.md` 末尾。

- [ ] **Step 7: 提交**

```bash
git add apps/api/src/providers/render apps/api/src/task/answer-limiter.ts
git commit -m "feat(api): add omnihuman render provider with volc v4 signing"
```

---

## Task 13: TaskModule（编排 + 转存 + 接口）

**Files:**
- Create: `apps/api/src/task/entities/render-task.entity.ts`
- Create: `apps/api/src/task/task.service.ts`
- Create: `apps/api/src/task/task.controller.ts`
- Create: `apps/api/src/task/task.module.ts`
- Modify: `apps/api/src/persona/persona.controller.ts`（加 `POST /personas/:id/ask`）
- Modify: `apps/api/src/app.module.ts`
- Test: `apps/api/src/task/task.e2e-spec.ts`

- [ ] **Step 1: 写 render-task.entity.ts**

```ts
import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('render_tasks')
export class RenderTask {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'char', length: 36 })
  personaId: string;

  @Column({ type: 'text' })
  question: string;

  @Column({ type: 'text', nullable: true })
  answerText: string | null;

  @Column({ type: 'varchar', length: 512, nullable: true })
  audioUrl: string | null;

  @Column({ type: 'varchar', length: 512, nullable: true })
  videoUrl: string | null;

  @Column({ type: 'varchar', length: 512, nullable: true })
  remoteVideoUrl: string | null;

  @Column({ type: 'varchar', length: 16, default: 'pending' })
  status: 'pending' | 'answering' | 'tts' | 'rendering' | 'done' | 'failed';

  @Column({ type: 'text', nullable: true })
  error: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @Column({ type: 'datetime', nullable: true })
  finishedAt: Date | null;
}
```

- [ ] **Step 2: 写失败测试 task.e2e-spec.ts**

```ts
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { SMS_CLIENT } from '../src/auth/sms.service';
import { CHAT_PROVIDER } from '../src/providers/chat/chat.provider';
import { VOICE_PROVIDER } from '../src/providers/voice/voice.provider';
import { RENDER_PROVIDER } from '../src/providers/render/render.provider';

describe('task e2e', () => {
  let app: INestApplication;
  let token: string;
  let personaId: string;

  const chat = { answer: jest.fn().mockResolvedValue('孩子，我很好，别挂念。') };
  const voice = {
    train: jest.fn().mockResolvedValue({ speakerId: 'p-1' }),
    queryTrainStatus: jest.fn().mockResolvedValue('ready'),
    synthesize: jest.fn().mockResolvedValue(Buffer.from('audio')),
  };
  const render = {
    submit: jest.fn().mockResolvedValue('task-1'),
    query: jest.fn().mockResolvedValue({ status: 'done', videoUrl: 'https://v/x.mp4' }),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(SMS_CLIENT).useValue({
        sendSmsVerifyCodeWithOptions: jest.fn().mockResolvedValue({ body: { code: 'OK' } }),
        checkSmsVerifyCodeWithOptions: jest.fn().mockResolvedValue({ body: { code: 'OK' } }),
      })
      .overrideProvider(CHAT_PROVIDER).useValue(chat)
      .overrideProvider(VOICE_PROVIDER).useValue(voice)
      .overrideProvider(RENDER_PROVIDER).useValue(render)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();

    const login = await request(app.getHttpServer())
      .post('/auth/sms/login').send({ phone: '15920328477', code: '123456' });
    token = login.body.token;

    const persona = await request(app.getHttpServer())
      .post('/personas')
      .set('Authorization', `Bearer ${token}`)
      .field('avatarUrl', 'http://x/a.jpg')
      .field('voiceSampleUrl', 'http://x/v.mp3');
    personaId = persona.body.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('提问 -> 最终 done 且带 videoUrl', async () => {
    const ask = await request(app.getHttpServer())
      .post(`/personas/${personaId}/ask`)
      .set('Authorization', `Bearer ${token}`)
      .send({ question: '爸，你最近好吗？' })
      .expect(201);

    const taskId = ask.body.taskId;
    let body: any;
    for (let i = 0; i < 20; i++) {
      const res = await request(app.getHttpServer())
        .get(`/tasks/${taskId}`)
        .set('Authorization', `Bearer ${token}`);
      body = res.body;
      if (body.status === 'done' || body.status === 'failed') break;
      await new Promise((r) => setTimeout(r, 200));
    }

    expect(body.status).toBe('done');
    expect(body.videoUrl).toMatch(/\/static\/videos\//);
    expect(body.answerText).toBe('孩子，我很好，别挂念。');
    expect(render.submit).toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: 跑测试确认失败**

```bash
pnpm --filter @record-replay/api test:e2e -- task
```
Expected: FAIL，404。

- [ ] **Step 4: 写 task.service.ts**

```ts
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { RenderTask } from './entities/render-task.entity';
import { PersonaService } from '../persona/persona.service';
import { MediaService } from '../media/media.service';
import { STORAGE_ROOT, toPublicUrl } from '../media/storage.config';
import { CHAT_PROVIDER, ChatProvider } from '../providers/chat/chat.provider';
import { VOICE_PROVIDER, VoiceProvider } from '../providers/voice/voice.provider';
import { RENDER_PROVIDER, RenderProvider } from '../providers/render/render.provider';

const RENDER_POLL_INTERVAL_MS = 3000;
const RENDER_MAX_ROUNDS = 60;

@Injectable()
export class TaskService {
  private readonly logger = new Logger(TaskService.name);

  constructor(
    @InjectRepository(RenderTask) private readonly tasks: Repository<RenderTask>,
    private readonly personas: PersonaService,
    private readonly media: MediaService,
    private readonly cfg: ConfigService,
    @Inject(CHAT_PROVIDER) private readonly chat: ChatProvider,
    @Inject(VOICE_PROVIDER) private readonly voice: VoiceProvider,
    @Inject(RENDER_PROVIDER) private readonly render: RenderProvider,
  ) {}

  async create(personaId: string, question: string): Promise<RenderTask> {
    return this.tasks.save(this.tasks.create({ personaId, question, status: 'pending' }));
  }

  find(id: string): Promise<RenderTask | null> {
    return this.tasks.findOne({ where: { id } });
  }

  async run(taskId: string, personaId: string): Promise<void> {
    const persona = await this.personas.findOwned(personaId, (await this.personas.findOwned(personaId, '')).userId);
    // 上面这行只是占位，实际由调用方传入已校验的 persona，见 Step 5 控制器
    void persona;
  }
}
```

> **注意：** 上面 `run` 的写法是错的（多此一举且会抛错）。请直接用 Step 5 的最终版本替换 `task.service.ts`，本步骤仅用于先跑失败测试。

- [ ] **Step 5: 用最终版本覆盖 task.service.ts**

```ts
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { RenderTask } from './entities/render-task.entity';
import { PersonaService } from '../persona/persona.service';
import { MediaService } from '../media/media.service';
import { STORAGE_ROOT, toPublicUrl } from '../media/storage.config';
import { CHAT_PROVIDER, ChatProvider } from '../providers/chat/chat.provider';
import { VOICE_PROVIDER, VoiceProvider } from '../providers/voice/voice.provider';
import { RENDER_PROVIDER, RenderProvider } from '../providers/render/render.provider';
import { Persona } from '../persona/entities/persona.entity';

const RENDER_POLL_INTERVAL_MS = 3000;
const RENDER_MAX_ROUNDS = 60;

@Injectable()
export class TaskService {
  private readonly logger = new Logger(TaskService.name);

  constructor(
    @InjectRepository(RenderTask) private readonly tasks: Repository<RenderTask>,
    private readonly personas: PersonaService,
    private readonly media: MediaService,
    private readonly cfg: ConfigService,
    @Inject(CHAT_PROVIDER) private readonly chat: ChatProvider,
    @Inject(VOICE_PROVIDER) private readonly voice: VoiceProvider,
    @Inject(RENDER_PROVIDER) private readonly render: RenderProvider,
  ) {}

  async create(persona: Persona, question: string): Promise<RenderTask> {
    const task = await this.tasks.save(
      this.tasks.create({ personaId: persona.id, question, status: 'pending' }),
    );
    void this.process(task.id, persona).catch((err) => {
      this.logger.error(`任务 ${task.id} 失败: ${err.message}`);
    });
    return task;
  }

  find(id: string): Promise<RenderTask | null> {
    return this.tasks.findOne({ where: { id } });
  }

  private async process(taskId: string, persona: Persona): Promise<void> {
    try {
      const task = await this.tasks.findOne({ where: { id: taskId } });
      if (!task) return;

      // 1) 生成回答文本
      await this.tasks.update(taskId, { status: 'answering' });
      const answerText = await this.chat.answer(
        { avatarUrl: persona.avatarUrl, voiceSampleUrl: persona.voiceSampleUrl },
        task.question,
      );
      await this.tasks.update(taskId, { answerText });

      // 2) 克隆音色合成语音
      await this.tasks.update(taskId, { status: 'tts' });
      if (!persona.speakerId) throw new Error('人格音色尚未就绪');
      const audio = await this.voice.synthesize(answerText, persona.speakerId);
      const audioUrl = await this.saveFile('audio', `${randomUUID()}.mp3`, audio);
      await this.tasks.update(taskId, { audioUrl });

      // 3) 提交口型视频任务
      await this.tasks.update(taskId, { status: 'rendering' });
      const remoteTaskId = await this.render.submit(persona.avatarUrl, audioUrl);

      // 4) 轮询并转存
      const videoUrl = await this.pollAndPersist(taskId, remoteTaskId);
      await this.tasks.update(taskId, {
        status: 'done',
        videoUrl,
        finishedAt: new Date(),
      });
    } catch (err: any) {
      await this.tasks.update(taskId, {
        status: 'failed',
        error: String(err?.message ?? err),
        finishedAt: new Date(),
      });
      throw err;
    }
  }

  private async pollAndPersist(taskId: string, remoteTaskId: string): Promise<string> {
    for (let i = 0; i < RENDER_MAX_ROUNDS; i++) {
      const result = await this.render.query(remoteTaskId);
      if (result.status === 'failed') throw new Error('视频生成失败');
      if (result.status === 'done' && result.videoUrl) {
        const res = await fetch(result.videoUrl);
        const buf = Buffer.from(await res.arrayBuffer());
        await this.tasks.update(taskId, { remoteVideoUrl: result.videoUrl });
        return this.saveFile('videos', `${randomUUID()}.mp4`, buf);
      }
      await new Promise((r) => setTimeout(r, RENDER_POLL_INTERVAL_MS));
    }
    throw new Error('视频生成超时');
  }

  private async saveFile(kind: 'audio' | 'videos', name: string, buf: Buffer): Promise<string> {
    const dir = join(STORAGE_ROOT, kind);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, name), buf);
    return toPublicUrl(this.cfg.get<string>('publicBaseUrl')!, `${kind}/${name}`);
  }
}
```

- [ ] **Step 6: 写 task.controller.ts**

```ts
import { Controller, Get, Param, Req, UseGuards, ForbiddenException, NotFoundException } from '@nestjs/common';
import { JwtGuard } from '../auth/jwt.guard';
import { TaskService } from './task.service';
import { PersonaService } from '../persona/persona.service';

@Controller('tasks')
@UseGuards(JwtGuard)
export class TaskController {
  constructor(
    private readonly tasks: TaskService,
    private readonly personas: PersonaService,
  ) {}

  @Get(':id')
  async get(@Req() req: any, @Param('id') id: string) {
    const task = await this.tasks.find(id);
    if (!task) throw new NotFoundException('任务不存在');
    await this.personas.findOwned(task.personaId, req.user.sub);
    return task;
  }
}
```

- [ ] **Step 7: 写 task.module.ts**

```ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RenderTask } from './entities/render-task.entity';
import { TaskController } from './task.controller';
import { TaskService } from './task.service';
import { PersonaModule } from '../persona/persona.module';
import { MediaModule } from '../media/media.module';
import { ProvidersModule } from '../providers/providers.module';

@Module({
  imports: [TypeOrmModule.forFeature([RenderTask]), PersonaModule, MediaModule, ProvidersModule],
  controllers: [TaskController],
  providers: [TaskService],
  exports: [TaskService],
})
export class TaskModule {}
```

- [ ] **Step 8: 写 providers.module.ts**

```ts
import { Module, Global } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CHAT_PROVIDER, DeepSeekChatProvider } from './chat/chat.provider';
import { VOICE_PROVIDER, VolcanoVoiceProvider } from './voice/voice.provider';
import { RENDER_PROVIDER, OmniHumanRenderProvider } from './render/render.provider';

@Global()
@Module({
  providers: [
    {
      provide: CHAT_PROVIDER,
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) =>
        new DeepSeekChatProvider(
          {
            apiKey: cfg.get<string>('deepseek.apiKey')!,
            baseUrl: cfg.get<string>('deepseek.baseUrl')!,
            model: cfg.get<string>('deepseek.model')!,
          },
          fetch,
          cfg.get<number>('answerMaxChars')!,
        ),
    },
    {
      provide: VOICE_PROVIDER,
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) =>
        new VolcanoVoiceProvider({
          appid: cfg.get<string>('volcVoice.appid')!,
          accessToken: cfg.get<string>('volcVoice.accessToken')!,
          cluster: cfg.get<string>('volcVoice.cluster')!,
        }),
    },
    {
      provide: RENDER_PROVIDER,
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) =>
        new OmniHumanRenderProvider({
          accessKeyId: cfg.get<string>('volcOmni.accessKeyId')!,
          accessKeySecret: cfg.get<string>('volcOmni.accessKeySecret')!,
          reqKey: cfg.get<string>('volcOmni.reqKey')!,
        }),
    },
  ],
  exports: [CHAT_PROVIDER, VOICE_PROVIDER, RENDER_PROVIDER],
})
export class ProvidersModule {}
```

- [ ] **Step 9: 在 persona.controller.ts 加 ask 接口**

```ts
import { TaskService } from '../task/task.service';
// 构造器注入 private readonly tasks: TaskService
// PersonaModule 不需要改；在 PersonaController 所在模块导入 TaskModule 会循环依赖，
// 因此把 ask 放到 TaskModule 里更干净——见 Step 10。
```

> 为避免 `TaskModule ↔ PersonaModule` 循环依赖，**不要**在 PersonaController 加 `ask`。改为在 `TaskController` 下新增 `POST /personas/:personaId/ask` 路由（见 Step 10）。

- [ ] **Step 10: 在 task.controller.ts 增加 ask 路由**

在 `TaskController` 类中加入：

```ts
  @Post('ask/:personaId')
  async ask(
    @Req() req: any,
    @Param('personaId') personaId: string,
    @Body() body: { question: string },
  ) {
    const parsed = AskSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues[0].message);
    const persona = await this.personas.findOwned(personaId, req.user.sub);
    if (persona.status !== 'ready') throw new BadRequestException('人格尚未就绪');
    const task = await this.tasks.create(persona, parsed.data.question);
    return { taskId: task.id };
  }
```

同时补充 import：

```ts
import { Body, BadRequestException, Post } from '@nestjs/common';
import { AskSchema } from '@record-replay/shared';
```

并把路径前缀调整：`@Controller('tasks')` 保留，但 ask 路由写成 `@Post('/../personas/:personaId/ask')` **不可行**。改为：把 `ask` 单独放一个控制器 `@Controller('personas')`、方法 `@Post(':personaId/ask')`，写在 `task.controller.ts` 文件内作为第二个导出类，并在 `TaskModule` 的 `controllers` 里注册。

```ts
@Controller('personas')
@UseGuards(JwtGuard)
export class PersonaAskController {
  constructor(
    private readonly tasks: TaskService,
    private readonly personas: PersonaService,
  ) {}

  @Post(':personaId/ask')
  async ask(
    @Req() req: any,
    @Param('personaId') personaId: string,
    @Body() body: { question: string },
  ) {
    const parsed = AskSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues[0].message);
    const persona = await this.personas.findOwned(personaId, req.user.sub);
    if (persona.status !== 'ready') throw new BadRequestException('人格尚未就绪');
    const task = await this.tasks.create(persona, parsed.data.question);
    return { taskId: task.id };
  }
}
```

- [ ] **Step 11: 把 PersonaAskController 注册进 TaskModule**

`task.module.ts` 的 `controllers: [TaskController, PersonaAskController]`，并 import 该导出。

- [ ] **Step 12: 在 app.module.ts 追加 ProvidersModule 与 TaskModule**

- [ ] **Step 13: 跑测试确认通过**

```bash
pnpm --filter @record-replay/api test:e2e -- task
```
Expected: `Tests: 1 passed`

- [ ] **Step 14: 全量测试**

```bash
pnpm --filter @record-replay/api test && pnpm --filter @record-replay/api test:e2e
```
Expected: 全部通过。

- [ ] **Step 15: 提交**

```bash
git add apps/api/src/task apps/api/src/providers apps/api/src/app.module.ts
git commit -m "feat(api): add task orchestration with video persisting"
```

---

## Task 14: 后端全链路联调（真实三方）

**Files:**
- Create: `scripts/e2e-smoke.sh`

- [ ] **Step 1: 写 smoke 脚本**

```bash
#!/usr/bin/env bash
set -euo pipefail
API=${API:-http://127.0.0.1:3000}
PHONE=${PHONE:-15920328477}
AVATAR=${AVATAR:?需要 AVATAR 指向一张公网可访问的头像 jpg}
VOICE=${VOICE:?需要 VOICE 指向一段公网可访问的语音 mp3}

echo "1) 发验证码"
curl -sf -X POST "$API/auth/sms/send" -H 'Content-Type: application/json' -d "{\"phone\":\"$PHONE\"}"
echo
read -rp "输入收到的验证码: " CODE

echo "2) 登录"
TOKEN=$(curl -sf -X POST "$API/auth/sms/login" -H 'Content-Type: application/json' \
  -d "{\"phone\":\"$PHONE\",\"code\":\"$CODE\"}" | python3 -c 'import sys,json;print(json.load(sys.stdin)["token"])')
echo "token 获取成功"

echo "3) 创建人格"
PID=$(curl -sf -X POST "$API/personas" -H "Authorization: Bearer $TOKEN" \
  -F "avatarUrl=$AVATAR" -F "voiceSampleUrl=$VOICE" | python3 -c 'import sys,json;print(json.load(sys.stdin)["id"])')
echo "personaId=$PID"

echo "4) 等待音色训练完成（人工触发训练后轮询）"
for i in $(seq 1 60); do
  ST=$(curl -sf "$API/personas/$PID" -H "Authorization: Bearer $TOKEN" | python3 -c 'import sys,json;print(json.load(sys.stdin)["status"])')
  echo "  status=$ST"
  [ "$ST" = "ready" ] && break
  sleep 5
done

echo "5) 提问"
TID=$(curl -sf -X POST "$API/personas/$PID/ask" -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"question":"爸，你最近还好吗？"}' \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["taskId"])')
echo "taskId=$TID"

echo "6) 轮询任务"
for i in $(seq 1 120); do
  BODY=$(curl -sf "$API/tasks/$TID" -H "Authorization: Bearer $TOKEN")
  echo "  $BODY"
  echo "$BODY" | grep -q '"status":"done"' && break
  sleep 3
done
```

- [ ] **Step 2: 跑通并记录**

```bash
chmod +x scripts/e2e-smoke.sh
AVATAR='http://23.147.68.16:31527/record-replay/static/uploads/<你上传的头像>' \
VOICE='http://23.147.68.16:31527/record-replay/static/uploads/<你上传的语音>' \
./scripts/e2e-smoke.sh
```
Expected: 最终打印出 `"status":"done"` 与 `videoUrl`，浏览器打开该 URL 能看到亲人头像在说话。

- [ ] **Step 3: 提交**

```bash
git add scripts/e2e-smoke.sh
git commit -m "test: add end-to-end smoke script"
```

---

## 自检结论

- **规格覆盖**：设计文档 §5 七个模块 → Task 3/5/6（Auth）、Task 7（Media）、Task 8（Persona）、Task 11（Voice）、Task 9（Chat）、Task 12（Render）、Task 13（Task）全部落地；§3 的五条硬约束 → 分别落在 Task 9（限长）、Task 7（图片 5MB 校验）、Task 12/13（1 小时转存）、Task 12（审核错误码映射）、Task 12（保留水印，不处理 aigc_meta 即默认保留）。
- **占位符扫描**：无 TBD/TODO。`Task 13 Step 4` 故意保留一段错误实现用于「先看测试失败」，并在 Step 5 给出最终版并显式说明，不是占位符。
- **类型一致性**：`CHAT_PROVIDER` / `VOICE_PROVIDER` / `RENDER_PROVIDER` 三个 Symbol 在 Task 9/11/12 定义、Task 13 使用，名称一致；`Persona['status']` 与 `PERSONA_STATUS` 取值一致；`toPublicUrl` / `STORAGE_ROOT` 在 Task 7 定义、Task 13 复用。
