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

  /** 模拟 fetch：按 URL 路由返回不同响应。 */
  function makeFetchMock(opts: { genError?: boolean } = {}) {
    return jest.fn(async (url: string, init?: any) => {
      // 下载素材（http/https 开头的非 minimax URL）
      if (url.startsWith('http') && !url.includes('minimax.cn')) {
        return {
          ok: true,
          arrayBuffer: async () => Buffer.from('fake-binary'),
        } as any;
      }
      // 上传到 MiniMax 文件服务
      if (url.endsWith('/v1/files/upload')) {
        return {
          ok: true,
          json: async () => ({ file: { file_id: `file-${Date.now()}` }, base_resp: { status_code: 0, status_msg: 'success' } }),
        } as any;
      }
      // 查询视频任务
      if (url.includes('/v2/query/video_generation/')) {
        return {
          ok: true,
          json: async () => ({ task: { status: 'running' } }),
        } as any;
      }
      // 创建视频任务
      if (url.endsWith('/v2/video_generation')) {
        if (opts.genError) {
          return {
            ok: false,
            status: 402,
            json: async () => ({ type: 'error', error: { type: 'insufficient_balance_error', message: 'insufficient balance (1008)' } }),
          } as any;
        }
        return {
          ok: true,
          json: async () => ({ task_id: 't-1' }),
        } as any;
      }
      return { ok: true, json: async () => ({}) } as any;
    });
  }

  it('submit: 下载素材 → 上传 MiniMax → 用 mm_file:// 创建任务，返回 task_id', async () => {
    const fetchMock = makeFetchMock();
    const provider = new MiniMaxRenderProvider(cfg as any, fetchMock as any);

    await expect(provider.submit('https://x/a.jpg', 'https://x/v.mp3')).resolves.toBe('t-1');

    // 应有 5 次 fetch：下载图、下载音、上图、上音、创建任务
    expect(fetchMock).toHaveBeenCalledTimes(5);

    // 最后一次是创建视频任务
    const genCall = fetchMock.mock.calls[4];
    expect(genCall[0]).toBe('https://api.minimax.cn/v2/video_generation');
    const body = JSON.parse(genCall[1].body);
    expect(body.content[1].image_url.url).toMatch(/^mm_file:\/\//);
    expect(body.content[2].audio_url.url).toMatch(/^mm_file:\/\//);
    expect(body.ratio).toBe('9:16');
    expect(body.duration).toBe(6);
  });

  it('submit: 传入语音时长时按其生成', async () => {
    const fetchMock = makeFetchMock();
    const provider = new MiniMaxRenderProvider(cfg as any, fetchMock as any);

    await provider.submit('https://x/a.jpg', 'https://x/v.mp3', 12);

    const genCall = fetchMock.mock.calls[4];
    expect(JSON.parse(genCall[1].body).duration).toBe(12);
  });

  it('submit: 传入 answerText 时拼入 <d>[Chinese]...</d> 标签', async () => {
    const fetchMock = makeFetchMock();
    const provider = new MiniMaxRenderProvider(cfg as any, fetchMock as any);
    const answer = '妮儿啊，天空蓝，是太阳光里的蓝光爱散开。';

    await provider.submit('https://x/a.jpg', 'https://x/v.mp3', 6, answer);

    const body = JSON.parse(fetchMock.mock.calls[4][1].body);
    const text = body.content[0].text as string;
    // 原有 prompt 保留，<d> 标签内是语言标签 + 原话
    expect(text).toContain(cfg.prompt);
    expect(text).toContain('<d>[Chinese]');
    expect(text).toContain(answer);
    expect(text).toContain('</d>');
  });

  it('submit: 未传 answerText 时不拼 <d> 标签', async () => {
    const fetchMock = makeFetchMock();
    const provider = new MiniMaxRenderProvider(cfg as any, fetchMock as any);

    await provider.submit('https://x/a.jpg', 'https://x/v.mp3', 6);

    const body = JSON.parse(fetchMock.mock.calls[4][1].body);
    expect(body.content[0].text).toBe(cfg.prompt);
    expect(body.content[0].text).not.toContain('<d>');
  });

  it('submit: 语音时长超出 [4,15] 时钳制', async () => {
    const fetchMock = makeFetchMock();
    const provider = new MiniMaxRenderProvider(cfg as any, fetchMock as any);

    await provider.submit('https://x/a.jpg', 'https://x/v.mp3', 23);
    expect(JSON.parse(fetchMock.mock.calls[4][1].body).duration).toBe(15);

    await provider.submit('https://x/a.jpg', 'https://x/v.mp3', 1);
    expect(JSON.parse(fetchMock.mock.calls[9][1].body).duration).toBe(4);
  });

  it('submit: 上传失败时抛出可读错误', async () => {
    const fetchMock = jest.fn(async (url: string) => {
      if (url.startsWith('http') && !url.includes('minimax.cn')) {
        return { ok: true, arrayBuffer: async () => Buffer.from('x') } as any;
      }
      if (url.endsWith('/v1/files/upload')) {
        return {
          ok: false,
          json: async () => ({ base_resp: { status_msg: '文件格式不支持' } }),
        } as any;
      }
      return { ok: true, json: async () => ({}) } as any;
    });
    const provider = new MiniMaxRenderProvider(cfg as any, fetchMock as any);

    await expect(provider.submit('https://x/a.jpg', 'https://x/v.mp3')).rejects.toThrow('上传素材到 MiniMax 失败');
  });

  it('query: running 映射为 generating', async () => {
    const fetchMock = makeFetchMock();
    const provider = new MiniMaxRenderProvider(cfg as any, fetchMock as any);

    await expect(provider.query('t-1')).resolves.toEqual({ status: 'generating', videoUrl: null });
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.minimax.cn/v2/query/video_generation/t-1');
  });

  it('query: succeeded 时返回 content.url', async () => {
    const fetchMock = jest.fn(async () => ({
      ok: true,
      json: async () => ({ task: { status: 'succeeded', content: { url: 'https://v/x.mp4' } } }),
    }));
    const provider = new MiniMaxRenderProvider(cfg as any, fetchMock as any);

    await expect(provider.query('t-1')).resolves.toEqual({ status: 'done', videoUrl: 'https://v/x.mp4' });
  });

  it('query: failed 时带上 MiniMax 的错误原因', async () => {
    const fetchMock = jest.fn(async () => ({
      ok: true,
      json: async () => ({ task: { status: 'failed', error: { code: '2013', message: 'media url unreachable' } } }),
    }));
    const provider = new MiniMaxRenderProvider(cfg as any, fetchMock as any);

    const result = await provider.query('t-1');
    expect(result.status).toBe('failed');
    expect(result.error).toBe('media url unreachable');
  });

  it('submit: 上游余额不足时抛出可读信息', async () => {
    const fetchMock = makeFetchMock({ genError: true });
    const provider = new MiniMaxRenderProvider(cfg as any, fetchMock as any);

    await expect(provider.submit('https://x/a.jpg', 'https://x/v.mp3')).rejects.toThrow(/1008/);
  });
});
