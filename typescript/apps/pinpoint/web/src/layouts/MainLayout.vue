<script setup lang="ts">
import { computed } from 'vue';
import { MainLayout } from '@flowcatalyst-apps/web-kit';
import { NAVIGATION_CONFIG } from '@/config/navigation';
import { useAuthStore } from '@/stores/auth';
import UserMenu from '@/components/layout/UserMenu.vue';
import ClientSelector from '@/components/layout/ClientSelector.vue';

const authStore = useAuthStore();

// Nav entries that require a specific permission to be shown at all. Pages
// that are pure tools/actions (vs. read views everyone with the app can see)
// belong here so we don't render a dead link that just bounces to the
// Access Denied modal. Extend as needed.
const NAV_PERMISSIONS: Record<string, string> = {
  '/spatial-lookup': 'pinpoint:matching:spatial:lookup',
};

const navigation = computed(() =>
  NAVIGATION_CONFIG.map((group) => ({
    ...group,
    items: group.items.filter((item) => {
      const required = item.route ? NAV_PERMISSIONS[item.route] : undefined;
      return !required || authStore.can(required);
    }),
  })).filter((group) => group.items.length > 0),
);
</script>

<template>
  <MainLayout :navigation="navigation" storage-key="pp:sidebar-collapsed" version="0.0.1">
    <template #logo>
      <span class="pp-logo">
        <span class="pp-logo-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="1.5"
              d="M17.657 16.657L13.414 20.9a2 2 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"
            />
            <circle cx="12" cy="11" r="3" stroke-width="1.5" />
          </svg>
        </span>
        <span class="pp-logo-text">Pinpoint</span>
      </span>
    </template>

    <template #sidebar-top="{ collapsed }">
      <ClientSelector :collapsed="collapsed" />
    </template>

    <template #breadcrumb>
      <span class="pp-breadcrumb-app">Pinpoint</span>
    </template>

    <template #user>
      <UserMenu />
    </template>
  </MainLayout>
</template>

<style scoped>
.pp-logo {
  display: flex;
  align-items: center;
  gap: 10px;
}

.pp-logo-icon {
  width: 28px;
  height: 28px;
  color: #47a3f3;
  flex-shrink: 0;
  display: flex;
}

.pp-logo-icon svg {
  width: 100%;
  height: 100%;
}

.pp-logo-text {
  font-size: 18px;
  font-weight: 700;
  color: #ffffff;
  white-space: nowrap;
}

.pp-breadcrumb-app {
  font-weight: 600;
  color: #102a43;
}
</style>
