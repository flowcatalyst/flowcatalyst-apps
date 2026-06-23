import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import Components from 'unplugin-vue-components/vite';
import { PrimeVueResolver } from '@primevue/auto-import-resolver';
import { fileURLToPath, URL } from 'node:url';

// Backend target the dev server proxies /api /auth /bff to. Defaults to :3100
// so it doesn't collide with fc-dev on :3000. Must match the server's PORT
// (see apps/pinpoint/server/.env). Override with PINPOINT_DEV_API_TARGET.
const apiTarget = process.env['PINPOINT_DEV_API_TARGET'] ?? 'http://localhost:3100';

export default defineConfig({
  plugins: [
    vue(),
    Components({
      resolvers: [PrimeVueResolver()],
    }),
  ],
  appType: 'spa',
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  // web-kit ships Vue SFC source (not a pre-built bundle); esbuild's dep
  // optimizer can't handle .vue, so keep it out of the optimize step.
  optimizeDeps: {
    exclude: ['@flowcatalyst-apps/web-kit'],
  },
  server: {
    port: 5173,
    proxy: {
      '/bff': {
        target: apiTarget,
        changeOrigin: true,
      },
      '/api': {
        target: apiTarget,
        changeOrigin: true,
      },
      '/auth': {
        target: apiTarget,
        changeOrigin: true,
      },
    },
  },
});
