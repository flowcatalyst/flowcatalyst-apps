import { createRouter, createWebHistory } from 'vue-router';
import FlightboardPage from '../pages/FlightboardPage.vue';
import FulfilmentsPage from '../pages/FulfilmentsPage.vue';
import GeneratorPage from '../pages/GeneratorPage.vue';
import PickersPage from '../pages/PickersPage.vue';
import PicksAdminPage from '../pages/PicksAdminPage.vue';
import DriversPage from '../pages/DriversPage.vue';
import StoresPage from '../pages/StoresPage.vue';
import PrintersPage from '../pages/PrintersPage.vue';
import StoreProfilesPage from '../pages/StoreProfilesPage.vue';
import VehicleMapPage from '../pages/VehicleMapPage.vue';
import LoginCallbackPage from '../pages/LoginCallbackPage.vue';
import TransportOrdersPage from '../pages/TransportOrdersPage.vue';
import DepotsPage from '../pages/DepotsPage.vue';

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/flightboard' },
    // OIDC redirect landing (NOT under /auth — that prefix is dev-proxied).
    { path: '/login/callback', component: LoginCallbackPage, meta: { title: 'Signing in…' } },
    // Operations — the controller's live view
    { path: '/flightboard', component: FlightboardPage, meta: { title: 'Flightboard' } },
    // Fulfilment context
    { path: '/fulfilments', component: FulfilmentsPage, meta: { title: 'Fulfilments' } },
    { path: '/generator', component: GeneratorPage, meta: { title: 'Generator' } },
    // Picking context (owns its user management + operational views + config)
    { path: '/picking/pickers', component: PickersPage, meta: { title: 'Pickers' } },
    {
      path: '/picking/picks/requested',
      component: PicksAdminPage,
      meta: { title: 'Requested picks', pickStatus: 'requested' },
    },
    {
      path: '/picking/picks/active',
      component: PicksAdminPage,
      meta: { title: 'Active picks', pickStatus: 'claimed' },
    },
    {
      path: '/picking/store-profiles',
      component: StoreProfilesPage,
      props: { domain: 'pick' },
      meta: { title: 'Pick profiles' },
    },
    // Transport context (owns its user management + config)
    {
      path: '/transport/orders',
      component: TransportOrdersPage,
      meta: { title: 'Transport orders' },
    },
    { path: '/transport/drivers', component: DriversPage, meta: { title: 'Drivers' } },
    { path: '/transport/depots', component: DepotsPage, meta: { title: 'Depots' } },
    {
      path: '/transport/map',
      component: VehicleMapPage,
      meta: { title: 'Vehicle map' },
    },
    {
      path: '/transport/store-profiles',
      component: StoreProfilesPage,
      props: { domain: 'transport' },
      meta: { title: 'Transport profiles' },
    },
    // Base store registry
    { path: '/stores', component: StoresPage, meta: { title: 'Stores' } },
    { path: '/stores/printers', component: PrintersPage, meta: { title: 'Printers' } },
    // Old paths — keep deep links working.
    { path: '/pickers', redirect: '/picking/pickers' },
    { path: '/settings/store-profiles', redirect: '/picking/store-profiles' },
  ],
});
