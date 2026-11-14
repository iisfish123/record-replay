import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
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
      .send({ avatarUrl: 'http://x/a.jpg', voiceSampleUrl: 'http://x/v.mp3' })
      .expect(201);
    expect(res.body.status).toBe('pending');
    expect(res.body.id).toBeTruthy();
  });

  it('查询人格 -> 200', async () => {
    const created = await request(app.getHttpServer())
      .post('/personas')
      .set('Authorization', `Bearer ${token}`)
      .send({ avatarUrl: 'http://x/a.jpg', voiceSampleUrl: 'http://x/v.mp3' });
    const res = await request(app.getHttpServer())
      .get(`/personas/${created.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(res.body.id).toBe(created.body.id);
  });
});
