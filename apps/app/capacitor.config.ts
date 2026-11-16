import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.recordreplay.app',
  appName: '怀念亲人',
  webDir: 'dist',
  bundledWebRuntime: false,
  android: {
    allowMixedContent: true,
    backgroundColor: '#f6f6f8',
  },
  server: {
    androidScheme: 'http',
    cleartext: true,
  },
};

export default config;
