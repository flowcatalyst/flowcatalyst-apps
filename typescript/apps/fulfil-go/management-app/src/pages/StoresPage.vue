<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { api, clientId } from '../context.js';
import { persistedFilter } from '../lib/persisted-filter.js';
import storeFixtures from '../generator/data/stores.json';
import PageHeader from '../components/PageHeader.vue';

interface StoreSummary {
  id: string;
  storeRef: string;
  name: string;
  city: string | null;
  region: string | null;
  pickProfileCode: string;
  transportProfileCode: string;
}

type ProfileDomain = 'pick' | 'transport';

const stores = ref<StoreSummary[]>([]);
const profileOptions = ref<Record<ProfileDomain, Array<{ label: string; value: string }>>>({
  pick: [],
  transport: [],
});
const profileBusy = ref<string | null>(null);

async function loadProfiles(): Promise<void> {
  for (const domain of ['pick', 'transport'] as const) {
    try {
      const res = await api.json<{ profiles: Array<{ code: string; name: string }> }>(
        `/clients/${clientId.value}/config/${domain}/store-profiles`,
      );
      profileOptions.value[domain] = res.profiles.map((p) => ({ label: p.name, value: p.code }));
    } catch {
      profileOptions.value[domain] = [{ label: 'Default', value: 'default' }];
    }
  }
}

function assignedCode(store: StoreSummary, domain: ProfileDomain): string {
  return domain === 'pick' ? store.pickProfileCode : store.transportProfileCode;
}

async function assignProfile(
  store: StoreSummary,
  domain: ProfileDomain,
  profileCode: string,
): Promise<void> {
  if (profileCode === assignedCode(store, domain)) return;
  profileBusy.value = `${store.storeRef}:${domain}`;
  try {
    await api.json(`/clients/${clientId.value}/config/${domain}/stores/${store.storeRef}`, {
      method: 'PATCH',
      body: { profileCode },
    });
    if (domain === 'pick') store.pickProfileCode = profileCode;
    else store.transportProfileCode = profileCode;
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    profileBusy.value = null;
  }
}
const filter = persistedFilter('stores', 'search', '');
const error = ref<string | null>(null);
const notice = ref<string | null>(null);
const busy = ref(false);
const loading = ref(false);

async function load(): Promise<void> {
  loading.value = true;
  error.value = null;
  try {
    const res = await api.json<{ stores: StoreSummary[] }>(`/clients/${clientId.value}/stores`);
    stores.value = res.stores;
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    loading.value = false;
  }
}

/**
 * Push the generator's committed fixtures into the registry (idempotent
 * upsert). A real integration would sync from master data instead.
 */
async function syncFixtures(): Promise<void> {
  busy.value = true;
  error.value = null;
  try {
    const res = await api.json<{ synced: number }>(`/clients/${clientId.value}/stores`, {
      method: 'PUT',
      body: { stores: storeFixtures },
    });
    notice.value = `Synced ${res.synced} stores from fixtures.`;
    await load();
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    busy.value = false;
  }
}

const visible = (): StoreSummary[] => {
  const q = filter.value.trim().toLowerCase();
  if (!q) return stores.value;
  return stores.value.filter((s) =>
    [s.storeRef, s.name, s.city ?? '', s.region ?? ''].some((v) => v.toLowerCase().includes(q)),
  );
};

onMounted(() => {
  void load();
  void loadProfiles();
});
watch(clientId, () => {
  void load();
  void loadProfiles();
});
</script>

<template>
  <div class="max-w-5xl p-6">
    <PageHeader title="Stores">
      <template #subtitle>
        Base store setup — the registry every other context (picking, fulfilment, transport) binds
        to by <span class="font-mono">storeRef</span>. Each store carries a PICK profile and a
        TRANSPORT profile (edited under their sections).
      </template>
    </PageHeader>

    <UAlert v-if="error" :description="error" color="error" variant="soft" class="mb-3" />
    <UAlert v-if="notice" :description="notice" color="success" variant="soft" class="mb-3" />

    <div class="mb-3 flex items-center gap-3">
      <UInput v-model="filter" placeholder="Filter by ref / name / city…" class="w-72" />
      <span class="text-xs text-neutral-400">{{ stores.length }} in registry</span>
      <div class="flex-1" />
      <UButton :loading="busy" variant="soft" @click="syncFixtures">
        Sync from fixtures ({{ storeFixtures.length }})
      </UButton>
    </div>

    <div class="overflow-x-auto rounded-lg border border-neutral-200 bg-white">
      <table class="w-full text-sm">
        <thead>
          <tr class="bg-neutral-50 text-left text-xs font-semibold text-navy-700">
            <th class="px-3 py-2">Store ref</th>
            <th class="px-3 py-2">Name</th>
            <th class="px-3 py-2">City</th>
            <th class="px-3 py-2">Region</th>
            <th class="px-3 py-2">Pick profile</th>
            <th class="px-3 py-2">Transport profile</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="s in visible()" :key="s.id" class="border-t border-neutral-100">
            <td class="px-3 py-2 font-mono text-xs">{{ s.storeRef }}</td>
            <td class="px-3 py-2">{{ s.name }}</td>
            <td class="px-3 py-2 text-neutral-500">{{ s.city ?? '—' }}</td>
            <td class="px-3 py-2 text-neutral-500">{{ s.region ?? '—' }}</td>
            <td class="px-3 py-2">
              <USelect
                :model-value="s.pickProfileCode"
                :items="profileOptions.pick"
                value-key="value"
                size="xs"
                class="w-36"
                :loading="profileBusy === `${s.storeRef}:pick`"
                @update:model-value="(v: string) => assignProfile(s, 'pick', v)"
              />
            </td>
            <td class="px-3 py-2">
              <USelect
                :model-value="s.transportProfileCode"
                :items="profileOptions.transport"
                value-key="value"
                size="xs"
                class="w-36"
                :loading="profileBusy === `${s.storeRef}:transport`"
                @update:model-value="(v: string) => assignProfile(s, 'transport', v)"
              />
            </td>
          </tr>
          <tr v-if="stores.length === 0 && !loading">
            <td colspan="6" class="px-3 py-8 text-center text-neutral-400">
              No stores yet — sync from fixtures to get started.
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
