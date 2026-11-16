import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { RenderTask } from './entities/render-task.entity';
import { PersonaService } from '../persona/persona.service';
import { Persona } from '../persona/entities/persona.entity';
import { STORAGE_ROOT, toPublicUrl } from '../media/storage.config';
import { CHAT_PROVIDER, ChatProvider } from '../providers/chat/chat.provider';
import { VOICE_PROVIDER, VoiceProvider } from '../providers/voice/voice.provider';
import { RENDER_PROVIDER, RenderProvider } from '../providers/render/render.provider';

const RENDER_POLL_INTERVAL_MS = 3000;
const RENDER_MAX_ROUNDS = 60;

@Injectable()
export class TaskService {
  private readonly logger = new Logger(TaskService.name);

  constructor(
    @InjectRepository(RenderTask) private readonly tasks: Repository<RenderTask>,
    private readonly personas: PersonaService,
    private readonly cfg: ConfigService,
    @Inject(CHAT_PROVIDER) private readonly chat: ChatProvider,
    @Inject(VOICE_PROVIDER) private readonly voice: VoiceProvider,
    @Inject(RENDER_PROVIDER) private readonly render: RenderProvider,
  ) {}

  async create(persona: Persona, question: string): Promise<RenderTask> {
    const task = await this.tasks.save(
      this.tasks.create({ personaId: persona.id, question, status: 'pending' }),
    );
    void this.process(task.id, persona).catch((err) => {
      this.logger.error(`任务 ${task.id} 失败: ${err.message}`);
    });
    return task;
  }

  find(id: string): Promise<RenderTask | null> {
    return this.tasks.findOne({ where: { id } });
  }

  private async process(taskId: string, persona: Persona): Promise<void> {
    try {
      const task = await this.tasks.findOne({ where: { id: taskId } });
      if (!task) return;

      // 1) 生成回答文本
      await this.tasks.update(taskId, { status: 'answering' });
      const answerText = await this.chat.answer(
        { avatarUrl: persona.avatarUrl, voiceSampleUrl: persona.voiceSampleUrl },
        task.question,
      );
      await this.tasks.update(taskId, { answerText });

      // 2) 用克隆音色合成语音
      await this.tasks.update(taskId, { status: 'tts' });
      if (!persona.speakerId) throw new Error('人格音色尚未就绪');
      const audio = await this.voice.synthesize(answerText, persona.speakerId);
      const audioUrl = await this.saveFile('audio', `${randomUUID()}.mp3`, audio);
      await this.tasks.update(taskId, { audioUrl });

      // 3) 提交口型视频任务
      await this.tasks.update(taskId, { status: 'rendering' });
      const remoteTaskId = await this.render.submit(persona.avatarUrl, audioUrl);

      // 4) 轮询并转存（远端 video_url 仅 1 小时有效）
      const videoUrl = await this.pollAndPersist(taskId, remoteTaskId);
      await this.tasks.update(taskId, { status: 'done', videoUrl, finishedAt: new Date() });
    } catch (err: any) {
      await this.tasks.update(taskId, {
        status: 'failed',
        error: String(err?.message ?? err),
        finishedAt: new Date(),
      });
      throw err;
    }
  }

  private async pollAndPersist(taskId: string, remoteTaskId: string): Promise<string> {
    for (let i = 0; i < RENDER_MAX_ROUNDS; i++) {
      const result = await this.render.query(remoteTaskId);
      if (result.status === 'failed') throw new Error('视频生成失败');
      if (result.status === 'done' && result.videoUrl) {
        const res = await fetch(result.videoUrl);
        if (!res.ok) throw new Error(`下载视频失败: ${res.status}`);
        const buf = Buffer.from(await res.arrayBuffer());
        await this.tasks.update(taskId, { remoteVideoUrl: result.videoUrl });
        return this.saveFile('videos', `${randomUUID()}.mp4`, buf);
      }
      await new Promise((r) => setTimeout(r, RENDER_POLL_INTERVAL_MS));
    }
    throw new Error('视频生成超时');
  }

  private async saveFile(kind: 'audio' | 'videos', name: string, buf: Buffer): Promise<string> {
    const dir = join(STORAGE_ROOT, kind);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, name), buf);
    return toPublicUrl(this.cfg.get<string>('publicBaseUrl')!, `${kind}/${name}`);
  }
}
