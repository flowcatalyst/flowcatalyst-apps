<script setup lang="ts">
import { useAppCtx } from '../context.js';

const ctx = useAppCtx();

const statusColor: Record<string, 'neutral' | 'info' | 'primary' | 'success'> = {
  created: 'neutral',
  assigned: 'info',
  accepted: 'primary',
  completed: 'success',
};
</script>

<template>
  <div class="flex flex-col gap-3 p-3">
    <UAlert
      v-if="ctx.jobs.jobs.value.length === 0"
      title="No jobs yet"
      description="Assigned jobs appear here in real time."
      variant="soft"
    />
    <router-link
      v-for="job in ctx.jobs.jobs.value"
      :key="job.id"
      :to="`/jobs/${job.id}`"
      class="block"
    >
      <UCard>
        <div class="flex items-center justify-between gap-2">
          <div class="min-w-0">
            <p class="truncate font-medium">{{ job.title }}</p>
            <p v-if="job.details" class="truncate text-sm text-neutral-500">{{ job.details }}</p>
          </div>
          <UBadge :color="statusColor[job.status] ?? 'neutral'" variant="subtle">
            {{ job.status }}
          </UBadge>
        </div>
      </UCard>
    </router-link>
  </div>
</template>
