<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { api, clientId } from '../context.js';
import PageHeader from '../components/PageHeader.vue';

/**
 * Driver roster — transport-context staff, the PICKER pattern (decided
 * Andrew 2026-07-13): local identities (staff code + PIN) bound to a HOME
 * DEPOT (a registry store). No device pinning in v1 — device enrollment is
 * the shared phase-2 story with the picking plane.
 */
interface StoreSummary {
  id: string;
  storeRef: string;
  name: string;
  city: string | null;
  region: string | null;
}

interface DriverSummary {
  id: string;
  storeRef: string;
  displayName: string;
  staffCode: string;
  status: string;
  defaultVehicleReg: string | null;
}

const stores = ref<StoreSummary[]>([]);
const drivers = ref<DriverSummary[]>([]);
const selectedStore = ref<string>('');
const error = ref<string | null>(null);
const notice = ref<string | null>(null);
const busy = reactive({ seed: false, create: false, load: false });
const rowBusy = ref<string | null>(null);

// '374837' = DRIVER on a phone keypad — same convention as the pickers' FULFIL.
const seedForm = reactive({ perStore: 3, pin: '374837', resetPins: false });
const createForm = reactive({ displayName: '', staffCode: '', pin: '', vehicleReg: '' });
/** Per-row reassign target (driverId → storeRef). */
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

async function loadDrivers(): Promise<void> {
  if (!selectedStore.value) {
    drivers.value = [];
    return;
  }
  busy.load = true;
  try {
    const res = await api.json<{ drivers: DriverSummary[] }>(
      `/clients/${clientId.value}/drivers?store=${encodeURIComponent(selectedStore.value)}`,
    );
    drivers.value = res.drivers;
  } catch (err) {
    fail(err);
  } finally {
    busy.load = false;
  }
}

async function createDriver(): Promise<void> {
  busy.create = true;
  error.value = null;
  try {
    await api.json(`/clients/${clientId.value}/drivers`, {
      method: 'POST',
      body: {
        storeRef: selectedStore.value,
        displayName: createForm.displayName.trim(),
        staffCode: createForm.staffCode.trim(),
        pin: createForm.pin,
        ...(createForm.vehicleReg.trim()
          ? { defaultVehicleReg: createForm.vehicleReg.trim() }
          : {}),
      },
    });
    notice.value = `Created ${createForm.staffCode} at ${selectedStore.value}.`;
    createForm.displayName = '';
    createForm.staffCode = '';
    createForm.pin = '';
    createForm.vehicleReg = '';
    await loadDrivers();
  } catch (err) {
    fail(err);
  } finally {
    busy.create = false;
  }
}

async function rowAction(driver: DriverSummary, action: () => Promise<unknown>): Promise<void> {
  rowBusy.value = driver.id;
  error.value = null;
  try {
    await action();
    await loadDrivers();
  } catch (err) {
    fail(err);
  } finally {
    rowBusy.value = null;
  }
}

const suspend = (d: DriverSummary) =>
  rowAction(d, () =>
    api.json(`/clients/${clientId.value}/drivers/${d.id}/suspend`, { method: 'POST' }),
  );
const reactivate = (d: DriverSummary) =>
  rowAction(d, () =>
    api.json(`/clients/${clientId.value}/drivers/${d.id}/reactivate`, { method: 'POST' }),
  );
const reassign = (d: DriverSummary) => {
  const storeRef = reassignTo[d.id];
  if (!storeRef || storeRef === d.storeRef) return Promise.resolve();
  return rowAction(d, () =>
    api.json(`/clients/${clientId.value}/drivers/${d.id}/reassign`, {
      method: 'POST',
      body: { storeRef },
    }),
  );
};
const remove = (d: DriverSummary) => {
  // Suspend covers "off the roster"; delete is for mistakes — confirm it.
  if (!window.confirm(`Delete ${d.displayName} (${d.staffCode})? This cannot be undone.`)) {
    return Promise.resolve();
  }
  return rowAction(d, () =>
    api.json(`/clients/${clientId.value}/drivers/${d.id}`, { method: 'DELETE' }),
  );
};

async function seedDrivers(): Promise<void> {
  busy.seed = true;
  error.value = null;
  try {
    const res = await api.json<{
      stores: number;
      created: number;
      skipped: number;
      pinsReset: number;
      pin: string;
    }>(`/clients/${clientId.value}/drivers/seed`, {
      method: 'POST',
      body: { perStore: seedForm.perStore, pin: seedForm.pin, resetPins: seedForm.resetPins },
    });
    notice.value =
      `Seeded ${res.created} drivers across ${res.stores} depots (${res.skipped} existed` +
      `${res.pinsReset > 0 ? `, ${res.pinsReset} PINs reset` : ''}). PIN: ${res.pin}`;
    await loadDrivers();
  } catch (err) {
    fail(err);
  } finally {
    busy.seed = false;
  }
}

onMounted(() => {
  void loadStores().then(loadDrivers);
});
watch(clientId, () => {
  selectedStore.value = '';
  void loadStores().then(loadDrivers);
});
watch(selectedStore, () => void loadDrivers());
</script>

