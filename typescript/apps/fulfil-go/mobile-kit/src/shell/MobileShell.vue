<script setup lang="ts">
import BottomTabBar from './BottomTabBar.vue';
import type { TabItem } from './types.js';

defineProps<{ tabs: readonly TabItem[] }>();
</script>

<!--
  Mobile app frame: header slot, scrollable content, fixed bottom tab bar.
  safe-area env() insets keep content clear of notches and home indicators
  (requires viewport-fit=cover in the app's index.html).
-->
<template>
  <div class="flex h-dvh flex-col bg-neutral-50 dark:bg-neutral-950">
    <header class="shrink-0 pt-[env(safe-area-inset-top)]">
      <slot name="header" />
    </header>
    <main class="min-h-0 flex-1 overflow-y-auto">
      <slot />
    </main>
    <BottomTabBar :tabs="tabs" class="shrink-0 pb-[env(safe-area-inset-bottom)]">
      <template v-if="$slots['tab-icon']" #icon="scope">
        <slot name="tab-icon" v-bind="scope" />
      </template>
    </BottomTabBar>
  </div>
</template>
