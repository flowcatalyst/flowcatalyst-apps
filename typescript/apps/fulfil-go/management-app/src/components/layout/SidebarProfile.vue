<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { api, availableClients, clientId, clientName, loadClients } from '../../context.js';
import { session, signIn, signOut } from '../../auth/session.js';

/**
 * Sidebar-footer identity block (FlowCatalyst chrome). Identity comes from
 * GET /auth/me — OIDC claims when signed in, the dev fallback's x-user-name
 * otherwise. The popover carries the client (tenant) switcher — names from
 * the platform registry via GET /auth/clients — and sign-in/out.
 */
defineProps<{ collapsed: boolean }>();

interface Me {
  principalId: string;
  name: string | null;
  email: string | null;
}

const me = ref<Me | null>(null);
const signedIn = ref(false);
const authBusy = ref(false);
const authError = ref<string | null>(null);

onMounted(async () => {
  signedIn.value = await session.isAuthenticated();
  try {
    me.value = await api.json<Me>('/auth/me');
  } catch {
    // Anonymous / server down — the block falls back to placeholders.
  }
  await loadClients();
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

const clientItems = computed(() =>
  availableClients.value.map((c) => ({
    label: c.name,
    value: c.id,
    // Shown as the trailing hint in the picker rows.
    id: c.id,
  })),
);

async function onSignIn(): Promise<void> {
  authBusy.value = true;
  authError.value = null;
  try {
    await signIn(window.location.pathname);
  } catch (err) {
    authError.value = err instanceof Error ? err.message : 'Sign-in unavailable.';
    authBusy.value = false;
  }
}

async function onSignOut(): Promise<void> {
  authBusy.value = true;
  await signOut();
}
</script>

<template>
  <UPopover :content="{ side: 'top', align: 'start', sideOffset: 8 }">
    <button
      type="button"
      class="flex w-full items-center rounded-lg p-2 text-left transition-colors hover:bg-white/10"
      :class="collapsed ? 'justify-center' : 'gap-2.5'"
      :title="collapsed ? `${displayName} · ${clientName}` : undefined"
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
          <span class="block truncate text-[11px] text-white/50">{{ clientName }}</span>
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
          <USelectMenu
            v-if="clientItems.length > 0"
            v-model="clientId"
            :items="clientItems"
            value-key="value"
            class="w-full"
            size="sm"
          >
            <template #item-trailing="{ item }">
              <span class="font-mono text-[10px] text-neutral-400">{{ item.id }}</span>
            </template>
          </USelectMenu>
          <!-- Registry unavailable (platform down/unconfigured) — raw id entry. -->
          <UInput
            v-else
            v-model="clientId"
            placeholder="clt_…"
            class="w-full font-mono"
            size="sm"
          />
          <p class="mt-1.5 flex items-baseline justify-between gap-2 text-[11px] text-neutral-400">
            <span>Grids and actions follow this tenant.</span>
            <span class="shrink-0 font-mono">{{ clientId }}</span>
          </p>
        </div>

        <div class="p-2">
          <UAlert
            v-if="authError"
            :description="authError"
            color="warning"
            variant="soft"
            class="mb-2"
          />
          <UButton
            v-if="signedIn"
            block
            color="neutral"
            variant="ghost"
            icon="i-lucide-log-out"
            :loading="authBusy"
            @click="onSignOut"
          >
            Sign out
          </UButton>
          <UButton
            v-else
            block
            variant="soft"
            icon="i-lucide-log-in"
            :loading="authBusy"
            @click="onSignIn"
          >
            Sign in
          </UButton>
        </div>

        <p class="border-t border-neutral-200 px-4 py-2.5 text-[11px] text-neutral-400">
          FulfilGo Management
          <span v-if="!signedIn"> · dev-fallback identity</span>
        </p>
      </div>
    </template>
  </UPopover>
</template>
