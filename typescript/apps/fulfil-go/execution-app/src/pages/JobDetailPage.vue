<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAppCtx } from '../context.js';

const ctx = useAppCtx();
const route = useRoute();
const router = useRouter();
const jobId = route.params['jobId'] as string;
const job = computed(() => ctx.jobs.byId(jobId));
const note = ref('');

async function accept(): Promise<void> {
  await ctx.jobs.accept(jobId);
}

async function complete(): Promise<void> {
  await ctx.jobs.complete(jobId, note.value || undefined);
  await router.push('/jobs');
}
</script>

<template>
  <div class="flex flex-col gap-4 p-4">
    <UAlert v-if="!job" title="Job not found" color="warning" variant="soft" />
    <template v-else>
      <div>
        <h2 class="text-lg font-semibold">{{ job.title }}</h2>
        <p v-if="job.details" class="mt-1 text-sm text-neutral-600 dark:text-neutral-300">
          {{ job.details }}
        </p>
        <p class="mt-2 text-sm text-neutral-500">
          Status: <span class="font-medium">{{ job.status }}</span>
        </p>
      </div>

      <UButton v-if="job.status === 'assigned'" size="xl" block @click="accept">
        Accept job
      </UButton>

      <template v-if="job.status === 'accepted'">
        <UTextarea v-model="note" placeholder="Completion note (optional)" :rows="2" />
        <UButton size="xl" color="success" block @click="complete">Complete job</UButton>
      </template>

      <UAlert v-if="job.status === 'completed'" title="Completed" color="success" variant="soft" />
    </template>
  </div>
</template>
