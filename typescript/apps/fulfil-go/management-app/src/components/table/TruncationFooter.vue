<script setup lang="ts">
import { computed } from 'vue';

/**
 * Honest-truncation notice (the alternative to pagination — see
 * docs/ui-upgrade-plan.md): renders only when the row count hits the
 * server's cap, telling the operator to narrow filters.
 */
const props = defineProps<{ shown: number; limit: number }>();
const truncated = computed(() => props.shown >= props.limit);
</script>

<template>
  <p v-if="truncated" class="mt-2 text-xs text-amber-600">
    <UIcon name="i-lucide-triangle-alert" class="mr-1 inline-block size-3 align-[-1px]" />
    Showing the first {{ limit }} rows (limit reached) — narrow the filters to see the rest.
  </p>
</template>
