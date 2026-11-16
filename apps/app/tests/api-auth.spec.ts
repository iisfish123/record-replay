import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/api/request', () => ({ request: vi.fn(), setAuthToken: vi.fn(), getAuthToken: vi.fn() }));
import { request } from '../src/api/request';
import { sendCode, login } from '../src/api/auth';

const mocked = request as unknown as ReturnType<typeof vi.fn>;

describe('auth api', () => {
  it('sendCode 调对路径与参数', async () => {
    mocked.mockResolvedValue({ ok: true });
    await sendCode('15920328477');
    expect(mocked).toHaveBeenCalledWith({
      url: '/auth/sms/send',
      method: 'POST',
      data: { phone: '15920328477' },
    });
  });

  it('login 调对路径与参数并返回 token', async () => {
    mocked.mockResolvedValue({ token: 't', userId: 'u' });
    const res = await login('15920328477', '123456');
    expect(mocked).toHaveBeenCalledWith({
      url: '/auth/sms/login',
      method: 'POST',
      data: { phone: '15920328477', code: '123456' },
    });
    expect(res).toEqual({ token: 't', userId: 'u' });
  });
});
