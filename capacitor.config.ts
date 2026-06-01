import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.growfx.com',
  appName: 'GrowFX',
  webDir: 'dist',
  server: {
    url: 'https://growfxtrade.com',
    cleartext: true
  }
};

export default config;
