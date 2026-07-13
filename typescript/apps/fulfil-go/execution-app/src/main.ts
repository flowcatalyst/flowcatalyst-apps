import { createApp } from 'vue';
import ui from '@nuxt/ui/vue-plugin';
import App from './App.vue';
import { router } from './router/index.js';
import { APP_CTX, createAppCtx } from './context.js';
import './assets/main.css';

async function bootstrap(): Promise<void> {
  const ctx = await createAppCtx();
  const app = createApp(App);
  app.provide(APP_CTX, ctx);
  app.use(router);
  app.use(ui);
  app.mount('#app');

  // Browser dev (dev-fallback auth) starts syncing immediately; native waits
  // for login (LoginPage calls startSync after the PKCE round trip).
  if (!ctx.isNative || (await ctx.session.isAuthenticated())) {
    void ctx.startSync();
  }

  // A driver shift survives an app restart — restore the identity so the
  // Work tab and Settings show the signed-in driver straight away.
  if (await ctx.driverSession.isAuthenticated()) {
    void ctx.startDriverShift().catch(() => {
      // Token stale/suspended — the next 401 refresh signs the driver out.
    });
  }
}

void bootstrap();
