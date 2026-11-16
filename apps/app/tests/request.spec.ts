import { describe, it, expect, vi, beforeEach } from 'vitest';
import { request, setAuthToken, getAuthToken } from '../src/api/request';
import { API_BASE_URL } from '../src/config';

const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock.mockReset();
  setAuthToken(null);
  localStorage.clear();
});

function mockResponse(status: number, body: unknown) {
  fetchMock.mockResolvedValue(
    new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}

describe('request', () => {
  it('成功时 resolve data', async () => {
    mockResponse(200, { ok: true });
    await expect(request({ url: '/health' })).resolves.toEqual({ ok: true });
  });

  it('拼上基址、默认 GET、带 Content-Type', async () => {
    mockResponse(200, {});
    await request({ url: '/auth/sms/send', method: 'POST', data: { phone: '15920328477' } });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${API_BASE_URL}/auth/sms/send`);
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
  });

  it('POST 时 body 为 JSON 字符串', async () => {
    mockResponse(200, {});
    await request({ url: '/x', method: 'POST', data: { a: 1 } });
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.body).toBe(JSON.stringify({ a: 1 }));
  });

  it('有 token 时带 Authorization', async () => {
    setAuthToken('jwt-abc');
    mockResponse(200, {});
    await request({ url: '/personas' });
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer jwt-abc');
    expect(getAuthToken()).toBe('jwt-abc');
  });

  it('无 token 时不带 Authorization', async () => {
    mockResponse(200, {});
    await request({ url: '/health' });
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it('非 2xx 时 reject 并带后端 message', async () => {
    mockResponse(400, { message: '验证码错误' });
    await expect(request({ url: '/auth/sms/login' })).rejects.toThrow('验证码错误');
  });

  it('message 为数组时拼接', async () => {
    mockResponse(400, { message: ['手机号不正确', '验证码为 6 位数字'] });
    await expect(request({ url: '/x' })).rejects.toThrow('手机号不正确；验证码为 6 位数字');
  });

  it('无 message 时回退到状态码文案', async () => {
    mockResponse(500, {});
    await expect(request({ url: '/x' })).rejects.toThrow('请求失败（500）');
  });

  it('网络错误时 reject', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(request({ url: '/health' })).rejects.toThrow('网络请求失败');
  });
});
