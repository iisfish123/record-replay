import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { SMS_CLIENT } from '../src/auth/sms.service';

describe('media e2e', () => {
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
