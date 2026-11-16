import { Logger } from '@nestjs/common';
import { RenderProvider, RenderQueryResult } from './render.provider';

export interface MiniMaxRenderConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  resolution: string;
  duration: number;
  ratio: string;
  prompt: string;
}

/**
 * MiniMax H3 视频生成（异步任务）。
 * 数字人口型场景走「多模态参考生视频（r2va）」：参考图（形象）+ 参考音频（合成的语音）。
 * 注意：r2va 与首/尾帧（i2va）互斥，二者不可混用。
 */
/** MiniMax 视频时长允许范围（秒）。 */
const MIN_DURATION = 4;
const MAX_DURATION = 15;

export class MiniMaxRenderProvider implements RenderProvider {
  private readonly logger = new Logger(MiniMaxRenderProvider.name);

  constructor(
    private readonly config: MiniMaxRenderConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private authHeaders(extra: Record<string, string> = {}): Record<string, string> {
    return { Authorization: `Bearer ${this.config.apiKey}`, ...extra };
  }

  async submit(imageUrl: string, audioUrl: string, durationSeconds?: number): Promise<string> {
    // MiniMax 不会自动跟随参考音频长度，时长必须显式给出并与语音对齐，否则长回答会被截断。
    const duration = Math.min(MAX_DURATION, Math.max(MIN_DURATION, durationSeconds ?? this.config.duration));
    const res = await this.fetchImpl(`${this.config.baseUrl}/v2/video_generation`, {
      method: 'POST',
      headers: this.authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        model: this.config.model,
        content: [
          { type: 'text', text: this.config.prompt },
          { type: 'image_url', image_url: { url: imageUrl }, role: 'reference_image' },
          { type: 'audio_url', audio_url: { url: audioUrl }, role: 'reference_audio' },
        ],
        resolution: this.config.resolution,
        duration,
        ratio: this.config.ratio,
      }),
    });

    const json: any = await res.json();
    if (!res.ok || !json?.task_id) {
      this.logger.error(`视频生成提交失败: ${JSON.stringify(json).slice(0, 300)}`);
      const msg = json?.error?.message ?? json?.base_resp?.status_msg ?? res.status;
      throw new Error(`视频生成提交失败: ${msg}`);
    }
    return json.task_id as string;
  }

  async query(taskId: string): Promise<RenderQueryResult> {
    const res = await this.fetchImpl(`${this.config.baseUrl}/v2/query/video_generation/${taskId}`, {
      method: 'GET',
      headers: this.authHeaders(),
    });
    const json: any = await res.json();
    const status = json?.task?.status as string;

    if (status === 'succeeded') {
      return { status: 'done', videoUrl: json?.task?.content?.url ?? null };
    }
    if (status === 'failed' || status === 'cancelled') {
      return { status: 'failed', videoUrl: null };
    }
    return { status: status === 'queued' ? 'in_queue' : 'generating', videoUrl: null };
  }
}
