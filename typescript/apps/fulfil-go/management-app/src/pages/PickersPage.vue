<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { api, clientId } from '../context.js';
import PageHeader from '../components/PageHeader.vue';

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
  /** 'picker' | 'supervisor' — supervisor unlocks station supervisor mode. */
  role: string;
  status: string;
}

const stores = ref<StoreSummary[]>([]);
const pickers = ref<PickerSummary[]>([]);
const selectedStore = ref<string>('');
const error = ref<string | null>(null);
const notice = ref<string | null>(null);
const busy = reactive({ seed: false, create: false, load: false });
const rowBusy = ref<string | null>(null);

// '385345' = FULFIL on a phone keypad — not in breach lists (Chrome-quiet).
const seedForm = reactive({ perStore: 10, pin: '385345', resetPins: false });
const createForm = reactive({ displayName: '', staffCode: '', pin: '' });
/** Per-row reassign target (pickerId → storeRef). */
const reassignTo = reactive<Record<string, string>>({});

const storeOptions = computed(() =>
  stores.value.map((s) => ({ label: `${s.storeRef} · ${s.name}`, value: s.storeRef })),
);

function fail(err: unknown): void {
  error.value = err instanceof Error ? err.message : String(err);
}

async function loadStores(): Promise<void> {
  error.value = null;
  try {
    const res = await api.json<{ stores: StoreSummary[] }>(`/clients/${clientId.value}/stores`);
    stores.value = res.stores;
    if (!selectedStore.value && res.stores.length > 0) {
      selectedStore.value = res.stores[0]!.storeRef;
    }
  } catch (err) {
    fail(err);
  }
}

async function loadPickers(): Promise<void> {
  if (!selectedStore.value) {
    pickers.value = [];
    return;
  }
  busy.load = true;
  try {
    const res = await api.json<{ pickers: PickerSummary[] }>(
      `/clients/${clientId.value}/pickers?store=${encodeURIComponent(selectedStore.value)}`,
    );
    pickers.value = res.pickers;
  } catch (err) {
    fail(err);
  } finally {
    busy.load = false;
  }
}

async function createPicker(): Promise<void> {
  busy.create = true;
  error.value = null;
  try {
    await api.json(`/clients/${clientId.value}/pickers`, {
      method: 'POST',
      body: {
        storeRef: selectedStore.value,
        displayName: createForm.displayName.trim(),
        staffCode: createForm.staffCode.trim(),
        pin: createForm.pin,
      },
    });
    notice.value = `Created ${createForm.staffCode} at ${selectedStore.value}.`;
    createForm.displayName = '';
    createForm.staffCode = '';
    createForm.pin = '';
    await loadPickers();
  } catch (err) {
    fail(err);
  } finally {
    busy.create = false;
  }
}

async function rowAction(picker: PickerSummary, action: () => Promise<unknown>): Promise<void> {
  rowBusy.value = picker.id;
  error.value = null;
  try {
    await action();
    await loadPickers();
  } catch (err) {
    fail(err);
  } finally {
    rowBusy.value = null;
  }
}

const suspend = (p: PickerSummary) =>
  rowAction(p, () =>
    api.json(`/clients/${clientId.value}/pickers/${p.id}/suspend`, { method: 'POST' }),
  );
const reactivate = (p: PickerSummary) =>
  rowAction(p, () =>
    api.json(`/clients/${clientId.value}/pickers/${p.id}/reactivate`, { method: 'POST' }),
  );
const reassign = (p: PickerSummary) => {
  const storeRef = reassignTo[p.id];
  if (!storeRef || storeRef === p.storeRef) return Promise.resolve();
  return rowAction(p, () =>
    api.json(`/clients/${clientId.value}/pickers/${p.id}/reassign`, {
      method: 'POST',
      body: { storeRef },
    }),
  );
};
const remove = (p: PickerSummary) => {
  // Suspend covers "off the roster"; delete is for mistakes — confirm it.
  if (!window.confirm(`Delete ${p.displayName} (${p.staffCode})? This cannot be undone.`)) {
    return Promise.resolve();
  }
  return rowAction(p, () =>
    api.json(`/clients/${clientId.value}/pickers/${p.id}`, { method: 'DELETE' }),
  );
};

