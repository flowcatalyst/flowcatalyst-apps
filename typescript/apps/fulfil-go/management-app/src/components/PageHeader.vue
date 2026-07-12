<script setup lang="ts">
/** Standard page header: title/subtitle left, actions right (FlowCatalyst chrome). */
defineProps<{ title: string; subtitle?: string }>();
</script>

<template>
  <div class="mb-4 flex flex-wrap items-start justify-between gap-3">
    <div class="min-w-0">
      <h1 class="text-2xl font-semibold text-navy-900">{{ title }}</h1>
      <p v-if="subtitle || $slots['subtitle']" class="mt-0.5 max-w-2xl text-sm text-navy-500">
        <slot name="subtitle">{{ subtitle }}</slot>
      </p>
    </div>
    <div v-if="$slots['actions']" class="flex shrink-0 items-center gap-2">
      <slot name="actions" />
    </div>
  </div>
</template>
