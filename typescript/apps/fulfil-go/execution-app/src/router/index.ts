import { createRouter, createWebHistory } from 'vue-router';
import JobsPage from '../pages/JobsPage.vue';
import JobDetailPage from '../pages/JobDetailPage.vue';
import LoginPage from '../pages/LoginPage.vue';
import DriverLoginPage from '../pages/DriverLoginPage.vue';
import OffersPage from '../pages/OffersPage.vue';
import SettingsPage from '../pages/SettingsPage.vue';

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/offers' },
    { path: '/login', component: LoginPage, meta: { title: 'Sign in' } },
    { path: '/driver-login', component: DriverLoginPage, meta: { title: 'Driver sign in' } },
    { path: '/offers', component: OffersPage, meta: { title: 'Find work' } },
    { path: '/jobs', component: JobsPage, meta: { title: 'My jobs' } },
    { path: '/jobs/:jobId', component: JobDetailPage, meta: { title: 'Job' } },
    { path: '/settings', component: SettingsPage, meta: { title: 'Settings' } },
  ],
});
