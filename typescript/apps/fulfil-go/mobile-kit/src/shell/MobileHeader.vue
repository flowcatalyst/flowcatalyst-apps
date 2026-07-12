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
      class="-ml-1 rounded-md p-1.5 text-neutral-600 transition-colors active:bg-neutral-100 dark:text-neutral-300 dark:active:bg-neutral-800"
      aria-label="Back"
      @click="goBack"
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        class="size-5"
        aria-hidden="true"
      >
        <path d="m15 18-6-6 6-6" />
      </svg>
    </button>
    <h1 class="min-w-0 flex-1 truncate text-base font-semibold">{{ title }}</h1>
    <slot name="right" />
  </div>
</template>
