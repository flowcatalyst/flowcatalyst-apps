<script setup lang="ts">
import { onMounted, ref } from 'vue';
import type { QueueItem } from '@fulfil-go/mobile-kit';
import { useAppCtx } from '../context.js';

const ctx = useAppCtx();
const dead = ref<readonly QueueItem[]>([]);

async function refreshDead(): Promise<void> {
  dead.value = await ctx.queue.listDead();
}

onMounted(() => {
  void refreshDead();
  ctx.queue.onChange(() => void refreshDead());
});

async function logout(): Promise<void> {
  await ctx.auth.logout();
  window.location.href = '/login';
}
</script>

<template>
  <div class="flex flex-col gap-6 p-4">
    <section class="flex flex-col gap-2">
      <h2 class="font-semibold">Failed changes</h2>
      <p v-if="dead.length === 0" class="text-sm text-neutral-500">Nothing needs attention.</p>
      <UCard v-for="item in dead" :key="item.id">
        <div class="flex items-center justify-between gap-2 text-sm">
          <div class="min-w-0">
            <p class="truncate font-mono">{{ item.method }} {{ item.endpoint }}</p>
            <p class="truncate text-xs text-neutral-500">{{ item.lastError }}</p>
          </div>
          <div class="flex shrink-0 gap-1">
            <UButton size="xs" variant="soft" @click="ctx.queue.retryDead(item.id)">
              Retry
            </UButton>
            <UButton size="xs" color="error" variant="soft" @click="ctx.queue.discardDead(item.id)">
              Discard
            </UButton>
          </div>
        </div>
      </UCard>
    </section>

    <UButton v-if="ctx.isNative" color="neutral" variant="soft" block @click="logout">
      Sign out
    </UButton>
  </div>
</template>
