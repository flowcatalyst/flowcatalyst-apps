import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'io.flowcatalyst.fulfilgo.picking',
  appName: 'FulfilGo Pick',
  webDir: 'dist',
  // Deep-link scheme for the OIDC callback: fulfilgo-pick://auth/callback
  // (registered in Info.plist / AndroidManifest during `cap add`, task 8).
};

export default config;
