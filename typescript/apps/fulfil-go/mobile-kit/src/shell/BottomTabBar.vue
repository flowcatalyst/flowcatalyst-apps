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
      class="flex flex-1 flex-col items-center gap-0.5 py-2 text-xs transition-colors"
      :class="
        route.path.startsWith(tab.route)
          ? 'font-semibold text-primary'
          : 'text-neutral-500 dark:text-neutral-400'
      "
    >
      <span class="flex h-6 items-center text-xl leading-none" aria-hidden="true">
        <!-- Apps with an icon system override via the slot; emoji is the fallback. -->
        <slot name="icon" :tab="tab" :active="route.path.startsWith(tab.route)">
          {{ tab.icon }}
        </slot>
      </span>
      <span>{{ tab.label }}</span>
    </router-link>
  </nav>
</template>
