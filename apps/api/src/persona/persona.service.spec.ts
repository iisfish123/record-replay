import { ConflictException } from '@nestjs/common';
import { PersonaService } from './persona.service';
import type { VoiceProvider } from '../providers/voice/voice.provider';

function makeRepo() {
  return {
    findOne: jest.fn(),
    create: jest.fn((v: any) => v),
    save: jest.fn(async (v: any) => ({ id: 'p-new', ...v })),
    update: jest.fn(async () => undefined),
  };
}

function makeVoice(mode: 'preset' | 'clone', speakerId = 'custom_zh_rr_abc123'): VoiceProvider {
  return {
    mode,
    train: jest.fn().mockResolvedValue({ speakerId }),
    queryTrainStatus: jest.fn(),
    synthesize: jest.fn(),
  } as unknown as VoiceProvider;
}

describe('PersonaService', () => {
  afterEach(() => jest.restoreAllMocks());

  describe('create 音色复用（防重复扣费）', () => {
    it('用户已有 ready 音色时，新人格直接复用 speakerId，不调用 train', async () => {
      const repo = makeRepo();
      repo.findOne.mockResolvedValue({
        id: 'p-old',
        userId: 'u1',
        status: 'ready',
        speakerId: 'custom_zh_old',
      });
      const voice = makeVoice('clone');
      const service = new PersonaService(repo as any, voice);

      const persona = await service.create('u1', '/a.jpg', '/v.mp3');

      expect(persona.speakerId).toBe('custom_zh_old');
      expect(persona.status).toBe('ready');
      expect(voice.train).not.toHaveBeenCalled();
    });

    it('已有音色正在训练中时拒绝新建，避免并发重复扣费', async () => {
      const repo = makeRepo();
      repo.findOne
        .mockResolvedValueOnce(null) // 无可用音色
        .mockResolvedValueOnce({ id: 'p-inflight', status: 'training' }); // 有在途训练
      const voice = makeVoice('clone');
      const service = new PersonaService(repo as any, voice);

      await expect(service.create('u1', '/a.jpg', '/v.mp3')).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(voice.train).not.toHaveBeenCalled();
    });

    it('无历史音色时正常创建为 pending 并触发训练', async () => {
      const repo = makeRepo();
      repo.findOne.mockResolvedValue(null);
      const voice = makeVoice('clone');
      const service = new PersonaService(repo as any, voice);
      const trainSpy = jest
        .spyOn(service as any, 'trainVoice')
        .mockResolvedValue(undefined);

      const persona = await service.create('u1', '/a.jpg', '/v.mp3');

      expect(persona.status).toBe('pending');
      expect(trainSpy).toHaveBeenCalled();
    });
  });

  describe('trainVoice', () => {
    it('preset 模式：不下载样本、不请求训练接口，直接用预置音色', async () => {
      const repo = makeRepo();
      const voice = makeVoice('preset', 'zh_female_cancan_uranus_bigtts');
      const fetchSpy = jest.spyOn(global, 'fetch');
      const service = new PersonaService(repo as any, voice);

      await (service as any).trainVoice({ id: 'p1', voiceSampleUrl: 'http://x/v.mp3' });

      expect(voice.train).toHaveBeenCalledWith('');
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(repo.update).toHaveBeenCalledWith(
        'p1',
        expect.objectContaining({
          status: 'ready',
          speakerId: 'zh_female_cancan_uranus_bigtts',
        }),
      );
    });

    it('clone 模式：下载样本并以 custom_zh_ 前缀 id 提交训练', async () => {
      const repo = makeRepo();
      const voice = makeVoice('clone', 'custom_zh_rr_deadbeef');
      jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        arrayBuffer: async () => Buffer.from('wav-bytes'),
      } as any);
      const service = new PersonaService(repo as any, voice);

      await (service as any).trainVoice({ id: 'p1', voiceSampleUrl: 'http://x/a.wav' });

      expect(voice.train).toHaveBeenCalledWith(
        expect.stringMatching(/^custom_zh_rr_[0-9a-f]{12}$/),
        expect.any(Buffer),
        'wav',
      );
      expect(repo.update).toHaveBeenCalledWith(
        'p1',
        expect.objectContaining({ status: 'ready', speakerId: 'custom_zh_rr_deadbeef' }),
      );
    });

    it('训练失败时置 failed 并记录错误', async () => {
      const repo = makeRepo();
      const voice = makeVoice('preset');
      (voice.train as jest.Mock).mockRejectedValue(new Error('boom'));
      const service = new PersonaService(repo as any, voice);

      await expect(
        (service as any).trainVoice({ id: 'p1', voiceSampleUrl: 'http://x/v.mp3' }),
      ).rejects.toThrow('boom');
      expect(repo.update).toHaveBeenCalledWith(
        'p1',
        expect.objectContaining({ status: 'failed', error: 'boom' }),
      );
    });
  });
});
