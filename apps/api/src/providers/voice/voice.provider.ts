import { Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';

export interface VoiceProviderConfig {
  appid: string;
  accessToken: string;
  baseUrl?: string;
  ttsResourceId?: string;
}

export const VOICE_PROVIDER = Symbol('VOICE_PROVIDER');

export interface VoiceProvider {
  train(speakerId: string, audio: Buffer, format: string): Promise<{ speakerId: string }>;
  queryTrainStatus(speakerId: string): Promise<'training' | 'ready' | 'failed'>;
  synthesize(text: string, speakerId: string): Promise<Buffer>;
}

const DEFAULT_BASE_URL = 'https://openspeech.bytedance.com';
const DEFAULT_TTS_RESOURCE_ID = 'seed-icl-2.0';
/** 后付费音色：speaker_id 固定为该占位值，真实代号放在 custom_speaker_id */
const CUSTOM_SPEAKER_PLACEHOLDER = 'custom_speaker_id';
const TRAIN_STATUS_SUCCESS = [2, 4];
const TRAIN_STATUS_FAILED = 3;
const TTS_STREAM_END = 20000000;

export class VolcanoVoiceProvider implements VoiceProvider {
  private readonly logger = new Logger(VolcanoVoiceProvider.name);

  constructor(
    private readonly config: VoiceProviderConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private get baseUrl(): string {
    return this.config.baseUrl ?? DEFAULT_BASE_URL;
  }

  /** 训练 / 状态查询：服务端固定映射到 volc.megatts.timbre，且只认旧版控制台鉴权（新版 X-Api-Key 实测 403）。 */
  private trainAuthHeaders(): Record<string, string> {
    return {
      'X-Api-App-Key': this.config.appid,
      'X-Api-Access-Key': this.config.accessToken,
      'X-Api-Request-Id': randomUUID(),
      'Content-Type': 'application/json',
    };
  }

  async train(speakerId: string, audio: Buffer, format: string): Promise<{ speakerId: string }> {
    const res = await this.fetchImpl(`${this.baseUrl}/api/v3/tts/voice_clone`, {
      method: 'POST',
      headers: this.trainAuthHeaders(),
      body: JSON.stringify({
        speaker_id: CUSTOM_SPEAKER_PLACEHOLDER,
        custom_speaker_id: speakerId,
        audio: { data: audio.toString('base64'), format },
        language: 0,
      }),
    });

    const json: any = await res.json();
    if (!res.ok) {
      this.logger.error(`音色训练提交失败 ${res.status}: ${JSON.stringify(json)}`);
      throw new Error(`音色训练提交失败: ${json?.code ?? res.status} ${json?.message ?? ''}`.trim());
    }
    if (json?.status === TRAIN_STATUS_FAILED) {
      throw new Error(`音色训练失败: ${JSON.stringify(json)}`);
    }
    return { speakerId };
  }

  async queryTrainStatus(speakerId: string): Promise<'training' | 'ready' | 'failed'> {
    const res = await this.fetchImpl(`${this.baseUrl}/api/v3/tts/get_voice`, {
      method: 'POST',
      headers: this.trainAuthHeaders(),
      body: JSON.stringify({
        speaker_id: CUSTOM_SPEAKER_PLACEHOLDER,
        custom_speaker_id: speakerId,
      }),
    });

    const json: any = await res.json();
    if (!res.ok) {
      this.logger.error(`音色状态查询失败 ${res.status}: ${JSON.stringify(json)}`);
      throw new Error(`音色状态查询失败: ${json?.code ?? res.status} ${json?.message ?? ''}`.trim());
    }
    if (TRAIN_STATUS_SUCCESS.includes(json?.status)) return 'ready';
    if (json?.status === TRAIN_STATUS_FAILED) return 'failed';
    return 'training';
  }

  async synthesize(text: string, speakerId: string): Promise<Buffer> {
    const res = await this.fetchImpl(`${this.baseUrl}/api/v3/tts/unidirectional`, {
      method: 'POST',
      headers: {
        'X-Api-App-Id': this.config.appid,
        'X-Api-Access-Key': this.config.accessToken,
        'X-Api-Resource-Id': this.config.ttsResourceId ?? DEFAULT_TTS_RESOURCE_ID,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        user: { uid: 'record-replay' },
        req_params: {
          text,
          speaker: speakerId,
          audio_params: { format: 'mp3', sample_rate: 24000 },
        },
      }),
    });

    if (!res.ok) {
      const detail = await res.text();
      this.logger.error(`语音合成失败 ${res.status}: ${detail.slice(0, 300)}`);
      throw new Error(`语音合成失败: ${res.status}`);
    }

    const raw = await res.text();
    const chunks: Buffer[] = [];
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let frame: any;
      try {
        frame = JSON.parse(trimmed);
      } catch {
        continue;
      }
      if (frame?.data) chunks.push(Buffer.from(frame.data, 'base64'));
      if (frame?.code !== 0 && frame?.code !== TTS_STREAM_END) {
        this.logger.error(`语音合成返回错误码: ${JSON.stringify(frame).slice(0, 300)}`);
        throw new Error(`语音合成失败: ${frame.code} ${frame.message ?? ''}`.trim());
      }
    }

    const audio = Buffer.concat(chunks);
    if (!audio.length) {
      throw new Error('语音合成失败: 未返回音频数据');
    }
    return audio;
  }
}
