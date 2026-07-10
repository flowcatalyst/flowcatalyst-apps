import { createRouter, createWebHistory, type Router } from 'vue-router';
import PicksPage from '../pages/PicksPage.vue';
import PickDetailPage from '../pages/PickDetailPage.vue';
import LoginPage from '../pages/LoginPage.vue';
import SettingsPage from '../pages/SettingsPage.vue';
import type { AppCtx } from '../context.js';

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/picks' },
    { path: '/login', component: LoginPage, meta: { title: 'Sign in' } },
    { path: '/picks', component: PicksPage, meta: { title: 'Picks' } },
    { path: '/picks/:pickId', component: PickDetailPage, meta: { title: 'Pick' } },
    { path: '/settings', component: SettingsPage, meta: { title: 'Settings' } },
  ],
});

/**
 * Station guard: settings is always reachable (that's where the station gets
 * bound); everything else needs a configured station, and the work pages need
 * a live person session.
 */
export function installAuthGuard(target: Router, ctx: AppCtx): void {
  target.beforeEach(async (to) => {
    if (to.path === '/settings') return true;
    if (!ctx.station.configured()) return '/settings';
    const authed = await ctx.session.isAuthenticated();
    if (!authed && to.path !== '/login') return '/login';
    if (authed && to.path === '/login') return '/picks';
    return true;
  });
}
