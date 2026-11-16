import { MiniMaxVoiceProvider } from './minimax-voice.provider';

describe('MiniMaxVoiceProvider', () => {
  const cfg = {
    apiKey: 'sk-xxx',
    baseUrl: 'https://api.minimax.cn',
    ttsModel: 'speech-2.8-turbo',
  };
  const VOICE_ID = 'custom_zh_rr_abcdef123456';

  it('mode 为 clone（复刻音色 9.9 元/音色）', () => {
    const provider = new MiniMaxVoiceProvider(cfg as any, jest.fn() as any);
    expect(provider.mode).toBe('clone');
  });

  it('train: 先上传样本（purpose=voice_clone）再复刻，且不带 text（避免试听合成计费）', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ file: { file_id: 123 }, base_resp: { status_code: 0, status_msg: 'success' } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ base_resp: { status_code: 0, status_msg: 'success' } }),
      });
    const provider = new MiniMaxVoiceProvider(cfg as any, fetchMock as any);

    const out = await provider.train(VOICE_ID, Buffer.from('wav-bytes'), 'wav');

    expect(out.speakerId).toBe(VOICE_ID);

    const [uploadUrl, uploadInit] = fetchMock.mock.calls[0];
    expect(uploadUrl).toBe('https://api.minimax.cn/v1/files/upload');
    expect(uploadInit.method).toBe('POST');
    expect(uploadInit.headers.Authorization).toBe('Bearer sk-xxx');
    expect(uploadInit.body).toBeInstanceOf(FormData);
    expect(uploadInit.body.get('purpose')).toBe('voice_clone');
    expect(uploadInit.body.get('file')).toBeTruthy();

    const [cloneUrl, cloneInit] = fetchMock.mock.calls[1];
    expect(cloneUrl).toBe('https://api.minimax.cn/v1/voice_clone');
    expect(cloneInit.headers.Authorization).toBe('Bearer sk-xxx');
    const body = JSON.parse(cloneInit.body);
    expect(body.file_id).toBe(123);
    expect(body.voice_id).toBe(VOICE_ID);
    expect(body.text).toBeUndefined();
  });

  it('train: 样本为 webm（真机 WebView 录音格式）时先转 mp3 再上传', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ file: { file_id: 123 }, base_resp: { status_code: 0 } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ base_resp: { status_code: 0 } }),
      });
    const transcode = jest.fn().mockResolvedValue(Buffer.from('mp3-bytes'));
    const provider = new MiniMaxVoiceProvider(cfg as any, fetchMock as any, transcode);

    await provider.train(VOICE_ID, Buffer.from('webm-bytes'), 'webm');

    expect(transcode).toHaveBeenCalledTimes(1);
    expect(transcode.mock.calls[0][0].toString()).toBe('webm-bytes');
    const uploaded = (fetchMock.mock.calls[0][1].body as FormData).get('file') as unknown as {
      name: string;
    };
    expect(uploaded.name).toBe('sample.mp3');
  });

  it('train: 样本已是上游接受的格式（mp3/m4a/wav）时不转码', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ file: { file_id: 123 }, base_resp: { status_code: 0 } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ base_resp: { status_code: 0 } }),
      });
    const transcode = jest.fn();
    const provider = new MiniMaxVoiceProvider(cfg as any, fetchMock as any, transcode);

    await provider.train(VOICE_ID, Buffer.from('wav-bytes'), 'wav');

    expect(transcode).not.toHaveBeenCalled();
    const uploaded = (fetchMock.mock.calls[0][1].body as FormData).get('file') as unknown as {
      name: string;
    };
    expect(uploaded.name).toBe('sample.wav');
  });

  it('train: 缺少样本音频时抛错', async () => {
    const provider = new MiniMaxVoiceProvider(cfg as any, jest.fn() as any);
    await expect(provider.train(VOICE_ID)).rejects.toThrow(/样本音频/);
  });

  it('train: 上传返回业务错误时抛错', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ base_resp: { status_code: 1004, status_msg: 'login fail' } }),
    });
    const provider = new MiniMaxVoiceProvider(cfg as any, fetchMock as any);

    await expect(provider.train(VOICE_ID, Buffer.from('a'), 'wav')).rejects.toThrow(/1004/);
  });

  it('train: 复刻返回业务错误时抛错', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ file: { file_id: 123 }, base_resp: { status_code: 0 } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ base_resp: { status_code: 1043, status_msg: 'asr similarity check failed' } }),
      });
    const provider = new MiniMaxVoiceProvider(cfg as any, fetchMock as any);

    await expect(provider.train(VOICE_ID, Buffer.from('a'), 'wav')).rejects.toThrow(/1043/);
  });

  it('queryTrainStatus: 固定返回 ready（复刻为同步接口）', async () => {
    const provider = new MiniMaxVoiceProvider(cfg as any, jest.fn() as any);
    await expect(provider.queryTrainStatus(VOICE_ID)).resolves.toBe('ready');
  });

  it('synthesize: 调用 t2a_v2，把 hex 音频解码为 Buffer 并回报音频时长', async () => {
    const hex = Buffer.from('mp3-bytes').toString('hex');
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: { audio: hex, status: 2 },
        extra_info: { audio_length: 3740 },
        base_resp: { status_code: 0 },
      }),
    });
    const provider = new MiniMaxVoiceProvider(cfg as any, fetchMock as any);

    const out = await provider.synthesize('你好呀', VOICE_ID);

    expect(out.audio.toString()).toBe('mp3-bytes');
    // 视频时长必须与语音实际长度对齐，否则口型会被截断
    expect(out.durationMs).toBe(3740);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.minimax.cn/v1/t2a_v2');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer sk-xxx');
    const body = JSON.parse(init.body);
    expect(body.model).toBe('speech-2.8-turbo');
    expect(body.stream).toBe(false);
    expect(body.voice_setting.voice_id).toBe(VOICE_ID);
    expect(body.text).toBe('你好呀');
    expect(body.audio_setting.format).toBe('mp3');
  });

  it('synthesize: base_resp 非 0 时抛错', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: null, base_resp: { status_code: 1008, status_msg: 'insufficient balance' } }),
    });
    const provider = new MiniMaxVoiceProvider(cfg as any, fetchMock as any);

    await expect(provider.synthesize('hi', VOICE_ID)).rejects.toThrow(/1008/);
  });

  it('synthesize: 未返回音频时抛错', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { audio: '', status: 2 }, base_resp: { status_code: 0 } }),
    });
    const provider = new MiniMaxVoiceProvider(cfg as any, fetchMock as any);

    await expect(provider.synthesize('hi', VOICE_ID)).rejects.toThrow(/音频/);
  });

  it('synthesize: 上游未返回 extra_info 时 durationMs 为 0（交渲染方兜底）', async () => {
    const hex = Buffer.from('mp3-bytes').toString('hex');
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { audio: hex, status: 2 }, base_resp: { status_code: 0 } }),
    });
    const provider = new MiniMaxVoiceProvider(cfg as any, fetchMock as any);

    await expect(provider.synthesize('你好呀', VOICE_ID)).resolves.toMatchObject({ durationMs: 0 });
  });
});
