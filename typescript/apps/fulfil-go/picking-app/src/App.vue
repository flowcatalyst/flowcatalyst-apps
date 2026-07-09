<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { ConnectionBadge, MobileHeader, MobileShell, useQueue } from '@fulfil-go/mobile-kit';
import { TABS } from './config/tabs.js';
import { useAppCtx } from './context.js';

const ctx = useAppCtx();
const route = useRoute();
const queueState = useQueue(ctx.queue);
const title = computed(() => (route.meta['title'] as string | undefined) ?? 'FulfilGo Pick');
const showBack = computed(() => route.path.split('/').length > 2);
</script>

<template>
  <UApp>
    <MobileShell :tabs="TABS">
      <template #header>
        <MobileHeader :title="title" :back="showBack">
          <template #right>
            <ConnectionBadge
              :state="ctx.jobs.sseState.value"
              :pending="queueState.pending.value"
              :dead="queueState.dead.value"
            />
          </template>
        </MobileHeader>
      </template>
      <router-view />
    </MobileShell>
  </UApp>
</template>
