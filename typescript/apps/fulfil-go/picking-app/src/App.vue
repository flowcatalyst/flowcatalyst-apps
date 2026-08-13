<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ConnectionBadge, MobileHeader, MobileShell, useQueue } from '@fulfil-go/mobile-kit';
import { TABS, TAB_ICONS } from './config/tabs.js';
import { useAppCtx } from './context.js';

const ctx = useAppCtx();
const route = useRoute();
const router = useRouter();
const queueState = useQueue(ctx.queue);
const title = computed(() => (route.meta['title'] as string | undefined) ?? 'FulfilGo Pick');

async function exit(): Promise<void> {
  await ctx.exit();
  await router.push('/login');
}

/**
 * Shared-station idle logout: no interaction for IDLE_MS ends the person
 * session so the next picker isn't acting as the last one.
 */
const IDLE_MS = 15 * 60_000;
let idleTimer: ReturnType<typeof setTimeout> | undefined;
function resetIdle(): void {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (ctx.signedIn.value) void exit();
  }, IDLE_MS);
}
onMounted(() => {
  window.addEventListener('pointerdown', resetIdle, { passive: true });
  window.addEventListener('keydown', resetIdle, { passive: true });
  resetIdle();
});
onUnmounted(() => {
  clearTimeout(idleTimer);
  window.removeEventListener('pointerdown', resetIdle);
  window.removeEventListener('keydown', resetIdle);
});
</script>

<template>
  <UApp>
    <MobileShell :tabs="TABS" tone="navy">
      <template #header>
        <MobileHeader :title="title" tone="navy">
          <template #right>
            <div v-if="ctx.signedIn.value" class="flex items-center gap-3">
              <ConnectionBadge
                :state="ctx.picks.sseState.value"
                :pending="queueState.pending.value"
                :dead="queueState.dead.value"
                tone="navy"
              />
              <UButton size="xs" color="neutral" variant="soft" @click="exit">Exit</UButton>
            </div>
          </template>
        </MobileHeader>
      </template>
      <template #tab-icon="{ tab }">
        <UIcon :name="TAB_ICONS[tab.route] ?? 'i-lucide-circle'" class="size-[22px]" />
      </template>
      <router-view />
    </MobileShell>
  </UApp>
</template>