async function seedPickers(): Promise<void> {
  busy.seed = true;
  error.value = null;
  try {
    const res = await api.json<{
      stores: number;
      created: number;
      skipped: number;
      pinsReset: number;
      pin: string;
    }>(`/clients/${clientId.value}/pickers/seed`, {
      method: 'POST',
      body: { perStore: seedForm.perStore, pin: seedForm.pin, resetPins: seedForm.resetPins },
    });
    notice.value =
      `Seeded ${res.created} pickers across ${res.stores} stores (${res.skipped} existed` +
      `${res.pinsReset > 0 ? `, ${res.pinsReset} PINs reset` : ''}). PIN: ${res.pin}`;
    await loadPickers();
  } catch (err) {
    fail(err);
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
  <div class="max-w-5xl p-6">
    <PageHeader
      title="Pickers"
      subtitle="Pick-context staff — local identities bound to one store (staff code + PIN on the
        station). Suspension and store moves take effect within one session refresh (≤15 min)."
    />

    <UAlert v-if="error" :description="error" color="error" variant="soft" class="mb-3" />
    <UAlert v-if="notice" :description="notice" color="success" variant="soft" class="mb-3" />

    <div v-if="stores.length === 0" class="rounded-lg border border-neutral-200 bg-white p-6">
      <p class="text-sm text-neutral-500">
        No stores in the registry — set up stores first (Stores section), then manage pickers here.
      </p>
    </div>

    <template v-else>
      <div class="mb-4 flex items-center gap-3">
        <USelect
          v-model="selectedStore"
          :items="storeOptions"
          value-key="value"
          placeholder="Select a store…"
          class="w-96"
        />
        <span class="text-xs text-neutral-400">{{ pickers.length }} picker(s)</span>
      </div>

      <!-- Create -->
      <form
        class="mb-4 flex flex-wrap items-end gap-3 rounded-lg border border-neutral-200 bg-white p-4"
        @submit.prevent="createPicker"
      >
        <UFormField label="Name">
          <UInput v-model="createForm.displayName" placeholder="Thandi Nkosi" class="w-48" />
        </UFormField>
        <UFormField label="Staff code">
          <UInput v-model="createForm.staffCode" placeholder="P11" class="w-24 font-mono" />
        </UFormField>
        <UFormField label="PIN (4–8 digits)">
          <UInput v-model="createForm.pin" placeholder="123456" class="w-28 font-mono" />
        </UFormField>
        <UButton
          type="submit"
          :loading="busy.create"
          :disabled="!createForm.displayName || !createForm.staffCode || !createForm.pin"
        >
          Create picker
        </UButton>
      </form>

      <!-- Roster -->
      <div class="overflow-x-auto rounded-lg border border-neutral-200 bg-white">
        <table class="w-full text-sm">
          <thead>
            <tr class="bg-neutral-50 text-left text-xs font-semibold text-navy-700">
              <th class="px-3 py-2">Staff code</th>
              <th class="px-3 py-2">Name</th>
              <th class="px-3 py-2">Status</th>
              <th class="px-3 py-2">Move to store</th>
              <th class="px-3 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="p in pickers" :key="p.id" class="border-t border-neutral-100">
              <td class="px-3 py-2 font-mono">{{ p.staffCode }}</td>
              <td class="px-3 py-2">
                {{ p.displayName }}
                <span
                  v-if="p.role === 'supervisor'"
                  class="ml-1 rounded bg-brand-50 px-1.5 py-0.5 text-[10px] font-semibold text-brand-700"
                  title="Supervisor — station supervisor mode (car-or-larger flagging)"
                >
                  SUPERVISOR
                </span>
              </td>
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
              <td class="px-3 py-2">
                <div class="flex items-center gap-1">
                  <USelect
                    :model-value="reassignTo[p.id] ?? ''"
                    :items="storeOptions.filter((o) => o.value !== p.storeRef)"
                    value-key="value"
                    placeholder="store…"
                    size="xs"
                    class="w-44"
                    @update:model-value="(v: string) => (reassignTo[p.id] = v)"
                  />
                  <UButton
                    size="xs"
                    variant="soft"
                    :disabled="!reassignTo[p.id] || rowBusy === p.id"
                    @click="reassign(p)"
                  >
                    Move
                  </UButton>
                </div>
              </td>
              <td class="px-3 py-2">
                <div class="flex justify-end gap-1">
                  <UButton
                    v-if="p.status === 'active'"
                    size="xs"
                    color="warning"
                    variant="soft"
                    :loading="rowBusy === p.id"
                    @click="suspend(p)"
                  >
                    Suspend
                  </UButton>
                  <UButton
                    v-else
                    size="xs"
                    color="success"
                    variant="soft"
                    :loading="rowBusy === p.id"
                    @click="reactivate(p)"
                  >
                    Reactivate
                  </UButton>
                  <UButton
                    size="xs"
                    color="error"
                    variant="soft"
                    :disabled="rowBusy === p.id"
                    @click="remove(p)"
                  >
                    Delete
                  </UButton>
                </div>
              </td>
            </tr>
            <tr v-if="pickers.length === 0 && !busy.load">
              <td colspan="5" class="px-3 py-8 text-center text-neutral-400">
                No pickers for this store — create one above or seed below.
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Dev seeding -->
      <details class="mt-4 rounded-lg border border-dashed border-neutral-300 bg-white p-4">
        <summary class="cursor-pointer text-sm font-medium text-neutral-600">
          Dev tooling: bulk-seed test pickers
        </summary>
        <div class="mt-3 flex flex-wrap items-end gap-3">
          <UFormField label="Pickers per store">
            <UInput
              v-model.number="seedForm.perStore"
              type="number"
              :min="1"
              :max="50"
              class="w-24"
            />
          </UFormField>
          <UFormField label="Shared PIN">
            <UInput v-model="seedForm.pin" class="w-28 font-mono" />
          </UFormField>
          <UCheckbox
            v-model="seedForm.resetPins"
            label="Reset existing seeded pickers to this PIN"
          />
          <UButton :loading="busy.seed" variant="soft" @click="seedPickers">
            Seed all stores
          </UButton>
        </div>
      </details>
    </template>
  </div>
</template>
