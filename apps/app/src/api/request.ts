import { API_BASE_URL } from '../config';

let authToken: string | null = null;

export function setAuthToken(token: string | null): void {
  authToken = token;
}

export function getAuthToken(): string | null {
  return authToken;
}

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

export interface RequestOptions {
  url: string;
  method?: HttpMethod;
  data?: Record<string, unknown>;
  header?: Record<string, string>;
}

interface UniSuccessResponse {
  statusCode: number;
  data: unknown;
}

interface UniFailResponse {
  errMsg?: string;
}

export function request<T>(options: RequestOptions): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    uni.request({
      url: `${API_BASE_URL}${options.url}`,
      method: options.method ?? 'GET',
      data: options.data,
      header: {
        'Content-Type': 'application/json',
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        ...options.header,
      },
      success: (raw: unknown) => {
        const res = raw as UniSuccessResponse;
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.data as T);
        } else {
          reject(new Error(extractMessage(res.data, res.statusCode)));
        }
      },
      fail: (err: unknown) => {
        reject(new Error((err as UniFailResponse)?.errMsg ?? '网络请求失败'));
      },
    });
  });
}

function extractMessage(data: unknown, statusCode: number): string {
  if (data && typeof data === 'object' && 'message' in data) {
    const m = (data as { message?: unknown }).message;
    if (Array.isArray(m)) return m.join('；');
    if (typeof m === 'string' && m) return m;
  }
  return `请求失败（${statusCode}）`;
}
