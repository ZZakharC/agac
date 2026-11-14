import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.zzakharc.agac',
  appName: 'Chess Analyzer',
  webDir: 'dist',
  server: {
    // origin страницы будет http://localhost, поэтому ws:// не блокируется как mixed content
    androidScheme: 'http',
    cleartext: true,
  },
};

export default config;