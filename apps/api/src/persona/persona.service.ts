import { ForbiddenException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { extname } from 'node:path';
import { Persona } from './entities/persona.entity';
import { VOICE_PROVIDER, VoiceProvider } from '../providers/voice/voice.provider';

@Injectable()
export class PersonaService {
  private readonly logger = new Logger(PersonaService.name);

  constructor(
    @InjectRepository(Persona) private readonly repo: Repository<Persona>,
    @Inject(VOICE_PROVIDER) private readonly voice: VoiceProvider,
  ) {}

  async create(userId: string, avatarUrl: string, voiceSampleUrl: string): Promise<Persona> {
    const persona = await this.repo.save(
      this.repo.create({ userId, avatarUrl, voiceSampleUrl, status: 'pending' }),
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

  async updateStatus(id: string, status: Persona['status'], patch: Partial<Persona> = {}): Promise<void> {
    await this.repo.update(id, { status, ...patch });
  }

  /** 异步训练克隆音色：下载样本音频 → 提交训练 → 置 ready/failed。创建接口立即返回 pending，训练在后台完成。 */
  private async trainVoice(persona: Persona): Promise<void> {
    await this.updateStatus(persona.id, 'training');
    try {
      const res = await fetch(persona.voiceSampleUrl);
      if (!res.ok) throw new Error(`下载音色样本失败: ${res.status}`);
      const audio = Buffer.from(await res.arrayBuffer());
      const format = extname(persona.voiceSampleUrl.split('?')[0]).slice(1) || 'mp3';
      const { speakerId } = await this.voice.train(persona.id, audio, format);
      await this.updateStatus(persona.id, 'ready', { speakerId });
    } catch (err: any) {
      await this.updateStatus(persona.id, 'failed', { error: String(err?.message ?? err) });
      throw err;
    }
  }
}
