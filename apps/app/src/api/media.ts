import { API_BASE_URL } from '../config';
import { getAuthToken } from './request';

export interface UploadResult {
  url: string;
  kind: 'image' | 'audio';
}

export async function uploadFile(
  file: File | Blob,
  name = 'file',
  filename?: string,
): Promise<UploadResult> {
  const formData = new FormData();
  formData.append(name, file, filename);

  const headers: Record<string, string> = {};
  const token = getAuthToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}/media/upload`, {
      method: 'POST',
      headers,
      body: formData,
    });
  } catch {
    throw new Error('上传失败');
  }

  const text = await res.text();
  if (res.status >= 200 && res.status < 300) {
    try {
      return JSON.parse(text) as UploadResult;
    } catch {
      throw new Error('上传响应解析失败');
    }
  }
  throw new Error(`上传失败（${res.status}）`);
}
