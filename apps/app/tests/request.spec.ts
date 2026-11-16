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
