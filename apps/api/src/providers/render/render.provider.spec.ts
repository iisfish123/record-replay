import { OmniHumanRenderProvider } from './render.provider';

describe('OmniHumanRenderProvider', () => {
  const cfg = {
    accessKeyId: 'ak',
    accessKeySecret: 'sk',
    reqKey: 'realman_avatar_picture_omni20_cvtob',
  };

  it('submit: 以 v4 签名调用 CVSync2AsyncSubmitTask 并返回 taskId', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ code: 10000, data: { task_id: 't-1' } }),
    });
    const provider = new OmniHumanRenderProvider(cfg as any, fetchMock as any);

    await expect(provider.submit('https://x/a.jpg', 'https://x/v.mp3')).resolves.toBe('t-1');

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('https://visual.volcengineapi.com/?');
    expect(url).toContain('Action=CVSync2AsyncSubmitTask');
    expect(url).toContain('Version=2022-08-31');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toContain('HMAC-SHA256 Credential=ak/');
    expect(init.headers.Authorization).toContain('SignedHeaders=content-type;host;x-content-sha256;x-date');
    expect(init.headers['X-Content-Sha256']).toMatch(/^[0-9a-f]{64}$/);
    expect(init.headers['X-Date']).toMatch(/^\d{8}T\d{6}Z$/);

    const body = JSON.parse(init.body);
    expect(body.req_key).toBe('realman_avatar_picture_omni20_cvtob');
    expect(body.image_urls).toEqual(['https://x/a.jpg']);
    expect(body.audio_url).toBe('https://x/v.mp3');
    expect(body.enable_watermark).toBe(false);
  });

  it('query: 用 CVSync2AsyncGetResult 查询，generating 时无 videoUrl', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ code: 10000, data: { status: 'generating' } }),
    });
    const provider = new OmniHumanRenderProvider(cfg as any, fetchMock as any);

    await expect(provider.query('t-1')).resolves.toEqual({ status: 'generating', videoUrl: null });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('Action=CVSync2AsyncGetResult');
    const body = JSON.parse(init.body);
    expect(body.req_key).toBe('realman_avatar_picture_omni20_cvtob');
    expect(body.task_id).toBe('t-1');
  });

  it('query: done 时返回 videoUrl', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ code: 10000, data: { status: 'done', video_url: 'https://v/x.mp4' } }),
    });
    const provider = new OmniHumanRenderProvider(cfg as any, fetchMock as any);

    await expect(provider.query('t-1')).resolves.toEqual({ status: 'done', videoUrl: 'https://v/x.mp4' });
  });

  it('query: not_found / expired 视为 failed', async () => {
    for (const status of ['not_found', 'expired']) {
      const fetchMock = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ code: 10000, data: { status } }),
      });
      const provider = new OmniHumanRenderProvider(cfg as any, fetchMock as any);

      await expect(provider.query('t-1')).resolves.toEqual({ status: 'failed', videoUrl: null });
    }
  });

  it('审核拦截时抛出可读错误', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ code: 50413, message: 'Post Text Risk Not Pass' }),
    });
    const provider = new OmniHumanRenderProvider(cfg as any, fetchMock as any);

    await expect(provider.submit('https://x/a.jpg', 'https://x/v.mp3')).rejects.toThrow(/内容审核/);
  });
});