<template>
  <div class="max-w-5xl p-6">
    <PageHeader
      title="Drivers"
      subtitle="Transport-context staff — local identities bound to a home depot (staff code + PIN
        in the driver app, the picker pattern). Suspension and depot moves take effect within
        one session refresh."
    />

    <UAlert v-if="error" :description="error" color="error" variant="soft" class="mb-3" />
    <UAlert v-if="notice" :description="notice" color="success" variant="soft" class="mb-3" />

    <div v-if="stores.length === 0" class="rounded-lg border border-neutral-200 bg-white p-6">
      <p class="text-sm text-neutral-500">
        No stores in the registry — set up stores first (Stores section), then manage drivers here.
      </p>
    </div>

    <template v-else>
      <div class="mb-4 flex items-center gap-3">
        <USelect
          v-model="selectedStore"
          :items="storeOptions"
          value-key="value"
          placeholder="Select a depot…"
          class="w-96"
        />
        <span class="text-xs text-neutral-400">{{ drivers.length }} driver(s)</span>
      </div>

      <!-- Create -->
      <form
        class="mb-4 flex flex-wrap items-end gap-3 rounded-lg border border-neutral-200 bg-white p-4"
        @submit.prevent="createDriver"
      >
        <UFormField label="Name">
          <UInput v-model="createForm.displayName" placeholder="Sizwe Zulu" class="w-48" />
        </UFormField>
        <UFormField label="Staff code">
          <UInput v-model="createForm.staffCode" placeholder="D04" class="w-24 font-mono" />
        </UFormField>
        <UFormField label="PIN (4–8 digits)">
          <UInput v-model="createForm.pin" placeholder="374837" class="w-28 font-mono" />
        </UFormField>
        <UFormField label="Vehicle reg (optional)">
          <UInput v-model="createForm.vehicleReg" placeholder="ND 123-456" class="w-36 font-mono" />
        </UFormField>
        <UButton
          type="submit"
          :loading="busy.create"
          :disabled="!createForm.displayName || !createForm.staffCode || !createForm.pin"
        >
          Create driver
        </UButton>
      </form>

      <!-- Roster -->
      <div class="overflow-x-auto rounded-lg border border-neutral-200 bg-white">
        <table class="w-full text-sm">
          <thead>
            <tr class="bg-neutral-50 text-left text-xs font-semibold text-navy-700">
              <th class="px-3 py-2">Staff code</th>
              <th class="px-3 py-2">Name</th>
              <th class="px-3 py-2">Vehicle</th>
              <th class="px-3 py-2">Status</th>
              <th class="px-3 py-2">Move to depot</th>
              <th class="px-3 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="d in drivers" :key="d.id" class="border-t border-neutral-100">
              <td class="px-3 py-2 font-mono">{{ d.staffCode }}</td>
              <td class="px-3 py-2">{{ d.displayName }}</td>
              <td class="px-3 py-2 font-mono text-xs">{{ d.defaultVehicleReg ?? '—' }}</td>
              <td class="px-3 py-2">
                <span
                  class="rounded-full px-2 py-0.5 text-xs font-medium"
                  :class="
                    d.status === 'active'
                      ? 'bg-emerald-50 text-emerald-700'
                      : 'bg-neutral-100 text-neutral-500'
                  "
                >
                  {{ d.status }}
                </span>
              </td>
              <td class="px-3 py-2">
                <div class="flex items-center gap-1">
                  <USelect
                    :model-value="reassignTo[d.id] ?? ''"
                    :items="storeOptions.filter((o) => o.value !== d.storeRef)"
                    value-key="value"
                    placeholder="depot…"
                    size="xs"
                    class="w-44"
                    @update:model-value="(v: string) => (reassignTo[d.id] = v)"
                  />
                  <UButton
                    size="xs"
                    variant="soft"
                    :disabled="!reassignTo[d.id] || rowBusy === d.id"
                    @click="reassign(d)"
                  >
                    Move
                  </UButton>
                </div>
              </td>
              <td class="px-3 py-2">
                <div class="flex justify-end gap-1">
                  <UButton
                    v-if="d.status === 'active'"
                    size="xs"
                    color="warning"
                    variant="soft"
                    :loading="rowBusy === d.id"
                    @click="suspend(d)"
                  >
                    Suspend
                  </UButton>
                  <UButton
                    v-else
                    size="xs"
                    color="success"
                    variant="soft"
                    :loading="rowBusy === d.id"
                    @click="reactivate(d)"
                  >
                    Reactivate
                  </UButton>
                  <UButton
                    size="xs"
                    color="error"
                    variant="soft"
                    :disabled="rowBusy === d.id"
                    @click="remove(d)"
                  >
                    Delete
                  </UButton>
                </div>
              </td>
            </tr>
            <tr v-if="drivers.length === 0 && !busy.load">
              <td colspan="6" class="px-3 py-8 text-center text-neutral-400">
                No drivers for this depot — create one above or seed below.
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Dev seeding -->
      <details class="mt-4 rounded-lg border border-dashed border-neutral-300 bg-white p-4">
        <summary class="cursor-pointer text-sm font-medium text-neutral-600">
          Dev tooling: bulk-seed test drivers
        </summary>
        <div class="mt-3 flex flex-wrap items-end gap-3">
          <UFormField label="Drivers per depot">
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
            label="Reset existing seeded drivers to this PIN"
          />
          <UButton :loading="busy.seed" variant="soft" @click="seedDrivers">
            Seed all depots
          </UButton>
        </div>
      </details>
    </template>
  </div>
</template>
