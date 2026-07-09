<script setup lang="ts">
import { useRouter } from 'vue-router';

const props = defineProps<{ title: string; back?: boolean }>();
const router = useRouter();

function goBack(): void {
  if (props.back) router.back();
}
</script>

<template>
  <div
    class="flex h-12 items-center gap-2 border-b border-neutral-200 bg-white px-3 dark:border-neutral-800 dark:bg-neutral-900"
  >
    <button
      v-if="back"
      type="button"
      class="-ml-1 rounded p-1 text-lg leading-none text-neutral-600 dark:text-neutral-300"
      aria-label="Back"
      @click="goBack"
    >
      ‹
    </button>
    <h1 class="min-w-0 flex-1 truncate text-base font-semibold">{{ title }}</h1>
    <slot name="right" />
  </div>
</template>
