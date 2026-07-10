<script setup lang="ts">
import { clientId } from './context.js';

const NAV = [
  { label: 'Fulfilments', to: '/fulfilments', icon: '📦' },
  { label: 'Pickers', to: '/pickers', icon: '🧑‍🏭' },
  { label: 'Generator', to: '/generator', icon: '⚙️' },
];
</script>

<template>
  <UApp>
    <div class="flex h-dvh bg-neutral-50">
      <!-- Navy sidebar — pinpoint/web-kit chrome (see ui-guidelines.md). -->
      <aside class="fc-sidebar flex w-56 shrink-0 flex-col text-white">
        <div class="px-4 py-5">
          <p class="text-lg font-semibold">FulfilGo</p>
          <p class="text-xs text-[#47a3f3]">Manage</p>
        </div>
        <nav class="flex flex-1 flex-col gap-1 px-2">
          <router-link
            v-for="item in NAV"
            :key="item.to"
            :to="item.to"
            class="flex items-center gap-2 rounded px-3 py-2 text-sm text-white/70 hover:bg-white/10"
            active-class="!bg-white/15 !text-white font-medium"
          >
            <span aria-hidden="true">{{ item.icon }}</span>
            {{ item.label }}
          </router-link>
        </nav>
        <div class="border-t border-white/10 p-3">
          <label class="mb-1 block text-[11px] uppercase tracking-wide text-white/40">
            Client
          </label>
          <input
            v-model="clientId"
            class="w-full rounded bg-white/10 px-2 py-1 font-mono text-xs text-white outline-none placeholder:text-white/30"
            placeholder="cli_…"
          />
        </div>
      </aside>

      <main class="min-w-0 flex-1 overflow-y-auto">
        <router-view />
      </main>
    </div>
  </UApp>
</template>
