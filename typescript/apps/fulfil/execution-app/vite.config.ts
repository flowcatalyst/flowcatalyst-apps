import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': resolve(import.meta.dirname, 'src'),
    },
  },
  // web-kit ships Vue SFC source (not a pre-built bundle); esbuild's dep
  // optimizer can't handle .vue, so keep it out of the optimize step.
  optimizeDeps: {
    exclude: ['@flowcatalyst-apps/web-kit'],
  },
});
