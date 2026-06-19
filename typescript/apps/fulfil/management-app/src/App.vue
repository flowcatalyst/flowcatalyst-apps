<script setup lang="ts">
import { MainLayout, NotificationBannerStack } from '@flowcatalyst-apps/web-kit';
import { NAVIGATION } from './config/navigation';
</script>

<template>
  <MainLayout :navigation="NAVIGATION" storage-key="fulfil-mgmt:sidebar-collapsed" version="0.0.1">
    <template #logo>
      <span class="app-logo">Fulfil</span>
    </template>
    <template #user>
      <span class="user-placeholder">Sign in</span>
    </template>
  </MainLayout>
  <NotificationBannerStack />
</template>

<style scoped>
.app-logo {
  color: #ffffff;
  font-weight: 600;
  font-size: 18px;
}

.user-placeholder {
  color: #64748b;
  font-size: 14px;
}
</style>
