<script setup lang="ts">
import StatusBadge from './StatusBadge.vue';

/**
 * Non-modal inspector side panel (ui-guidelines.md): a LAYOUT COLUMN docked
 * right of a grid, never an overlay — the grid stays interactive and
 * clicking another row swaps the content without dismissing. The host page
 * owns selection state (`?selected=` route query) and mounts this with
 * v-if; header shows title + optional status pill (+ #badges), body is the
 * default slot and scrolls.
 */
defineProps<{
  title: string;
  /** Mono second line under the title (usually the entity id). */
  subtitle?: string | undefined;
  status?: string | undefined;
  /** Tailwind tone classes for the status pill. */
  statusTone?: string | undefined;
}>();
const emit = defineEmits<{ close: [] }>();
</script>

<template>
  <aside
    class="flex w-[480px] shrink-0 flex-col border-l border-neutral-200 bg-white shadow-[-8px_0_32px_rgba(15,23,42,0.06)]"
  >
    <div class="flex items-start justify-between gap-3 border-b border-neutral-200 px-5 py-4">
      <div class="min-w-0">
        <div class="flex items-center gap-2">
          <h2 class="truncate text-lg font-semibold text-navy-900">{{ title }}</h2>
          <StatusBadge v-if="status" :label="status" :tone="statusTone" />
          <slot name="badges" />
        </div>
        <p v-if="subtitle" class="truncate font-mono text-xs text-neutral-400">{{ subtitle }}</p>
      </div>
      <UButton
        size="xs"
        color="neutral"
        variant="ghost"
        icon="i-lucide-x"
        aria-label="Close panel"
        @click="emit('close')"
      />
    </div>

    <div class="flex flex-1 flex-col gap-5 overflow-y-auto p-5">
      <slot />
    </div>
  </aside>
</template>
