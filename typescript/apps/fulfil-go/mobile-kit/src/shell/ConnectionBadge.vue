<script setup lang="ts">
import { computed } from 'vue';
import type { SseState } from '../sse/sse-client.js';

const props = defineProps<{ state: SseState; pending: number; dead: number }>();

const dotClass = computed(() =>
  props.state === 'open'
    ? 'bg-emerald-500'
    : props.state === 'closed'
      ? 'bg-neutral-400'
      : 'bg-amber-500 animate-pulse',
);

const label = computed(() =>
  props.state === 'open' ? 'Live' : props.state === 'closed' ? 'Offline' : 'Reconnecting',
);
</script>

<!-- SSE/network state + offline-queue badges — drop into a header's right slot. -->
<template>
  <div class="flex items-center gap-2 text-xs text-neutral-600 dark:text-neutral-300">
    <span class="flex items-center gap-1">
      <span class="inline-block h-2 w-2 rounded-full" :class="dotClass" />
      {{ label }}
    </span>
    <span
      v-if="pending > 0"
      class="rounded-full bg-amber-100 px-1.5 py-0.5 font-medium text-amber-800 dark:bg-amber-900 dark:text-amber-100"
      :title="`${pending} queued change(s) waiting to sync`"
    >
      {{ pending }}
    </span>
    <span
      v-if="dead > 0"
      class="rounded-full bg-red-100 px-1.5 py-0.5 font-medium text-red-800 dark:bg-red-900 dark:text-red-100"
      :title="`${dead} failed change(s) need attention`"
    >
      !{{ dead }}
    </span>
  </div>
</template>
