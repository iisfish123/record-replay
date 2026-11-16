import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { SMS_CLIENT } from '../src/auth/sms.service';

describe('auth e2e', () => {
  let app: INestApplication;
  const smsClient = {
    sendSmsVerifyCodeWithOptions: jest.fn().mockResolvedValue({ body: { code: 'OK' } }),
    checkSmsVerifyCodeWithOptions: jest
      .fn()
      .mockResolvedValue({ body: { code: 'OK', model: { verifyResult: 'PASS' } } }),
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
