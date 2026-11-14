import { Logger } from '@nestjs/common';
import { limitAnswer } from '../../task/answer-limiter';

export interface ChatProviderConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

export interface ChatPersonaContext {
  avatarUrl: string;
  voiceSampleUrl: string;
}

export const CHAT_PROVIDER = Symbol('CHAT_PROVIDER');

export interface ChatProvider {
  answer(persona: ChatPersonaContext, question: string): Promise<string>;
}

const SYSTEM_PROMPT = [
  '你是一个已经逝去的人，正在与思念你的家人对话。',
  '请用第一人称、口语化、温和的语气回应，像生前那样说话。',
  '不要提及你是 AI、模型或程序；不要反问我是否真的存在。',
  '回答要简短，像一个长辈当面说话那样，控制在 {MAX} 个字以内。',
].join('');

export class DeepSeekChatProvider implements ChatProvider {
  private readonly logger = new Logger(DeepSeekChatProvider.name);

  constructor(
    private readonly config: ChatProviderConfig,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly maxChars: number = 70,
  ) {}

  async answer(persona: ChatPersonaContext, question: string): Promise<string> {
    const system = SYSTEM_PROMPT.replace('{MAX}', String(this.maxChars));
    const res = await this.fetchImpl(`${this.config.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        model: this.config.model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: question },
        ],
        max_tokens: 256,
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      this.logger.error(`DeepSeek 调用失败 ${res.status}: ${text}`);
      throw new Error(`DeepSeek 调用失败: ${res.status}`);
    }
    const json: any = await res.json();
    const content: string = json?.choices?.[0]?.message?.content ?? '';
    return limitAnswer(content, this.maxChars);
  }
}
