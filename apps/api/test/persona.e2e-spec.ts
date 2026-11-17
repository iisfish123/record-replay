import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module';
import { SMS_CLIENT } from '../src/auth/sms.service';
import { VOICE_PROVIDER } from '../src/providers/voice/voice.provider';

const VOICE_SAMPLE = `data:audio/mp3;base64,${Buffer.from('audio').toString('base64')}`;
const PERSONA_BODY = {
  name: '爸爸',
  relation: '父亲',
  avatarUrl: 'http://x/a.jpg',
  voiceSampleUrl: VOICE_SAMPLE,
};

describe('persona e2e', () => {
  let app: INestApplication;
  let token: string;
  let token2: string;

  const voice = {
    train: jest.fn().mockResolvedValue({ speakerId: 'p-1' }),
    queryTrainStatus: jest.fn().mockResolvedValue('ready'),
    synthesize: jest.fn().mockResolvedValue({ audio: Buffer.from('audio'), durationMs: 4200 }),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(SMS_CLIENT)
      .useValue({
        sendSmsVerifyCodeWithOptions: jest.fn().mockResolvedValue({ body: { code: 'OK' } }),
        checkSmsVerifyCodeWithOptions: jest
          .fn()
          .mockResolvedValue({ body: { code: 'OK', model: { verifyResult: 'PASS' } } }),
      })
      .overrideProvider(VOICE_PROVIDER)
      .useValue(voice)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    const res = await request(app.getHttpServer())
      .post('/auth/sms/login')
      .send({ phone: '15920328002', code: '123456' });
    token = res.body.token;
    const res2 = await request(app.getHttpServer())
      .post('/auth/sms/login')
      .send({ phone: '15920328003', code: '123456' });
    token2 = res2.body.token;
  });

  afterAll(async () => {
    await app.close();
  });

  it('创建人格 -> status=pending，并保存昵称与关系', async () => {
    const res = await request(app.getHttpServer())
      .post('/personas')
      .set('Authorization', `Bearer ${token}`)
      .send(PERSONA_BODY)
      .expect(201);
    expect(res.body.status).toBe('pending');
    expect(res.body.id).toBeTruthy();
    expect(res.body.name).toBe('爸爸');
    expect(res.body.relation).toBe('父亲');
  });

  it('创建人格缺少昵称或关系 -> 400', async () => {
    await request(app.getHttpServer())
      .post('/personas')
      .set('Authorization', `Bearer ${token}`)
      .send({ relation: '父亲', avatarUrl: 'http://x/a.jpg', voiceSampleUrl: VOICE_SAMPLE })
      .expect(400);
    await request(app.getHttpServer())
      .post('/personas')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: '爸爸', relation: '邻居', avatarUrl: 'http://x/a.jpg', voiceSampleUrl: VOICE_SAMPLE })
      .expect(400);
  });

  it('编辑昵称与关系 -> 200 且仅更新指定字段', async () => {
    const created = await request(app.getHttpServer())
      .post('/personas')
      .set('Authorization', `Bearer ${token}`)
      .send(PERSONA_BODY)
      .expect(201);

    const res = await request(app.getHttpServer())
      .put(`/personas/${created.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: '老妈', relation: '母亲' })
      .expect(200);

    expect(res.body.name).toBe('老妈');
    expect(res.body.relation).toBe('母亲');
    expect(res.body.avatarUrl).toBe(PERSONA_BODY.avatarUrl);
  });

  it('创建后异步完成音色训练 -> status=ready 且带 speakerId', async () => {
    const created = await request(app.getHttpServer())
      .post('/personas')
      .set('Authorization', `Bearer ${token}`)
      .send(PERSONA_BODY)
      .expect(201);

    let body: any;
    for (let i = 0; i < 30; i++) {
      const res = await request(app.getHttpServer())
        .get(`/personas/${created.body.id}`)
        .set('Authorization', `Bearer ${token}`);
      body = res.body;
      if (body.status === 'ready' || body.status === 'failed') break;
      await new Promise((r) => setTimeout(r, 100));
    }

    expect(body.status).toBe('ready');
    expect(body.speakerId).toBe('p-1');
    expect(voice.train).toHaveBeenCalled();
  });

  it('查询人格 -> 200', async () => {
    const created = await request(app.getHttpServer())
      .post('/personas')
      .set('Authorization', `Bearer ${token}`)
      .send(PERSONA_BODY);
    const res = await request(app.getHttpServer())
      .get(`/personas/${created.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(res.body.id).toBe(created.body.id);
  });

  it('缺少 voiceSampleUrl -> 400', async () => {
    await request(app.getHttpServer())
      .post('/personas')
      .set('Authorization', `Bearer ${token}`)
      .send({ avatarUrl: 'http://x/a.jpg' })
      .expect(400);
  });

  it('查询不存在的人格 -> 404', async () => {
    await request(app.getHttpServer())
      .get(`/personas/${randomUUID()}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
  });

  it('访问他人人格 -> 403', async () => {
    const created = await request(app.getHttpServer())
      .post('/personas')
      .set('Authorization', `Bearer ${token}`)
      .send(PERSONA_BODY)
      .expect(201);
    await request(app.getHttpServer())
      .get(`/personas/${created.body.id}`)
      .set('Authorization', `Bearer ${token2}`)
      .expect(403);
  });
});
