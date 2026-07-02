import { createApp } from 'vue';
import { createPinia } from 'pinia';
import { installWebKit } from '@flowcatalyst-apps/web-kit';

import App from './App.vue';
import router from './router';

// Side-effect: fix Leaflet's default marker icon URLs before any map renders.
import './lib/leaflet-icons';

import 'primeicons/primeicons.css';
import '@flowcatalyst-apps/web-kit/styles.css';

const app = createApp(App);

app.use(createPinia());
app.use(router);
installWebKit(app);

app.mount('#app');
