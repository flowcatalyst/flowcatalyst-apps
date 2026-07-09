import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import ui from '@nuxt/ui/vite';

/** Desktop management app — dev proxy fronts the fulfil-go server (:3200). */
const API_PROXY = {
  target: 'http://localhost:3200',
  changeOrigin: true,
};

export default defineConfig({
  plugins: [
    vue(),
    // FlowCatalyst brand parity (see apps/fulfil-go/docs/ui-guidelines.md):
    // primary = the fc-accent blue ramp ('brand' palette in main.css).
    ui({ ui: { colors: { primary: 'brand', neutral: 'slate' } } }),
  ],
  optimizeDeps: {
    exclude: ['@fulfil-go/mobile-kit', '@fulfil-go/shared'],
  },
  server: {
    port: 5177,
    proxy: {
      '/clients': API_PROXY,
      '/auth': API_PROXY,
      '/health': API_PROXY,
    },
  },
});
