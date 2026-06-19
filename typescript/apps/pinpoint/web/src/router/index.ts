import { createRouter, createWebHistory } from 'vue-router';
import { authGuard } from './guards';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      component: () => import('@/layouts/MainLayout.vue'),
      beforeEnter: authGuard,
      children: [
        {
          path: '',
          redirect: '/dashboard',
        },
        {
          path: 'dashboard',
          name: 'dashboard',
          component: () => import('@/pages/DashboardPage.vue'),
        },
        // Clients
        {
          path: 'clients',
          name: 'clients',
          component: () => import('@/pages/clients/ClientListPage.vue'),
        },
        {
          path: 'clients/new',
          name: 'client-create',
          component: () => import('@/pages/clients/ClientCreatePage.vue'),
        },
        {
          path: 'clients/:id',
          name: 'client-detail',
          component: () => import('@/pages/clients/ClientDetailPage.vue'),
        },
        // Locations
        {
          path: 'locations',
          name: 'locations',
          component: () => import('@/pages/locations/LocationListPage.vue'),
        },
        {
          path: 'locations/new',
          name: 'location-create',
          component: () => import('@/pages/locations/LocationCreatePage.vue'),
        },
        {
          path: 'locations/:id',
          name: 'location-detail',
          component: () => import('@/pages/locations/LocationDetailPage.vue'),
        },
        // Master Locations
        {
          path: 'master-locations',
          name: 'master-locations',
          component: () => import('@/pages/master-locations/MasterLocationListPage.vue'),
        },
        {
          path: 'master-locations/unvalidated',
          name: 'unvalidated-master-locations',
          component: () => import('@/pages/master-locations/UnvalidatedMasterLocationsPage.vue'),
        },
        {
          path: 'master-locations/:id',
          name: 'master-location-detail',
          component: () => import('@/pages/master-locations/MasterLocationDetailPage.vue'),
        },
        // Tools
        {
          path: 'spatial-lookup',
          name: 'spatial-lookup',
          component: () => import('@/pages/tools/SpatialLookupPage.vue'),
        },
        // Layers
        {
          path: 'layers',
          name: 'layers',
          component: () => import('@/pages/layers/LayerListPage.vue'),
        },
        {
          path: 'layers/map',
          name: 'layer-map',
          component: () => import('@/pages/layers/LayerMapPage.vue'),
        },
        {
          path: 'layers/new',
          name: 'layer-create',
          component: () => import('@/pages/layers/LayerCreatePage.vue'),
        },
        {
          path: 'layers/:id',
          name: 'layer-detail',
          component: () => import('@/pages/layers/LayerDetailPage.vue'),
        },
        // Matching Config
        {
          path: 'matching-config',
          name: 'matching-config',
          component: () => import('@/pages/matching-config/MatchingConfigListPage.vue'),
        },
        // Partitions
        {
          path: 'partitions',
          name: 'partitions',
          component: () => import('@/pages/partitions/PartitionListPage.vue'),
        },
        {
          path: 'partitions/:id',
          name: 'partition-detail',
          component: () => import('@/pages/partitions/PartitionDetailPage.vue'),
        },
      ],
    },
    // Catch-all redirect
    {
      path: '/:pathMatch(.*)*',
      redirect: '/dashboard',
    },
  ],
});

export default router;
