import { createApp } from 'vue';
import { createPinia } from 'pinia';
import { installWebKit } from '@flowcatalyst-apps/web-kit';

import App from './App.vue';
import router from './router';

import 'primeicons/primeicons.css';
import '@flowcatalyst-apps/web-kit/styles.css';

const app = createApp(App);

app.use(createPinia());
app.use(router);
installWebKit(app);

app.mount('#app');
