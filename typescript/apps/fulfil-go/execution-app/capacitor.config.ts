import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'io.flowcatalyst.fulfilgo.execution',
  appName: 'FulfilGo Drive',
  webDir: 'dist',
  // Deep-link scheme for the OIDC callback: fulfilgo-exec://auth/callback
  // (registered in Info.plist / AndroidManifest during `cap add`, task 8).
};

export default config;
