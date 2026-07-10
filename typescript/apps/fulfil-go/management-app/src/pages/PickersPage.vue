<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { api, clientId } from '../context.js';
import storeFixtures from '../generator/data/stores.json';

interface StoreSummary {
  id: string;
  storeRef: string;
  name: string;
  city: string | null;
  region: string | null;
}

interface PickerSummary {
  id: string;
  storeRef: string;
  displayName: string;
  staffCode: string;
  primaryAuthMethod: string;
  status: string;
}

const stores = ref<StoreSummary[]>([]);
const pickers = ref<PickerSummary[]>([]);
const selectedStore = ref<string>('');
const error = ref<string | null>(null);
const busy = reactive({ sync: false, seed: false, load: false });
const seedForm = reactive({ perStore: 10, pin: '123456' });
const lastSeed = ref<string | null>(null);

const storeOptions = computed(() =>
  stores.value.map((s) => ({ label: `${s.storeRef} · ${s.name}`, value: s.storeRef })),
);

async function loadStores(): Promise<void> {
  error.value = null;
  try {
    const res = await api.json<{ stores: StoreSummary[] }>(`/clients/${clientId.value}/stores`);
    stores.value = res.stores;
    if (!selectedStore.value && res.stores.length > 0) {
      selectedStore.value = res.stores[0]!.storeRef;
    }
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  }
}

async function loadPickers(): Promise<void> {
  if (!selectedStore.value) {
    pickers.value = [];
    return;
  }
  busy.load = true;
  error.value = null;
  try {
    const res = await api.json<{ pickers: PickerSummary[] }>(
      `/clients/${clientId.value}/pickers?store=${encodeURIComponent(selectedStore.value)}`,
    );
    pickers.value = res.pickers;
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    busy.load = false;
  }
}

/** Push the generator's committed store fixtures into the registry (idempotent upsert). */
async function syncStores(): Promise<void> {
  busy.sync = true;
  error.value = null;
  try {
    const res = await api.json<{ synced: number }>(`/clients/${clientId.value}/stores`, {
      method: 'PUT',
      body: { stores: storeFixtures },
    });
    lastSeed.value = `Synced ${res.synced} stores from fixtures.`;
    await loadStores();
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    busy.sync = false;
  }
}

async function seedPickers(): Promise<void> {
  busy.seed = true;
  error.value = null;
  try {
    const res = await api.json<{ stores: number; created: number; skipped: number; pin: string }>(
      `/clients/${clientId.value}/pickers/seed`,
      { method: 'POST', body: { perStore: seedForm.perStore, pin: seedForm.pin } },
    );
    lastSeed.value = `Seeded ${res.created} pickers across ${res.stores} stores (${res.skipped} already existed). Login PIN: ${res.pin}`;
    await loadPickers();
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    busy.seed = false;
  }
}

onMounted(() => {
  void loadStores().then(loadPickers);
});
watch(clientId, () => {
  selectedStore.value = '';
  void loadStores().then(loadPickers);
});
watch(selectedStore, () => void loadPickers());
</script>

<template>
  <div class="mx-auto max-w-4xl p-6">
    <h1 class="mb-1 text-xl font-semibold text-[#102a43]">Pickers</h1>
    <p class="mb-4 text-sm text-neutral-500">
      Pick-context staff per store. Sync the registry from the generator's 100 fixture stores,
      then seed test pickers (staff codes P01… with a shared PIN) for station login.
    </p>

    <UAlert v-if="error" :description="error" color="error" variant="soft" class="mb-3" />
    <UAlert v-if="lastSeed" :description="lastSeed" color="success" variant="soft" class="mb-3" />

    <!-- Seeding controls -->
    <div
      class="mb-4 flex flex-wrap items-end gap-3 rounded-lg border border-neutral-200 bg-white p-4"
    >
      <UButton :loading="busy.sync" variant="soft" @click="syncStores">
        Sync stores from fixtures ({{ storeFixtures.length }})
      </UButton>
      <div class="h-8 w-px bg-neutral-200" />
      <UFormField label="Pickers per store">
        <UInput v-model.number="seedForm.perStore" type="number" :min="1" :max="50" class="w-24" />
      </UFormField>
      <UFormField label="Shared PIN">
        <UInput v-model="seedForm.pin" class="w-28 font-mono" />
      </UFormField>
      <UButton :loading="busy.seed" :disabled="stores.length === 0" @click="seedPickers">
        Seed pickers
      </UButton>
    </div>

    <!-- Store selector + roster -->
    <div class="mb-3 flex items-center gap-3">
      <USelect
        v-model="selectedStore"
        :items="storeOptions"
        value-key="value"
        placeholder="Select a store…"
        class="w-96"
      />
      <span class="text-xs text-neutral-400">{{ stores.length }} stores in registry</span>
    </div>

    <div class="overflow-x-auto rounded-lg border border-neutral-200 bg-white">
      <table class="w-full text-sm">
        <thead>
          <tr class="bg-neutral-50 text-left text-xs font-semibold text-[#334e68]">
            <th class="px-3 py-2">Staff code</th>
            <th class="px-3 py-2">Name</th>
            <th class="px-3 py-2">Auth</th>
            <th class="px-3 py-2">Status</th>
            <th class="px-3 py-2">Id</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in pickers" :key="p.id" class="border-t border-neutral-100">
            <td class="px-3 py-2 font-mono">{{ p.staffCode }}</td>
            <td class="px-3 py-2">{{ p.displayName }}</td>
            <td class="px-3 py-2">{{ p.primaryAuthMethod }}</td>
            <td class="px-3 py-2">
              <span
                class="rounded-full px-2 py-0.5 text-xs font-medium"
                :class="
                  p.status === 'active'
                    ? 'bg-emerald-50 text-emerald-700'
                    : 'bg-neutral-100 text-neutral-500'
                "
              >
                {{ p.status }}
              </span>
            </td>
            <td class="px-3 py-2 font-mono text-xs text-neutral-400">{{ p.id }}</td>
          </tr>
          <tr v-if="pickers.length === 0 && !busy.load">
            <td colspan="5" class="px-3 py-8 text-center text-neutral-400">
              {{
                stores.length === 0
                  ? 'No stores in the registry yet — sync from fixtures first.'
                  : 'No pickers for this store — seed some.'
              }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
