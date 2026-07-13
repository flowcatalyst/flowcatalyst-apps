<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { api, clientId } from '../../context.js';

/**
 * Sidebar-footer identity block (FlowCatalyst chrome). Identity comes from
 * GET /auth/me — the display name/email ride OIDC claims on real tokens and
 * the dev fallback's x-user-name (VITE_DEV_USER_NAME) in browser dev. The
 * popover is where you switch the active client (tenant).
 */
defineProps<{ collapsed: boolean }>();

interface Me {
  principalId: string;
  name: string | null;
  email: string | null;
}

const me = ref<Me | null>(null);
onMounted(async () => {
  try {
    me.value = await api.json<Me>('/auth/me');
  } catch {
    // Anonymous / server down — the block falls back to placeholders.
  }
});

const displayName = computed(() => me.value?.name ?? me.value?.principalId ?? '…');
const initials = computed(() =>
  displayName.value
    .replace(/^prn_/, '')
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
            <p v-if="me?.email" class="truncate text-xs text-neutral-500">{{ me.email }}</p>
            <p class="truncate font-mono text-xs text-neutral-500">
              {{ me?.principalId ?? 'not signed in' }}
            </p>
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
