import { describe, it, expect, vi, beforeEach } from 'vitest';
import { uploadFile } from '../src/api/media';
import { setAuthToken } from '../src/api/request';
import { API_BASE_URL } from '../src/config';

const uniUpload = uni.uploadFile as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  uniUpload.mockReset();
  setAuthToken(null);
});

describe('media api', () => {
  it('上传成功后解析 JSON 结果', async () => {
    uniUpload.mockImplementation((opts: any) =>
      opts.success({ statusCode: 200, data: JSON.stringify({ url: '/static/uploads/a.jpg', kind: 'image' }) }),
    );
    await expect(uploadFile('/tmp/a.jpg')).resolves.toEqual({
      url: '/static/uploads/a.jpg',
      kind: 'image',
    });
  });

  it('拼上基址、name=file、带 token', async () => {
    setAuthToken('jwt-1');
    uniUpload.mockImplementation((opts: any) =>
      opts.success({ statusCode: 200, data: JSON.stringify({ url: '/x', kind: 'audio' }) }),
    );
    await uploadFile('/tmp/v.mp3');
    const arg = uniUpload.mock.calls[0][0];
    expect(arg.url).toBe(`${API_BASE_URL}/media/upload`);
    expect(arg.name).toBe('file');
    expect(arg.filePath).toBe('/tmp/v.mp3');
    expect(arg.header.Authorization).toBe('Bearer jwt-1');
  });

  it('非 2xx 时 reject', async () => {
    uniUpload.mockImplementation((opts: any) => opts.success({ statusCode: 413, data: 'too large' }));
    await expect(uploadFile('/tmp/big.mp4')).rejects.toThrow('上传失败（413）');
  });

  it('响应不是 JSON 时 reject', async () => {
    uniUpload.mockImplementation((opts: any) => opts.success({ statusCode: 200, data: 'not-json' }));
    await expect(uploadFile('/tmp/a.jpg')).rejects.toThrow('上传响应解析失败');
  });

  it('fail 时 reject', async () => {
    uniUpload.mockImplementation((opts: any) => opts.fail({ errMsg: 'uploadFile:fail' }));
    await expect(uploadFile('/tmp/a.jpg')).rejects.toThrow('uploadFile:fail');
  });
});
