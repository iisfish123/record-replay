import { Logger } from '@nestjs/common';
import { SynthesizeResult, VoiceProvider } from './voice.provider';
import { transcodeToMp3 } from './sample-transcoder';

export interface MiniMaxVoiceConfig {
  apiKey: string;
  baseUrl: string;
  ttsModel: string;
}

const OK_STATUS = 0;

/** MiniMax 音色复刻接受的样本格式，其余（如真机录出的 webm/ogg）需先转码。 */
const ACCEPTED_SAMPLE_FORMATS = new Set(['mp3', 'm4a', 'wav']);

/**
 * MiniMax 音色快速复刻 + 语音合成。
 * 复刻按音色个数一次性计费（9.9 元/个），无模型存储费；复刻得到的音色为临时音色，
 * 7 天内未用于合成会被系统删除。
 * 复刻流程：上传样本（purpose=voice_clone）→ voice_clone 注册 voice_id。
 * 注意：voice_clone 的 text 为「试听合成」参数，会按字符计费，这里不传以规避额外费用。
 */
export class MiniMaxVoiceProvider implements VoiceProvider {
  readonly mode = 'clone' as const;
  private readonly logger = new Logger(MiniMaxVoiceProvider.name);

  constructor(
    private readonly config: MiniMaxVoiceConfig,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly transcode: (audio: Buffer) => Promise<Buffer> = transcodeToMp3,
  ) {}

  private authHeaders(extra: Record<string, string> = {}): Record<string, string> {
    return { Authorization: `Bearer ${this.config.apiKey}`, ...extra };
  }

  /** 上传样本音频，返回 MiniMax 的 file_id。 */
  private async uploadSample(audio: Buffer, format: string): Promise<number | string> {
    const form = new FormData();
    form.append('purpose', 'voice_clone');
    form.append('file', new Blob([new Uint8Array(audio)]), `sample.${format}`);

    const res = await this.fetchImpl(`${this.config.baseUrl}/v1/files/upload`, {
      method: 'POST',
      headers: this.authHeaders(),
      body: form,
    });
    const json: any = await res.json();
    const code = json?.base_resp?.status_code;
    if (code !== OK_STATUS) {
      this.logger.error(`音色样本上传失败: ${JSON.stringify(json).slice(0, 300)}`);
      throw new Error(`音色样本上传失败: ${code ?? res.status} ${json?.base_resp?.status_msg ?? ''}`.trim());
    }
    return json.file.file_id;
  }

  async train(speakerId: string, audio?: Buffer, format?: string): Promise<{ speakerId: string }> {
    if (!audio) throw new Error('音色训练需要提供样本音频');
    const sample = await this.normalizeSample(audio, format ?? 'mp3');
    const fileId = await this.uploadSample(sample.audio, sample.format);

    const res = await this.fetchImpl(`${this.config.baseUrl}/v1/voice_clone`, {
      method: 'POST',
      headers: this.authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ file_id: fileId, voice_id: speakerId }),
    });
    const json: any = await res.json();
    const code = json?.base_resp?.status_code;
    if (code !== OK_STATUS) {
      this.logger.error(`音色复刻失败: ${JSON.stringify(json).slice(0, 300)}`);
      throw new Error(`音色复刻失败: ${code ?? res.status} ${json?.base_resp?.status_msg ?? ''}`.trim());
    }
    return { speakerId };
  }

  /** 上游只接受 mp3/m4a/wav，其余格式（真机录出的 webm/ogg）先转 mp3。 */
  private async normalizeSample(
    audio: Buffer,
    format: string,
  ): Promise<{ audio: Buffer; format: string }> {
    const normalized = format.toLowerCase();
    if (ACCEPTED_SAMPLE_FORMATS.has(normalized)) return { audio, format: normalized };
    return { audio: await this.transcode(audio), format: 'mp3' };
  }

  async queryTrainStatus(_speakerId: string): Promise<'ready'> {
    // MiniMax 复刻为同步接口，请求返回成功即已就绪。
    return 'ready';
  }

  async synthesize(text: string, speakerId: string): Promise<SynthesizeResult> {
    const res = await this.fetchImpl(`${this.config.baseUrl}/v1/t2a_v2`, {
      method: 'POST',
      headers: this.authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        model: this.config.ttsModel,
        text,
        stream: false,
        voice_setting: { voice_id: speakerId, speed: 1, vol: 1, pitch: 0 },
        audio_setting: { sample_rate: 32000, bitrate: 128000, format: 'mp3', channel: 1 },
      }),
    });

    const json: any = await res.json();
    const code = json?.base_resp?.status_code;
    if (code !== OK_STATUS) {
      this.logger.error(`语音合成失败: ${JSON.stringify(json).slice(0, 300)}`);
      throw new Error(`语音合成失败: ${code ?? res.status} ${json?.base_resp?.status_msg ?? ''}`.trim());
    }

    const hex: string = json?.data?.audio ?? '';
    if (!hex) throw new Error('语音合成失败: 未返回音频数据');
    // 视频时长必须与语音实际长度对齐（MiniMax 不自动跟随音频），这里回传上游给出的毫秒时长。
    return { audio: Buffer.from(hex, 'hex'), durationMs: json?.extra_info?.audio_length ?? 0 };
  }
}
