import { signVolcRequest } from './volc-signer';

const AUDIT_ERRORS: Record<number, string> = {
  50411: '输入图片未通过内容审核',
  50511: '输出图片未通过内容审核',
  50412: '输入文本未通过内容审核',
  50512: '输出文本未通过内容审核',
  50413: '内容审核未通过',
};

export interface RenderProviderConfig {
  accessKeyId: string;
  accessKeySecret: string;
  reqKey: string;
}

export const RENDER_PROVIDER = Symbol('RENDER_PROVIDER');

export interface RenderQueryResult {
  status: 'in_queue' | 'generating' | 'done' | 'failed';
  videoUrl: string | null;
  /** 失败原因（MiniMax 返回的 error.message 等），仅 status='failed' 时可能有值。 */
  error?: string;
}

export interface RenderProvider {
  /**
   * @param durationSeconds 期望的视频时长（秒）。火山 OmniHuman 自动跟随音频长度，可忽略；
   *   MiniMax 必须显式指定，否则长回答会被截断。
   * @param answerText 要说的话。火山 OmniHuman 直接用参考音频的语音内容，可忽略；
   *   MiniMax H3 的参考音频只提供音色，对话内容必须由 prompt 里的 <d> 标签决定。
   */
  submit(imageUrl: string, audioUrl: string, durationSeconds?: number, answerText?: string): Promise<string>;
  query(taskId: string): Promise<RenderQueryResult>;
}

/**
 * 火山引擎即梦AI OmniHuman 2.0 数字人视频生成。
 * 提交：CVSync2AsyncSubmitTask；查询：CVSync2AsyncGetResult。均走 AK/SK v4 签名。
 */
export class OmniHumanRenderProvider implements RenderProvider {
  constructor(
    private readonly config: RenderProviderConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async call(action: string, bodyObj: Record<string, unknown>): Promise<any> {
    const signed = signVolcRequest(
      {
        accessKeyId: this.config.accessKeyId,
        accessKeySecret: this.config.accessKeySecret,
        query: { Action: action, Version: '2022-08-31' },
      },
      bodyObj,
    );
    const res = await this.fetchImpl(signed.url, {
      method: 'POST',
      headers: signed.headers,
      body: signed.body,
    });
    const json: any = await res.json();
    if (json?.code !== 10000) {
      const readable = AUDIT_ERRORS[json?.code];
      throw new Error(readable ?? `OmniHuman 调用失败(${json?.code}): ${json?.message}`);
    }
    return json.data;
  }

  async submit(imageUrl: string, audioUrl: string): Promise<string> {
    const data = await this.call('CVSync2AsyncSubmitTask', {
      req_key: this.config.reqKey,
      image_urls: [imageUrl],
      audio_url: audioUrl,
      enable_watermark: false,
    });
    return data.task_id as string;
  }

  async query(taskId: string): Promise<RenderQueryResult> {
    const data = await this.call('CVSync2AsyncGetResult', {
      req_key: this.config.reqKey,
      task_id: taskId,
    });
    const status = data.status as string;
    if (status === 'done') {
      return { status: 'done', videoUrl: (data.video_url as string) ?? null };
    }
    if (status === 'not_found' || status === 'expired') {
      return { status: 'failed', videoUrl: null };
    }
    return { status: status === 'in_queue' ? 'in_queue' : 'generating', videoUrl: null };
  }
}
