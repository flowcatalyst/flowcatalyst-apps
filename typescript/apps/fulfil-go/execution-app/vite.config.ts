import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import ui from '@nuxt/ui/vite';

/**
 * Dev proxy fronts the fulfil-go server (PORT 3200) so the app runs
 * same-origin in the browser — no CORS, and the server's dev fallback auth
 * works. Native builds talk to VITE_API_BASE_URL directly instead.
 */
const API_PROXY = {
  target: 'http://localhost:3200',
  changeOrigin: true,
  // '/jobs' is BOTH an SPA route and an API route: browser document
  // navigations (hard refresh on /jobs) must get index.html, while the
  // app's JSON fetches still proxy through. Bypass on the Accept header.
  bypass: (req: import('node:http').IncomingMessage) =>
    req.method === 'GET' && req.headers.accept?.includes('text/html') ? '/index.html' : undefined,
};

export default defineConfig({
  plugins: [
    vue(),
    // FlowCatalyst brand parity with pinpoint / web-kit: primary = the
    // fc-accent blue ramp ('brand' palette in src/assets/main.css), slate
    // neutrals — see apps/fulfil-go/docs/ui-guidelines.md.
    ui({ ui: { colors: { primary: 'brand', neutral: 'slate' } } }),
  ],
  optimizeDeps: {
    // Workspace packages ship raw SFC/TS source — must be compiled by this
    // app's pipeline, not prebundled.
    exclude: ['@fulfil-go/mobile-kit', '@fulfil-go/shared'],
  },
  server: {
    port: 5175,
    proxy: {
      '/auth': API_PROXY,
      '/jobs': API_PROXY,
      '/sse': API_PROXY,
      '/sync': API_PROXY,
      '/telemetry': API_PROXY,
      '/health': API_PROXY,
    },
  },
});
