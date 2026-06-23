<script setup lang="ts">
import GlobalToast from '@/components/GlobalToast.vue';
import PermissionDeniedDialog from '@/components/PermissionDeniedDialog.vue';
</script>

<template>
  <RouterView />
  <Toast />
  <ConfirmDialog />
  <GlobalToast />
  <PermissionDeniedDialog />
</template>
