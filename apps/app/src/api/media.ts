import { API_BASE_URL } from '../config';
import { getAuthToken } from './request';

export interface UploadResult {
  url: string;
  kind: 'image' | 'audio';
}

interface UniUploadSuccess {
  statusCode: number;
  data: string;
}

export function uploadFile(filePath: string, name = 'file'): Promise<UploadResult> {
  const token = getAuthToken();
  return new Promise<UploadResult>((resolve, reject) => {
    uni.uploadFile({
      url: `${API_BASE_URL}/media/upload`,
      filePath,
      name,
      header: token ? { Authorization: `Bearer ${token}` } : {},
      success: (raw: unknown) => {
        const res = raw as UniUploadSuccess;
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(JSON.parse(res.data) as UploadResult);
          } catch {
            reject(new Error('上传响应解析失败'));
          }
        } else {
          reject(new Error(`上传失败（${res.statusCode}）`));
        }
      },
      fail: (err: unknown) => {
        reject(new Error((err as { errMsg?: string })?.errMsg ?? '上传失败'));
      },
    });
  });
}
