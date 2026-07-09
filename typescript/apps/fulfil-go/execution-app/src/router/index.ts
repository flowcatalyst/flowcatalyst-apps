import { createRouter, createWebHistory } from 'vue-router';
import JobsPage from '../pages/JobsPage.vue';
import JobDetailPage from '../pages/JobDetailPage.vue';
import LoginPage from '../pages/LoginPage.vue';
import SettingsPage from '../pages/SettingsPage.vue';

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/jobs' },
    { path: '/login', component: LoginPage, meta: { title: 'Sign in' } },
    { path: '/jobs', component: JobsPage, meta: { title: 'My jobs' } },
    { path: '/jobs/:jobId', component: JobDetailPage, meta: { title: 'Job' } },
    { path: '/settings', component: SettingsPage, meta: { title: 'Settings' } },
  ],
});
