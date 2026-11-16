import { VolcanoVoiceProvider } from './voice.provider';

describe('VolcanoVoiceProvider', () => {
  const cfg = { appid: '1119668586', accessToken: 'tok' };

  it('train: 用旧版控制台鉴权提交训练，返回 speakerId', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: 2, model_type: 5, speaker_id: 'custom_zh_p1' }),
    });
    const provider = new VolcanoVoiceProvider(cfg as any, fetchMock as any);

    const out = await provider.train('custom_zh_p1', Buffer.from('wav-bytes'), 'wav');

    expect(out.speakerId).toBe('custom_zh_p1');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://openspeech.bytedance.com/api/v3/tts/voice_clone');
    expect(init.method).toBe('POST');
    expect(init.headers['X-Api-App-Key']).toBe('1119668586');
    expect(init.headers['X-Api-Access-Key']).toBe('tok');
    expect(init.headers['X-Api-Request-Id']).toBeTruthy();
    const body = JSON.parse(init.body);
    expect(body.speaker_id).toBe('custom_speaker_id');
    expect(body.custom_speaker_id).toBe('custom_zh_p1');
    expect(body.audio.format).toBe('wav');
    expect(body.audio.data).toBe(Buffer.from('wav-bytes').toString('base64'));
    expect(body.language).toBe(0);
  });

  it('train: 上游返回非 2xx 时抛错并带错误码', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ code: 45000030, message: 'resource not granted' }),
    });
    const provider = new VolcanoVoiceProvider(cfg as any, fetchMock as any);

    await expect(provider.train('custom_zh_p1', Buffer.from('a'), 'wav')).rejects.toThrow(/45000030/);
  });

  it('train: status=3 时抛训练失败', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: 3, speaker_id: 'custom_zh_p1' }),
    });
    const provider = new VolcanoVoiceProvider(cfg as any, fetchMock as any);

    await expect(provider.train('custom_zh_p1', Buffer.from('a'), 'wav')).rejects.toThrow(/训练失败/);
  });

  it('queryTrainStatus: 用 v3 get_voice 查询并映射状态', async () => {
    const cases: Array<[number, string]> = [
      [2, 'ready'],
      [4, 'ready'],
      [1, 'training'],
      [0, 'training'],
      [3, 'failed'],
    ];

    for (const [status, expected] of cases) {
      const fetchMock = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ status, available_training_times: 15 }),
      });
      const provider = new VolcanoVoiceProvider(cfg as any, fetchMock as any);

      await expect(provider.queryTrainStatus('custom_zh_p1')).resolves.toBe(expected);

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('https://openspeech.bytedance.com/api/v3/tts/get_voice');
      const body = JSON.parse(init.body);
      expect(body.speaker_id).toBe('custom_speaker_id');
      expect(body.custom_speaker_id).toBe('custom_zh_p1');
    }
  });

  it('synthesize: 累积 JSON-lines 音频分片，返回 mp3 Buffer', async () => {
    const chunk1 = Buffer.from('mp3-part-1').toString('base64');
    const chunk2 = Buffer.from('-part-2').toString('base64');
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      text: async () =>
        [
          JSON.stringify({ code: 0, data: chunk1 }),
          JSON.stringify({ code: 0, data: chunk2 }),
          JSON.stringify({ code: 20000000, message: 'OK', data: null }),
        ].join('\n'),
    });
    const provider = new VolcanoVoiceProvider(cfg as any, fetchMock as any);

    const out = await provider.synthesize('孩子，妈妈一直都在。', 'custom_zh_p1');

    expect(out.toString()).toBe('mp3-part-1-part-2');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://openspeech.bytedance.com/api/v3/tts/unidirectional');
    expect(init.headers['X-Api-Resource-Id']).toBe('seed-icl-2.0');
    expect(init.headers['X-Api-App-Id']).toBe('1119668586');
    const body = JSON.parse(init.body);
    expect(body.req_params.text).toBe('孩子，妈妈一直都在。');
    expect(body.req_params.speaker).toBe('custom_zh_p1');
    expect(body.req_params.audio_params.format).toBe('mp3');
  });

  it('synthesize: 返回业务错误码时抛错', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ code: 55000000, message: 'resource mismatched' }),
    });
    const provider = new VolcanoVoiceProvider(cfg as any, fetchMock as any);

    await expect(provider.synthesize('hi', 'bad-speaker')).rejects.toThrow(/55000000/);
  });
});
