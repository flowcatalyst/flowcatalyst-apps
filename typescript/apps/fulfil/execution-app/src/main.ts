import { createApp } from 'vue';
import { installWebKit } from '@flowcatalyst-apps/web-kit';

import App from './App.vue';

import 'primeicons/primeicons.css';
import '@flowcatalyst-apps/web-kit/styles.css';

const app = createApp(App);

installWebKit(app);

app.mount('#app');
