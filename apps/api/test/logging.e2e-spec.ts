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
      .send({ name: '爸爸', relation: '父亲', avatarUrl: 'http://x/a.jpg', voiceSampleUrl: VOICE_SAMPLE });
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
