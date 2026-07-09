<script setup lang="ts">
import { useRoute } from 'vue-router';
import type { TabItem } from './types.js';

defineProps<{ tabs: readonly TabItem[] }>();
const route = useRoute();
</script>

<template>
  <nav
    class="flex border-t border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900"
  >
    <router-link
      v-for="tab in tabs"
      :key="tab.route"
      :to="tab.route"
      class="flex flex-1 flex-col items-center gap-0.5 py-2 text-xs"
      :class="
        route.path.startsWith(tab.route)
          ? 'font-semibold text-primary'
          : 'text-neutral-500 dark:text-neutral-400'
      "
    >
      <span class="text-xl leading-none" aria-hidden="true">{{ tab.icon }}</span>
      <span>{{ tab.label }}</span>
    </router-link>
  </nav>
</template>
