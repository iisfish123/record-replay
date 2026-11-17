import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { extname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { Persona } from './entities/persona.entity';
import { VOICE_PROVIDER, VoiceProvider } from '../providers/voice/voice.provider';

/** 火山复刻音色 custom_speaker_id 必须为字母数字下划线，形如 custom_zh_xxx。 */
function buildSpeakerId(): string {
  return `custom_zh_rr_${randomBytes(6).toString('hex')}`;
}

/** 新建亲人档案时必填的业务字段。 */
export type PersonaInput = Pick<Persona, 'name' | 'relation' | 'avatarUrl' | 'voiceSampleUrl'>;

/** 可在编辑时单独修改的字段。 */
export type PersonaPatch = Partial<PersonaInput>;

@Injectable()
export class PersonaService {
  private readonly logger = new Logger(PersonaService.name);

  constructor(
    @InjectRepository(Persona) private readonly repo: Repository<Persona>,
    @Inject(VOICE_PROVIDER) private readonly voice: VoiceProvider,
  ) {}

  async create(userId: string, input: PersonaInput): Promise<Persona> {
    if (this.voice.mode === 'clone') {
      // 复刻音色按「音色个数」一次性计费（火山 138 元/个，MiniMax 9.9 元/个）。同一用户复用已有音色，避免重复扣费。
      const reusable = await this.repo.findOne({
        where: { userId, status: 'ready' },
        // 同一用户可能有多条 ready 人格（每次复用都会新增一行），按时间倒序取最新的一条，避免命中历史脏数据。
        order: { createdAt: 'DESC' },
      });
      if (reusable?.speakerId) {
        return this.repo.save(
          this.repo.create({
            userId,
            ...input,
            status: 'ready',
            speakerId: reusable.speakerId,
          }),
        );
      }
      const inflight = await this.repo.findOne({ where: { userId, status: 'training' } });
      if (inflight) throw new ConflictException('音色正在训练中，请稍候再创建');
    }

    const persona = await this.repo.save(
      this.repo.create({ userId, ...input, status: 'pending' }),
    );
    void this.trainVoice(persona).catch((err) => {
      this.logger.error(`人格 ${persona.id} 音色训练失败: ${err.message}`);
    });
    return persona;
  }

  async findOwned(id: string, userId: string): Promise<Persona> {
    const persona = await this.repo.findOne({ where: { id } });
    if (!persona) throw new NotFoundException('人格不存在');
    if (persona.userId !== userId) throw new ForbiddenException('无权访问该人格');
    return persona;
  }

  /** 列出当前用户的所有人格，按创建时间倒序。 */
  async list(userId: string): Promise<Persona[]> {
    return this.repo.find({ where: { userId }, order: { createdAt: 'DESC' } });
  }

  /**
   * 修改亲人资料。昵称/关系/头像/语音样本均可单独更新，不重新训练音色——
   * 音色克隆按个数计费（MiniMax 9.9 元/个），同一用户复用已有 speakerId。
   */
  async update(id: string, userId: string, patch: PersonaPatch): Promise<Persona> {
    const persona = await this.findOwned(id, userId);
    if (patch.name !== undefined) persona.name = patch.name;
    if (patch.relation !== undefined) persona.relation = patch.relation;
    if (patch.avatarUrl) persona.avatarUrl = patch.avatarUrl;
    if (patch.voiceSampleUrl) persona.voiceSampleUrl = patch.voiceSampleUrl;
    return this.repo.save(persona);
  }

  async remove(id: string, userId: string): Promise<void> {
    const persona = await this.findOwned(id, userId);
    await this.repo.remove(persona);
  }

  async updateStatus(id: string, status: Persona['status'], patch: Partial<Persona> = {}): Promise<void> {
    await this.repo.update(id, { status, ...patch });
  }

  /** 异步训练克隆音色：下载样本音频 → 提交训练 → 置 ready/failed。创建接口立即返回 pending，训练在后台完成。 */
  private async trainVoice(persona: Persona): Promise<void> {
    await this.updateStatus(persona.id, 'training');
    try {
      let speakerId: string;
      if (this.voice.mode === 'preset') {
        // 预置音色无需样本与训练，直接落到 ready。
        ({ speakerId } = await this.voice.train(''));
      } else {
        const res = await fetch(persona.voiceSampleUrl);
        if (!res.ok) throw new Error(`下载音色样本失败: ${res.status}`);
        const audio = Buffer.from(await res.arrayBuffer());
        const format = extname(persona.voiceSampleUrl.split('?')[0]).slice(1) || 'mp3';
        ({ speakerId } = await this.voice.train(buildSpeakerId(), audio, format));
      }
      await this.updateStatus(persona.id, 'ready', { speakerId });
    } catch (err: any) {
      await this.updateStatus(persona.id, 'failed', { error: String(err?.message ?? err) });
      throw err;
    }
  }
}
