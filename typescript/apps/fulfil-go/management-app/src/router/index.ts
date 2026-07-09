import { createRouter, createWebHistory } from 'vue-router';
import FulfilmentsPage from '../pages/FulfilmentsPage.vue';
import GeneratorPage from '../pages/GeneratorPage.vue';

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/fulfilments' },
    { path: '/fulfilments', component: FulfilmentsPage, meta: { title: 'Fulfilments' } },
    { path: '/generator', component: GeneratorPage, meta: { title: 'Generator' } },
  ],
});
