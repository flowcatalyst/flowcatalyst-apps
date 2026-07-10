import { createRouter, createWebHistory } from 'vue-router';
import FulfilmentsPage from '../pages/FulfilmentsPage.vue';
import GeneratorPage from '../pages/GeneratorPage.vue';
import PickersPage from '../pages/PickersPage.vue';
import DriversPage from '../pages/DriversPage.vue';
import StoresPage from '../pages/StoresPage.vue';

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/fulfilments' },
    // Fulfilment context
    { path: '/fulfilments', component: FulfilmentsPage, meta: { title: 'Fulfilments' } },
    { path: '/generator', component: GeneratorPage, meta: { title: 'Generator' } },
    // Picking context (owns its user management)
    { path: '/picking/pickers', component: PickersPage, meta: { title: 'Pickers' } },
    // Transport context (placeholder until the context is built)
    { path: '/transport/drivers', component: DriversPage, meta: { title: 'Drivers' } },
    // Base store registry
    { path: '/stores', component: StoresPage, meta: { title: 'Stores' } },
    // Old flat path — keep deep links working.
    { path: '/pickers', redirect: '/picking/pickers' },
  ],
});
