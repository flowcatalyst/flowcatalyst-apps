<script setup lang="ts">
import AppSidebar from './components/layout/AppSidebar.vue';
</script>

<template>
  <UApp>
    <div class="flex h-dvh bg-neutral-50">
      <!-- Collapsible navy sidebar — FlowCatalyst management chrome
           (see ui-guidelines.md; nav config in src/config/navigation.ts). -->
      <AppSidebar />

      <main class="min-w-0 flex-1 overflow-y-auto">
        <router-view />
      </main>
    </div>
  </UApp>
</template>
