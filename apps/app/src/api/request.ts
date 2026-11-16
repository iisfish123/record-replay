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

export async function request<T>(options: RequestOptions): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
    ...options.header,
  };

  const init: RequestInit = {
    method: options.method ?? 'GET',
    headers,
  };

  if (options.data !== undefined && init.method !== 'GET') {
    init.body = JSON.stringify(options.data);
  }

  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}${options.url}`, init);
  } catch {
    throw new Error('网络请求失败');
  }

  const text = await res.text();
  const data = parseJsonSafe(text);

  if (res.status >= 200 && res.status < 300) {
    return data as T;
  }

  throw new Error(extractMessage(data, res.status));
}

function parseJsonSafe(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function extractMessage(data: unknown, statusCode: number): string {
  if (data && typeof data === 'object' && 'message' in data) {
    const m = (data as { message?: unknown }).message;
    if (Array.isArray(m)) return m.join('；');
    if (typeof m === 'string' && m) return m;
  }
  return `请求失败（${statusCode}）`;
}
