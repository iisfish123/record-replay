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
