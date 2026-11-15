import { SmsService } from './sms.service';

describe('SmsService', () => {
  const createClient = () => ({
    sendSmsVerifyCodeWithOptions: jest.fn().mockResolvedValue({ body: { code: 'OK' } }),
    checkSmsVerifyCodeWithOptions: jest
      .fn()
      .mockResolvedValue({ body: { code: 'OK', model: { verifyResult: 'PASS' } } }),
  });

  it('发码时带上签名与模板，用平台托管占位符 ##code## 动态生成验证码', async () => {
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
    expect(param.code).toBe('##code##');
    expect(param.min).toBe('5');
  });

  it('VerifyResult=PASS 返回 true', async () => {
    const client = createClient();
    const svc = new SmsService(client as any, { signName: 's', templateCode: 't' } as any);
    await expect(svc.check('15920328477', '123456')).resolves.toBe(true);
    expect(client.checkSmsVerifyCodeWithOptions).toHaveBeenCalled();
  });

  it('接口成功但 VerifyResult=UNKNOWN 返回 false', async () => {
    const client = createClient();
    client.checkSmsVerifyCodeWithOptions.mockResolvedValue({
      body: { code: 'OK', model: { verifyResult: 'UNKNOWN' } },
    });
    const svc = new SmsService(client as any, { signName: 's', templateCode: 't' } as any);
    await expect(svc.check('15920328477', '000000')).resolves.toBe(false);
  });

  it('接口返回非 OK 时返回 false', async () => {
    const client = createClient();
    client.checkSmsVerifyCodeWithOptions.mockResolvedValue({ body: { code: 'isv.INVALID_PARAMETERS' } });
    const svc = new SmsService(client as any, { signName: 's', templateCode: 't' } as any);
    await expect(svc.check('15920328477', '000000')).resolves.toBe(false);
  });
});
