<script setup lang="ts">
import { FcButton, NotificationBannerStack, toast } from '@flowcatalyst-apps/web-kit';
</script>

<template>
  <div class="execution-screen">
    <h1 class="page-title">Fulfil Execution</h1>
    <p class="page-subtitle">Mobile execution app</p>
    <FcButton label="Ping" icon="pi pi-check" @click="toast.success('Ready')" />
  </div>
  <NotificationBannerStack />
</template>

<style scoped>
.execution-screen {
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  align-items: flex-start;
}
</style>
