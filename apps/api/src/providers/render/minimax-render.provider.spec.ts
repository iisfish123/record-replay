import { MiniMaxRenderProvider } from './minimax-render.provider';

describe('MiniMaxRenderProvider', () => {
  const cfg = {
    apiKey: 'sk-xxx',
    baseUrl: 'https://api.minimax.cn',
    model: 'MiniMax-H3',
    resolution: '768P',
    duration: 6,
    ratio: '9:16',
    prompt: 'The person is speaking naturally to the camera.',
  };

  it('submit: 以参考图 + 参考音频创建 MiniMax-H3 任务并返回 task_id', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ task_id: 't-1' }),
    });
    const provider = new MiniMaxRenderProvider(cfg as any, fetchMock as any);

    await expect(provider.submit('https://x/a.jpg', 'https://x/v.mp3')).resolves.toBe('t-1');

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.minimax.cn/v2/video_generation');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer sk-xxx');
    const body = JSON.parse(init.body);
    expect(body.model).toBe('MiniMax-H3');
    expect(body.resolution).toBe('768P');
    expect(body.duration).toBe(6);
    // r2va 场景必须显式指定 ratio 且不能为 adaptive，否则上游报 2013
    expect(body.ratio).toBe('9:16');
    expect(body.content[0]).toEqual({ type: 'text', text: cfg.prompt });
    expect(body.content[1]).toEqual({
      type: 'image_url',
      image_url: { url: 'https://x/a.jpg' },
      role: 'reference_image',
    });
    expect(body.content[2]).toEqual({
      type: 'audio_url',
      audio_url: { url: 'https://x/v.mp3' },
      role: 'reference_audio',
    });
  });

  it('submit: 传入语音时长时按其生成（MiniMax 必须显式指定时长，否则长回答会被截断）', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ task_id: 't-1' }),
    });
    const provider = new MiniMaxRenderProvider(cfg as any, fetchMock as any);

    await provider.submit('https://x/a.jpg', 'https://x/v.mp3', 12);

    expect(JSON.parse(fetchMock.mock.calls[0][1].body).duration).toBe(12);
  });

  it('submit: 语音时长超出 MiniMax 允许范围时钳制到 [4,15]', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ task_id: 't-1' }),
    });
    const provider = new MiniMaxRenderProvider(cfg as any, fetchMock as any);

    await provider.submit('https://x/a.jpg', 'https://x/v.mp3', 23);
    await provider.submit('https://x/a.jpg', 'https://x/v.mp3', 1);

    expect(JSON.parse(fetchMock.mock.calls[0][1].body).duration).toBe(15);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).duration).toBe(4);
  });

  it('query: running 映射为 generating', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ task: { status: 'running' } }),
    });
    const provider = new MiniMaxRenderProvider(cfg as any, fetchMock as any);

    await expect(provider.query('t-1')).resolves.toEqual({ status: 'generating', videoUrl: null });

    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.minimax.cn/v2/query/video_generation/t-1');
  });

  it('query: queued 映射为 in_queue', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ task: { status: 'queued' } }),
    });
    const provider = new MiniMaxRenderProvider(cfg as any, fetchMock as any);

    await expect(provider.query('t-1')).resolves.toEqual({ status: 'in_queue', videoUrl: null });
  });

  it('query: succeeded 时返回 content.url', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ task: { status: 'succeeded', content: { url: 'https://v/x.mp4' } } }),
    });
    const provider = new MiniMaxRenderProvider(cfg as any, fetchMock as any);

    await expect(provider.query('t-1')).resolves.toEqual({ status: 'done', videoUrl: 'https://v/x.mp4' });
  });

  it('query: failed / cancelled 映射为 failed', async () => {
    for (const status of ['failed', 'cancelled']) {
      const fetchMock = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ task: { status } }),
      });
      const provider = new MiniMaxRenderProvider(cfg as any, fetchMock as any);

      await expect(provider.query('t-1')).resolves.toEqual({ status: 'failed', videoUrl: null });
    }
  });

  it('submit: 上游返回错误时抛出可读信息', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: false,
      status: 402,
      json: async () => ({ type: 'error', error: { type: 'insufficient_balance_error', message: 'insufficient balance (1008)' } }),
    });
    const provider = new MiniMaxRenderProvider(cfg as any, fetchMock as any);

    await expect(provider.submit('https://x/a.jpg', 'https://x/v.mp3')).rejects.toThrow(/1008/);
  });
});
