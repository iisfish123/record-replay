import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { SMS_CLIENT } from '../src/auth/sms.service';
import { CHAT_PROVIDER } from '../src/providers/chat/chat.provider';
import { VOICE_PROVIDER } from '../src/providers/voice/voice.provider';
import { RENDER_PROVIDER } from '../src/providers/render/render.provider';

const VOICE_SAMPLE = `data:audio/mp3;base64,${Buffer.from('audio').toString('base64')}`;
const REMOTE_VIDEO = `data:video/mp4;base64,${Buffer.from('fake-video').toString('base64')}`;

describe('task e2e', () => {
  let app: INestApplication;
  let token: string;
  let personaId: string;

  const chat = { answer: jest.fn().mockResolvedValue('孩子，我很好，别挂念。') };
  const voice = {
    train: jest.fn().mockResolvedValue({ speakerId: 'p-1' }),
    queryTrainStatus: jest.fn().mockResolvedValue('ready'),
    synthesize: jest.fn().mockResolvedValue({ audio: Buffer.from('audio'), durationMs: 4200 }),
  };
  const render = {
    submit: jest.fn().mockResolvedValue('task-1'),
    query: jest.fn().mockResolvedValue({ status: 'done', videoUrl: REMOTE_VIDEO }),
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
      .overrideProvider(CHAT_PROVIDER)
      .useValue(chat)
      .overrideProvider(VOICE_PROVIDER)
      .useValue(voice)
      .overrideProvider(RENDER_PROVIDER)
      .useValue(render)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();

    const login = await request(app.getHttpServer())
      .post('/auth/sms/login')
      .send({ phone: '15920328004', code: '123456' });
    token = login.body.token;

    const persona = await request(app.getHttpServer())
      .post('/personas')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: '爸爸', relation: '父亲', avatarUrl: 'http://x/a.jpg', voiceSampleUrl: VOICE_SAMPLE });
    personaId = persona.body.id;

    for (let i = 0; i < 30; i++) {
      const res = await request(app.getHttpServer())
        .get(`/personas/${personaId}`)
        .set('Authorization', `Bearer ${token}`);
      if (res.body.status === 'ready') break;
      await new Promise((r) => setTimeout(r, 100));
    }
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
    for (let i = 0; i < 50; i++) {
      const res = await request(app.getHttpServer())
        .get(`/tasks/${taskId}`)
        .set('Authorization', `Bearer ${token}`);
      body = res.body;
      if (body.status === 'done' || body.status === 'failed') break;
      await new Promise((r) => setTimeout(r, 100));
    }

    expect(body.status).toBe('done');
    expect(body.videoUrl).toMatch(/\/static\/videos\//);
    expect(body.answerText).toBe('孩子，我很好，别挂念。');
    // 第 3 个参数为语音实际时长（秒），MiniMax 依赖它对齐口型视频长度；
    // 第 4 个参数为回答文本，MiniMax r2va 模式下需放入 <d> 标签决定语音内容
    expect(render.submit).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      5,
      '孩子，我很好，别挂念。',
    );
  });
});
