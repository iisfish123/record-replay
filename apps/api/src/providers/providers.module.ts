import { Module, Global } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CHAT_PROVIDER, DeepSeekChatProvider } from './chat/chat.provider';
import { VOICE_PROVIDER, VolcanoVoiceProvider } from './voice/voice.provider';
import { RENDER_PROVIDER, OmniHumanRenderProvider } from './render/render.provider';

@Global()
@Module({
  providers: [
    {
      provide: CHAT_PROVIDER,
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) =>
        new DeepSeekChatProvider(
          {
            apiKey: cfg.get<string>('deepseek.apiKey')!,
            baseUrl: cfg.get<string>('deepseek.baseUrl')!,
            model: cfg.get<string>('deepseek.model')!,
          },
          fetch,
          cfg.get<number>('answerMaxChars')!,
        ),
    },
    {
      provide: VOICE_PROVIDER,
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) =>
        new VolcanoVoiceProvider({
          appid: cfg.get<string>('volcVoice.appid')!,
          accessToken: cfg.get<string>('volcVoice.accessToken')!,
        }),
    },
    {
      provide: RENDER_PROVIDER,
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) =>
        new OmniHumanRenderProvider({
          accessKeyId: cfg.get<string>('volcOmni.accessKeyId')!,
          accessKeySecret: cfg.get<string>('volcOmni.accessKeySecret')!,
          reqKey: cfg.get<string>('volcOmni.reqKey')!,
        }),
    },
  ],
  exports: [CHAT_PROVIDER, VOICE_PROVIDER, RENDER_PROVIDER],
})
export class ProvidersModule {}
