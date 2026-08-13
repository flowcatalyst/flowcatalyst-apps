<script setup lang="ts">
import { useRoute } from 'vue-router';
import type { TabItem } from './types.js';

/** `tone="navy"` — see MobileHeader; light-on-navy chrome variant. */
defineProps<{ tabs: readonly TabItem[]; tone?: 'default' | 'navy' | undefined }>();
const route = useRoute();
</script>

<template>
  <nav
    class="flex border-t"
    :class="
      tone === 'navy'
        ? 'border-[#0a1929] bg-[#102a43]'
        : 'border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900'
    "
  >
    <router-link
      v-for="tab in tabs"
      :key="tab.route"
      :to="tab.route"
      class="flex flex-1 flex-col items-center gap-0.5 py-2 text-xs transition-colors"
      :class="
        route.path.startsWith(tab.route)
          ? tone === 'navy'
            ? 'font-semibold text-white'
            : 'font-semibold text-primary'
          : tone === 'navy'
            ? 'text-slate-400'
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
