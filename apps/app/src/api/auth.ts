import { request } from './request';

export interface LoginResult {
  token: string;
  userId: string;
}

export function sendCode(phone: string): Promise<{ ok: boolean }> {
  return request({ url: '/auth/sms/send', method: 'POST', data: { phone } });
}

export function login(phone: string, code: string): Promise<LoginResult> {
  return request({ url: '/auth/sms/login', method: 'POST', data: { phone, code } });
}
