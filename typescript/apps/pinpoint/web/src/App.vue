<script setup lang="ts">
import GlobalToast from '@/components/GlobalToast.vue';
</script>

<template>
  <RouterView />
  <Toast />
  <ConfirmDialog />
  <GlobalToast />
</template>
