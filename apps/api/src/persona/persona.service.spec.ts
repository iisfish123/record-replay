import { ConflictException } from '@nestjs/common';
import { PersonaService } from './persona.service';
import type { VoiceProvider } from '../providers/voice/voice.provider';

const INPUT = { name: '爸爸', relation: '父亲', avatarUrl: '/a.jpg', voiceSampleUrl: '/v.mp3' };

function makeRepo() {
  return {
    findOne: jest.fn(),
    find: jest.fn(),
    create: jest.fn((v: any) => v),
    save: jest.fn(async (v: any) => ({ id: v.id ?? 'p-new', ...v })),
    update: jest.fn(async () => undefined),
    remove: jest.fn(async (v: any) => v),
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

      const persona = await service.create('u1', INPUT);

      expect(persona.speakerId).toBe('custom_zh_old');
      expect(persona.status).toBe('ready');
      expect(persona.name).toBe('爸爸');
      expect(persona.relation).toBe('父亲');
      expect(voice.train).not.toHaveBeenCalled();
    });

    it('复用查询按 createdAt 倒序，保证命中最新可用音色', async () => {
      const repo = makeRepo();
      repo.findOne.mockResolvedValue({
        id: 'p-old',
        userId: 'u1',
        status: 'ready',
        speakerId: 'custom_zh_old',
      });
      const voice = makeVoice('clone');
      const service = new PersonaService(repo as any, voice);

      await service.create('u1', INPUT);

      expect(repo.findOne).toHaveBeenCalledWith({
        where: { userId: 'u1', status: 'ready' },
        order: { createdAt: 'DESC' },
      });
    });

    it('已有音色正在训练中时拒绝新建，避免并发重复扣费', async () => {
      const repo = makeRepo();
      repo.findOne
        .mockResolvedValueOnce(null) // 无可用音色
        .mockResolvedValueOnce({ id: 'p-inflight', status: 'training' }); // 有在途训练
      const voice = makeVoice('clone');
      const service = new PersonaService(repo as any, voice);

      await expect(service.create('u1', INPUT)).rejects.toBeInstanceOf(
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

      const persona = await service.create('u1', INPUT);

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

  describe('list / update / remove', () => {
    it('list 按 createdAt 倒序返回当前用户所有人格', async () => {
      const repo = makeRepo();
      repo.find.mockResolvedValue([{ id: 'p1' }, { id: 'p2' }]);
      const service = new PersonaService(repo as any, makeVoice('clone'));

      const list = await service.list('u1');

      expect(repo.find).toHaveBeenCalledWith({
        where: { userId: 'u1' },
        order: { createdAt: 'DESC' },
      });
      expect(list).toHaveLength(2);
    });

    it('update 仅更新头像/语音字段，不重新训练音色', async () => {
      const repo = makeRepo();
      repo.findOne.mockResolvedValue({
        id: 'p1',
        userId: 'u1',
        avatarUrl: '/old.jpg',
        voiceSampleUrl: '/old.mp3',
      });
      const voice = makeVoice('clone');
      const service = new PersonaService(repo as any, voice);

      const persona = await service.update('p1', 'u1', { avatarUrl: '/new.jpg' });

      expect(persona.avatarUrl).toBe('/new.jpg');
      expect(persona.voiceSampleUrl).toBe('/old.mp3');
      expect(repo.save).toHaveBeenCalled();
      expect(voice.train).not.toHaveBeenCalled();
    });

    it('update 可单独修改昵称与关系，且不影响其他字段', async () => {
      const repo = makeRepo();
      repo.findOne.mockResolvedValue({
        id: 'p1',
        userId: 'u1',
        name: '爸爸',
        relation: '父亲',
        avatarUrl: '/old.jpg',
        voiceSampleUrl: '/old.mp3',
      });
      const service = new PersonaService(repo as any, makeVoice('clone'));

      const persona = await service.update('p1', 'u1', { name: '老爸', relation: '爷爷' });

      expect(persona.name).toBe('老爸');
      expect(persona.relation).toBe('爷爷');
      expect(persona.avatarUrl).toBe('/old.jpg');
      expect(persona.voiceSampleUrl).toBe('/old.mp3');
    });

    it('update 非本人人格抛 Forbidden', async () => {
      const repo = makeRepo();
      repo.findOne.mockResolvedValue({ id: 'p1', userId: 'u-other' });
      const service = new PersonaService(repo as any, makeVoice('clone'));

      await expect(service.update('p1', 'u1', { avatarUrl: '/x.jpg' })).rejects.toThrow('无权访问');
    });

    it('remove 删除本人格', async () => {
      const repo = makeRepo();
      repo.findOne.mockResolvedValue({ id: 'p1', userId: 'u1' });
      const service = new PersonaService(repo as any, makeVoice('clone'));

      await service.remove('p1', 'u1');

      expect(repo.remove).toHaveBeenCalledWith(expect.objectContaining({ id: 'p1' }));
    });
  });
});
