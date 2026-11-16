import { describe, it, expect, vi, beforeEach } from 'vitest';
import { uploadFile } from '../src/api/media';
import { setAuthToken } from '../src/api/request';
import { API_BASE_URL } from '../src/config';

const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock.mockReset();
  setAuthToken(null);
});

function mockResponse(status: number, body: string) {
  fetchMock.mockResolvedValue(
    new Response(body, { status, headers: { 'Content-Type': 'application/json' } }),
  );
}

describe('media api', () => {
  const file = new File(['hello'], 'a.jpg', { type: 'image/jpeg' });

  it('上传成功后解析 JSON 结果', async () => {
    mockResponse(200, JSON.stringify({ url: '/static/uploads/a.jpg', kind: 'image' }));
    await expect(uploadFile(file)).resolves.toEqual({
      url: '/static/uploads/a.jpg',
      kind: 'image',
    });
  });

  it('拼上基址、POST、带 token，body 为 FormData', async () => {
    setAuthToken('jwt-1');
    mockResponse(200, JSON.stringify({ url: '/x', kind: 'audio' }));
    await uploadFile(file);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${API_BASE_URL}/media/upload`);
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer jwt-1');
    expect(init.body).toBeInstanceOf(FormData);
  });

  it('非 2xx 时 reject', async () => {
    mockResponse(413, 'too large');
    await expect(uploadFile(file)).rejects.toThrow('上传失败（413）');
  });

  it('响应不是 JSON 时 reject', async () => {
    mockResponse(200, 'not-json');
    await expect(uploadFile(file)).rejects.toThrow('上传响应解析失败');
  });

  it('网络错误时 reject', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(uploadFile(file)).rejects.toThrow('上传失败');
  });
});
