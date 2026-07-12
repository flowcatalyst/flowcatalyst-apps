<script setup lang="ts">
import { computed } from 'vue';
import { clientId } from '../../context.js';

/**
 * Sidebar-footer identity block (FlowCatalyst chrome). No real auth in this
 * app yet — the "profile" is the dev principal plus the active client
 * (tenant), and the popover is where you switch client.
 */
defineProps<{ collapsed: boolean }>();

const userId = (import.meta.env.VITE_DEV_USER_ID as string | undefined) ?? 'prn_manager';
const displayName = 'Manager';
const initials = computed(() =>
  displayName
    .split(/\s+/)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase(),
);
</script>

<template>
  <UPopover :content="{ side: 'top', align: 'start', sideOffset: 8 }">
    <button
      type="button"
      class="flex w-full items-center rounded-lg p-2 text-left transition-colors hover:bg-white/10"
      :class="collapsed ? 'justify-center' : 'gap-2.5'"
      :title="collapsed ? `${displayName} · ${clientId}` : undefined"
    >
      <span
        class="flex size-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand-500 to-brand-300 text-[13px] font-bold text-white"
      >
        {{ initials }}
      </span>
      <template v-if="!collapsed">
        <span class="min-w-0 flex-1">
          <span class="block truncate text-[13px] font-medium text-white/85">
            {{ displayName }}
          </span>
          <span class="block truncate font-mono text-[11px] text-white/50">{{ clientId }}</span>
        </span>
        <UIcon name="i-lucide-chevron-up" class="size-4 shrink-0 text-white/40" />
      </template>
    </button>

    <template #content>
      <div class="w-72">
        <div class="flex items-center gap-3 border-b border-neutral-200 p-4">
          <span
            class="flex size-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand-500 to-brand-300 text-sm font-bold text-white"
          >
            {{ initials }}
          </span>
          <div class="min-w-0">
            <p class="truncate text-sm font-semibold text-neutral-800">{{ displayName }}</p>
            <p class="truncate font-mono text-xs text-neutral-500">{{ userId }}</p>
          </div>
        </div>

        <div class="border-b border-neutral-200 p-4">
          <label class="mb-1.5 block text-xs font-medium text-neutral-600">Active client</label>
          <UInput v-model="clientId" placeholder="clt_…" class="w-full font-mono" size="sm" />
          <p class="mt-1.5 text-[11px] text-neutral-400">
            Most operations are client-scoped — grids and actions follow this tenant.
          </p>
        </div>

        <p class="px-4 py-2.5 text-[11px] text-neutral-400">FulfilGo Management · development</p>
      </div>
    </template>
  </UPopover>
</template>
