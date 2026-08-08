<script setup lang="ts">
/**
 * Sortable column header (the ONLY sorting affordance — no sort dropdowns,
 * see docs/ui-upgrade-plan.md). Bind one shared `sort` model across all
 * sortable headers of a grid:
 *
 *   const sort = persistedFilter<SortState>('page', 'sort', { field: 'slotStart', dir: 'asc' });
 *   <SortableTh v-model="sort" field="slotStart" label="Slot" />
 *
 * Clicking an inactive column activates it ascending; clicking the active
 * column flips direction.
 */
export interface SortState {
  field: string;
  dir: 'asc' | 'desc';
}

const props = defineProps<{ field: string; label: string }>();
const sort = defineModel<SortState>({ required: true });

function onClick(): void {
  sort.value =
    sort.value.field === props.field
      ? { field: props.field, dir: sort.value.dir === 'asc' ? 'desc' : 'asc' }
      : { field: props.field, dir: 'asc' };
}
</script>

<template>
  <th class="px-3 py-2">
    <button
      type="button"
      class="inline-flex items-center gap-1 hover:text-navy-900"
      :title="
        sort.field === field
          ? `Sorted ${sort.dir === 'asc' ? 'ascending' : 'descending'} — click to flip`
          : 'Click to sort'
      "
      @click="onClick"
    >
      {{ label }}
      <UIcon
        v-if="sort.field === field"
        :name="sort.dir === 'asc' ? 'i-lucide-arrow-up' : 'i-lucide-arrow-down'"
        class="size-3"
      />
      <UIcon v-else name="i-lucide-arrow-up-down" class="size-3 opacity-30" />
    </button>
  </th>
</template>
