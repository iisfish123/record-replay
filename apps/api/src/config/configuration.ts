export const DEFAULT_JWT_SECRET = 'dev-secret-change-me';

export interface AppConfig {
  port: number;
  publicBaseUrl: string;
  jwtSecret: string;
  jwtExpiresIn: string;
  mysql: { host: string; port: number; username: string; password: string; database: string };
  redis: { host: string; port: number };
  aliyun: { accessKeyId: string; accessKeySecret: string; signName: string; templateCode: string };
  deepseek: { apiKey: string; baseUrl: string; model: string };
  volcVoice: {
    appid: string;
    accessToken: string;
    cluster: string;
    mode: 'preset' | 'clone';
    presetSpeaker: string;
  };
  volcOmni: { accessKeyId: string; accessKeySecret: string; reqKey: string };
  minimax: {
    apiKey: string;
    baseUrl: string;
    ttsModel: string;
    videoModel: string;
    videoResolution: string;
    videoDuration: number;
    videoRatio: string;
    videoPrompt: string;
  };
  voiceProvider: 'volcano' | 'minimax';
  renderProvider: 'omnihuman' | 'minimax';
  answerMaxChars: number;
}

export default (): AppConfig => ({
  port: parseInt(process.env.PORT ?? '3000', 10),
  publicBaseUrl: process.env.PUBLIC_BASE_URL ?? 'http://127.0.0.1:3000',
  jwtSecret: process.env.JWT_SECRET ?? DEFAULT_JWT_SECRET,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '7d',
  mysql: {
    host: process.env.MYSQL_HOST ?? '127.0.0.1',
    port: parseInt(process.env.MYSQL_PORT ?? '3316', 10),
    username: process.env.MYSQL_USER ?? 'root',
    password: process.env.MYSQL_PASSWORD ?? 'recordreplay',
    database: process.env.MYSQL_DATABASE ?? 'record_replay',
  },
  redis: {
    host: process.env.REDIS_HOST ?? '127.0.0.1',
    port: parseInt(process.env.REDIS_PORT ?? '6389', 10),
  },
  aliyun: {
    accessKeyId: process.env.ALIYUN_ACCESS_KEY_ID ?? '',
    accessKeySecret: process.env.ALIYUN_ACCESS_KEY_SECRET ?? '',
    signName: process.env.ALIYUN_SMS_SIGN_NAME ?? '速通互联验证码',
    templateCode: process.env.ALIYUN_SMS_TEMPLATE_CODE ?? '100001',
  },
  deepseek: {
    apiKey: process.env.DEEPSEEK_API_KEY ?? '',
    baseUrl: process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com',
    model: process.env.DEEPSEEK_MODEL ?? 'deepseek-flash',
  },
  volcVoice: {
    appid: process.env.VOLC_TTS_APPID ?? '',
    accessToken: process.env.VOLC_TTS_ACCESS_TOKEN ?? '',
    cluster: process.env.VOLC_TTS_CLUSTER ?? 'volcano_icl',
    mode: (process.env.VOICE_MODE as 'preset' | 'clone') ?? 'preset',
    presetSpeaker: process.env.VOLC_PRESET_SPEAKER ?? 'zh_female_cancan_uranus_bigtts',
  },
  volcOmni: {
    accessKeyId: process.env.VOLC_ACCESS_KEY_ID ?? '',
    accessKeySecret: process.env.VOLC_ACCESS_KEY_SECRET ?? '',
    reqKey: process.env.VOLC_OMNI_REQ_KEY ?? 'realman_avatar_picture_omni20_cvtob',
  },
  minimax: {
    apiKey: process.env.MINIMAX_API_KEY ?? '',
    baseUrl: process.env.MINIMAX_BASE_URL ?? 'https://api.minimax.cn',
    ttsModel: process.env.MINIMAX_TTS_MODEL ?? 'speech-2.8-turbo',
    videoModel: process.env.MINIMAX_VIDEO_MODEL ?? 'MiniMax-H3-Lite',
    videoResolution: process.env.MINIMAX_VIDEO_RESOLUTION ?? '768P',
    videoDuration: parseInt(process.env.MINIMAX_VIDEO_DURATION ?? '6', 10),
    videoRatio: process.env.MINIMAX_VIDEO_RATIO ?? '9:16',
    videoPrompt: process.env.MINIMAX_VIDEO_PROMPT ?? 'The person is speaking naturally to the camera.',
  },
  voiceProvider: (process.env.VOICE_PROVIDER as 'volcano' | 'minimax') ?? 'minimax',
  renderProvider: (process.env.RENDER_PROVIDER as 'omnihuman' | 'minimax') ?? 'minimax',
  // MiniMax 参考音频单段上限 15 秒（约 4.5 字/秒），70 字会超出上限被上游拒绝。
  answerMaxChars: parseInt(process.env.ANSWER_MAX_CHARS ?? '60', 10),
});
