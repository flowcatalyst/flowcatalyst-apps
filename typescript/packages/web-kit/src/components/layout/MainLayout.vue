<script setup lang="ts">
import { useLocalState } from '../../composables/useLocalState';
import type { NavGroup } from '../../config/navigation';
import AppSidebar from './AppSidebar.vue';
import AppHeader from './AppHeader.vue';

const props = withDefaults(
  defineProps<{
    navigation: NavGroup[];
    /** localStorage key for the sidebar collapsed state. */
    storageKey?: string;
    version?: string;
  }>(),
  {
    storageKey: 'app:sidebar-collapsed',
    version: '',
  },
);

const sidebarCollapsed = useLocalState(props.storageKey, false);

function toggleSidebar() {
  sidebarCollapsed.value = !sidebarCollapsed.value;
}
</script>

<template>
  <div class="layout-container">
    <AppSidebar
      :navigation="navigation"
      :collapsed="sidebarCollapsed"
      :version="version || ''"
      @toggle-collapse="toggleSidebar"
    >
      <template #logo>
        <slot name="logo" />
      </template>
      <template #sidebar-top="slotProps">
        <slot name="sidebar-top" v-bind="slotProps" />
      </template>
    </AppSidebar>
    <div class="layout-main" :class="{ 'sidebar-collapsed': sidebarCollapsed }">
      <AppHeader :sidebar-collapsed="sidebarCollapsed" @toggle-sidebar="toggleSidebar">
        <template #breadcrumb>
          <slot name="breadcrumb" />
        </template>
        <template #user>
          <slot name="user" />
        </template>
      </AppHeader>
      <main class="layout-content">
        <RouterView />
      </main>
    </div>
  </div>
</template>

<style scoped>
.layout-container {
  display: flex;
  min-height: 100vh;
  background-color: #f8fafc;
}

.layout-main {
  flex: 1;
  margin-left: 260px;
  transition: margin-left 0.3s ease;
  display: flex;
  flex-direction: column;
  min-height: 100vh;
}

.layout-main.sidebar-collapsed {
  margin-left: 72px;
}

.layout-content {
  flex: 1;
  padding: 16px;
  margin-top: 64px;
}

@media (max-width: 768px) {
  .layout-main {
    margin-left: 0;
  }

  .layout-main.sidebar-collapsed {
    margin-left: 0;
  }
}
</style>
