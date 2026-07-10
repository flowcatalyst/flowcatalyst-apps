import { createApp } from 'vue';
import ui from '@nuxt/ui/vue-plugin';
import App from './App.vue';
import { installAuthGuard, router } from './router/index.js';
import { APP_CTX, createAppCtx } from './context.js';
import './assets/main.css';

async function bootstrap(): Promise<void> {
  const ctx = createAppCtx();
  installAuthGuard(router, ctx);

  // Resume a live person session across reloads (shared station stays put).
  if (await ctx.session.isAuthenticated()) {
    await ctx.loadMe().catch(() => ctx.session.signOut());
  }

  const app = createApp(App);
  app.provide(APP_CTX, ctx);
  app.use(router);
  app.use(ui);
  app.mount('#app');
}

void bootstrap();
