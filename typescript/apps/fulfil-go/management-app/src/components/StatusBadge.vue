<script setup lang="ts">
/**
 * Status pill. Pages own their status→tone maps (statuses differ per
 * domain); this only standardizes the pill itself.
 */
const { tone = 'bg-neutral-100 text-neutral-600' } = defineProps<{
  label: string;
  tone?: string | undefined;
}>();
</script>

<template>
  <span class="shrink-0 rounded-full px-2 py-0.5 text-xs font-medium" :class="tone">{{
    label
  }}</span>
</template>
