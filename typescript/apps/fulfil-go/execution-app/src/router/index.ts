import { createRouter, createWebHistory } from 'vue-router';
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
    { path: '/settings', component: SettingsPage, meta: { title: 'Settings' } },
  ],
});
