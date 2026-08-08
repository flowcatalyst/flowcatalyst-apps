<script setup lang="ts">
/**
 * Grid toolbar (pattern from the FlowCatalyst management UI, adapted to
 * Nuxt UI): optional quick-search + always-visible primary selects
 * (#inline slot) + a "Filters" button with an active-count badge opening a
 * popover holding the structured filters (#filters slot) + conditional
 * "Clear all". Filters NEVER go per-column — this bar is the whole filter
 * surface of a grid (docs/ui-upgrade-plan.md).
 *
 * `activeCount` counts POPOVER filters only (flowcatalyst convention — the
 * quick-search and inline selects are visible, so they don't need a badge);
 * `hasActive` gates Clear all and should include everything.
 */
const {
  searchPlaceholder = 'Search…',
  showSearch = false,
  activeCount = 0,
  hasActive = false,
} = defineProps<{
  searchPlaceholder?: string;
  showSearch?: boolean;
  /** Number of active popover filters — shown as the badge. */
  activeCount?: number;
  /** Whether ANY filter (search, inline, popover) is non-default. */
  hasActive?: boolean;
}>();

const search = defineModel<string>('search', { default: '' });
const emit = defineEmits<{ clear: [] }>();
</script>

<template>
  <div class="mb-3 flex flex-wrap items-center gap-3">
    <UInput
      v-if="showSearch"
      v-model="search"
      icon="i-lucide-search"
      :placeholder="searchPlaceholder"
      class="w-64"
    />
    <slot name="inline" />

    <UPopover :content="{ align: 'start' }">
      <UButton color="neutral" variant="outline" icon="i-lucide-list-filter" size="sm">
        Filters
        <span
          v-if="activeCount > 0"
          class="rounded-full bg-brand-100 px-1.5 text-xs font-semibold text-brand-700"
        >
          {{ activeCount }}
        </span>
      </UButton>
      <template #content>
        <div class="flex w-[340px] flex-col gap-4 p-4">
          <slot name="filters" />
        </div>
      </template>
    </UPopover>

    <UButton
      v-if="hasActive"
      color="neutral"
      variant="ghost"
      size="sm"
      icon="i-lucide-filter-x"
      @click="emit('clear')"
    >
      Clear all
    </UButton>

    <span class="ml-auto text-xs text-neutral-400"><slot name="meta" /></span>
  </div>
</template>
