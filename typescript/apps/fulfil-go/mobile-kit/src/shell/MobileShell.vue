<script setup lang="ts">
import BottomTabBar from './BottomTabBar.vue';
import type { TabItem } from './types.js';

/**
 * `tone="navy"` paints the chrome (safe-area strips + tab bar) navy — pair
 * it with `<MobileHeader tone="navy">` in the header slot.
 */
defineProps<{ tabs: readonly TabItem[]; tone?: 'default' | 'navy' }>();
</script>

<!--
  Mobile app frame: header slot, scrollable content, fixed bottom tab bar.
  safe-area env() insets keep content clear of notches and home indicators
  (requires viewport-fit=cover in the app's index.html). The safe-area
  strips take the chrome tone so notch/home-bar areas match the bars.
-->
<template>
  <div class="flex h-dvh flex-col bg-neutral-50 dark:bg-neutral-950">
    <header
      class="shrink-0 pt-[env(safe-area-inset-top)]"
      :class="tone === 'navy' ? 'bg-[#102a43]' : ''"
    >
      <slot name="header" />
    </header>
    <main class="min-h-0 flex-1 overflow-y-auto">
      <slot />
    </main>
    <BottomTabBar
      :tabs="tabs"
      :tone="tone"
      class="shrink-0 pb-[env(safe-area-inset-bottom)]"
      :class="tone === 'navy' ? 'bg-[#102a43]' : ''"
    >
      <template v-if="$slots['tab-icon']" #icon="scope">
        <slot name="tab-icon" v-bind="scope" />
      </template>
    </BottomTabBar>
  </div>
</template>
