import { Module, Global } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CHAT_PROVIDER, DeepSeekChatProvider } from './chat/chat.provider';
import { VOICE_PROVIDER, PresetVoiceProvider, VolcanoVoiceProvider } from './voice/voice.provider';
import { MiniMaxVoiceProvider } from './voice/minimax-voice.provider';
import { RENDER_PROVIDER, OmniHumanRenderProvider } from './render/render.provider';
import { MiniMaxRenderProvider } from './render/minimax-render.provider';

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
      useFactory: (cfg: ConfigService) => {
        if (cfg.get<string>('voiceProvider') === 'minimax') {
          return new MiniMaxVoiceProvider({
            apiKey: cfg.get<string>('minimax.apiKey')!,
            baseUrl: cfg.get<string>('minimax.baseUrl')!,
            ttsModel: cfg.get<string>('minimax.ttsModel')!,
          });
        }
        const config = {
          appid: cfg.get<string>('volcVoice.appid')!,
          accessToken: cfg.get<string>('volcVoice.accessToken')!,
        };
        if (cfg.get<string>('volcVoice.mode') === 'preset') {
          return new PresetVoiceProvider(config, cfg.get<string>('volcVoice.presetSpeaker')!);
        }
        return new VolcanoVoiceProvider(config);
      },
    },
    {
      provide: RENDER_PROVIDER,
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => {
        if (cfg.get<string>('renderProvider') === 'minimax') {
          return new MiniMaxRenderProvider({
            apiKey: cfg.get<string>('minimax.apiKey')!,
            baseUrl: cfg.get<string>('minimax.baseUrl')!,
            model: cfg.get<string>('minimax.videoModel')!,
            resolution: cfg.get<string>('minimax.videoResolution')!,
            duration: cfg.get<number>('minimax.videoDuration')!,
            ratio: cfg.get<string>('minimax.videoRatio')!,
            prompt: cfg.get<string>('minimax.videoPrompt')!,
          });
        }
        return new OmniHumanRenderProvider({
          accessKeyId: cfg.get<string>('volcOmni.accessKeyId')!,
          accessKeySecret: cfg.get<string>('volcOmni.accessKeySecret')!,
          reqKey: cfg.get<string>('volcOmni.reqKey')!,
        });
      },
    },
  ],
  exports: [CHAT_PROVIDER, VOICE_PROVIDER, RENDER_PROVIDER],
})
export class ProvidersModule {}
