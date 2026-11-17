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

/** 素材上传到 MiniMax 文件服务的 purpose，上传后用 mm_file://{file_id} 引用。 */
const UPLOAD_PURPOSE = 'video_generation_input';

export class MiniMaxRenderProvider implements RenderProvider {
  private readonly logger = new Logger(MiniMaxRenderProvider.name);

  constructor(
    private readonly config: MiniMaxRenderConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private authHeaders(extra: Record<string, string> = {}): Record<string, string> {
    return { Authorization: `Bearer ${this.config.apiKey}`, ...extra };
  }

  /**
   * 下载素材并上传到 MiniMax 文件服务，返回 mm_file://{file_id}。
   * 这样 MiniMax 不需要再回头拉我们的公网 URL（frp 隧道慢/不稳定），直接从它自己的存储读。
   */
  private async uploadToMiniMax(url: string, filename: string): Promise<string> {
    const downloadRes = await this.fetchImpl(url);
    if (!downloadRes.ok) {
      throw new Error(`下载素材失败: ${url} -> HTTP ${downloadRes.status}`);
    }
    const arrayBuffer = await downloadRes.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const form = new FormData();
    form.append('purpose', UPLOAD_PURPOSE);
    form.append('file', new Blob([buffer]), filename);

    const res = await this.fetchImpl(`${this.config.baseUrl}/v1/files/upload`, {
      method: 'POST',
      headers: this.authHeaders(),
      body: form,
    });
    const json: any = await res.json();
    const fileId = json?.file?.file_id;
    if (!res.ok || !fileId) {
      const msg = json?.base_resp?.status_msg ?? json?.error?.message ?? res.statusText;
      throw new Error(`上传素材到 MiniMax 失败: ${msg}`);
    }
    return `mm_file://${fileId}`;
  }

  async submit(
    imageUrl: string,
    audioUrl: string,
    durationSeconds?: number,
    answerText?: string,
  ): Promise<string> {
    // MiniMax 不会自动跟随参考音频长度，时长必须显式给出并与语音对齐，否则长回答会被截断。
    const duration = Math.min(MAX_DURATION, Math.max(MIN_DURATION, durationSeconds ?? this.config.duration));

    // r2va 模式下，参考音频只提供音色，对话内容必须由 prompt 里的 <d> 标签决定。
    // 官方要求：<d> 内只放语言标签 + 要说的话，其余描述用英文。
    const prompt = answerText
      ? `${this.config.prompt} <d>[Chinese] ${answerText}</d>`
      : this.config.prompt;

    // 先把素材上传到 MiniMax 自己的文件服务，避免它下载我们的 frp URL 超时。
    const [imageMmUrl, audioMmUrl] = await Promise.all([
      this.uploadToMiniMax(imageUrl, `avatar-${Date.now()}.jpg`),
      this.uploadToMiniMax(audioUrl, `audio-${Date.now()}.mp3`),
    ]);

    const res = await this.fetchImpl(`${this.config.baseUrl}/v2/video_generation`, {
      method: 'POST',
      headers: this.authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        model: this.config.model,
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: imageMmUrl }, role: 'reference_image' },
          { type: 'audio_url', audio_url: { url: audioMmUrl }, role: 'reference_audio' },
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
      // 把 MiniMax 的失败原因带出来，否则只知道失败不知道为什么
      const reason = json?.task?.error?.message ?? json?.base_resp?.status_msg ?? status;
      this.logger.error(`视频生成任务 ${taskId} 失败: ${reason}`);
      return { status: 'failed', videoUrl: null, error: reason };
    }
    return { status: status === 'queued' ? 'in_queue' : 'generating', videoUrl: null };
  }
}
