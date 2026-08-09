<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { api, clientId } from '../context.js';
import { persistedFilter } from '../lib/persisted-filter.js';
import PageHeader from '../components/PageHeader.vue';
import SortableTh, { type SortState } from '../components/table/SortableTh.vue';

/**
 * Driver roster — transport-context staff, the PICKER pattern (decided
 * Andrew 2026-07-13): local identities (staff code + PIN) bound to a HOME
 * DEPOT (depots registry — a depot serves many stores; manage them under
 * Transport → Depots). No device pinning in v1 — device enrollment is the
 * shared phase-2 story with the picking plane.
 */
interface DepotSummary {
  depotRef: string;
  name: string;
  storeRefs: string[];
}

interface DriverSummary {
  id: string;
  depotRef: string;
  displayName: string;
  staffCode: string;
  status: string;
  defaultVehicleReg: string | null;
  defaultVehicleClass: string | null;
}

const depots = ref<DepotSummary[]>([]);
const vehicleClasses = ref<{ code: string; name: string }[]>([]);
const drivers = ref<DriverSummary[]>([]);
const selectedDepot = persistedFilter<string>('drivers', 'depot', '');
const rosterSearch = persistedFilter<string>('drivers', 'search', '');
// 'all' sentinel — reka-ui rejects '' select values.
const statusFilter = persistedFilter<string>('drivers', 'status', 'all');
const sort = persistedFilter<SortState>('drivers', 'sort', { field: 'staffCode', dir: 'asc' });
const statusOptions = [
  { label: 'All statuses', value: 'all' },
  { label: 'active', value: 'active' },
  { label: 'suspended', value: 'suspended' },
];

/** Client-side narrowing/sort — the roster is bounded per depot. */
const visibleDrivers = computed<DriverSummary[]>(() => {
  const q = rosterSearch.value.trim().toLowerCase();
  const matches = drivers.value.filter((d) => {
    if (statusFilter.value !== 'all' && d.status !== statusFilter.value) return false;
    if (!q) return true;
    return [d.displayName, d.staffCode].some((v) => v.toLowerCase().includes(q));
  });
  const key = (d: DriverSummary): string => {
    switch (sort.value.field) {
      case 'displayName':
        return d.displayName;
      case 'status':
        return d.status;
      default:
        return d.staffCode;
    }
  };
  const flip = sort.value.dir === 'desc' ? -1 : 1;
  return [...matches].sort((a, b) => flip * key(a).localeCompare(key(b)));
});
const error = ref<string | null>(null);
const notice = ref<string | null>(null);
const busy = reactive({ seed: false, create: false, load: false });
const rowBusy = ref<string | null>(null);

// '374837' = DRIVER on a phone keypad — same convention as the pickers' FULFIL.
const seedForm = reactive({ perDepot: 3, pin: '374837', resetPins: false });
const NO_CLASS = '__none__'; // reka-ui rejects '' select values
const createForm = reactive({
  displayName: '',
  staffCode: '',
  pin: '',
  vehicleReg: '',
  vehicleClass: NO_CLASS,
});
/** Per-row reassign target (driverId → depotRef). */
const reassignTo = reactive<Record<string, string>>({});

const depotOptions = computed(() =>
  depots.value.map((d) => ({
    label: `${d.depotRef} · ${d.name} (${d.storeRefs.length} stores)`,
    value: d.depotRef,
  })),
);
const classOptions = computed(() => [
  { label: 'No class', value: NO_CLASS },
  ...vehicleClasses.value.map((c) => ({ label: c.name, value: c.code })),
]);

function fail(err: unknown): void {
  error.value = err instanceof Error ? err.message : String(err);
}

async function loadDepots(): Promise<void> {
  error.value = null;
  try {
    const res = await api.json<{ depots: DepotSummary[] }>(`/clients/${clientId.value}/depots`);
    depots.value = res.depots;
    // Unset OR a remembered depot that no longer exists → first available.
    const known = res.depots.some((d) => d.depotRef === selectedDepot.value);
    if (!known && res.depots.length > 0) {
      selectedDepot.value = res.depots[0]!.depotRef;
    }
    const cfg = await api.json<{ settings: Record<string, unknown> }>(
      `/clients/${clientId.value}/config/client-settings`,
    );
    const classes = cfg.settings['vehicleClasses'];
    vehicleClasses.value = Array.isArray(classes)
      ? (classes as { code: string; name: string }[])
      : [];
  } catch (err) {
    fail(err);
  }
}

async function loadDrivers(): Promise<void> {
  if (!selectedDepot.value) {
    drivers.value = [];
    return;
  }
  busy.load = true;
  try {
    const res = await api.json<{ drivers: DriverSummary[] }>(
      `/clients/${clientId.value}/drivers?depot=${encodeURIComponent(selectedDepot.value)}`,
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
        depotRef: selectedDepot.value,
        displayName: createForm.displayName.trim(),
        staffCode: createForm.staffCode.trim(),
        pin: createForm.pin,
        ...(createForm.vehicleReg.trim()
          ? { defaultVehicleReg: createForm.vehicleReg.trim() }
          : {}),
        ...(createForm.vehicleClass !== NO_CLASS
          ? { defaultVehicleClass: createForm.vehicleClass }
          : {}),
      },
    });
    notice.value = `Created ${createForm.staffCode} at ${selectedDepot.value}.`;
    createForm.displayName = '';
    createForm.staffCode = '';
    createForm.pin = '';
    createForm.vehicleReg = '';
    createForm.vehicleClass = NO_CLASS;
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
  const depotRef = reassignTo[d.id];
  if (!depotRef || depotRef === d.depotRef) return Promise.resolve();
  return rowAction(d, () =>
    api.json(`/clients/${clientId.value}/drivers/${d.id}/reassign`, {
      method: 'POST',
      body: { depotRef },
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
      depots: number;
      created: number;
      skipped: number;
      pinsReset: number;
      pin: string;
    }>(`/clients/${clientId.value}/drivers/seed`, {
      method: 'POST',
      body: { perDepot: seedForm.perDepot, pin: seedForm.pin, resetPins: seedForm.resetPins },
    });
    notice.value =
      `Seeded ${res.created} drivers across ${res.depots} depots (${res.skipped} existed` +
      `${res.pinsReset > 0 ? `, ${res.pinsReset} PINs reset` : ''}). PIN: ${res.pin}`;
    await loadDrivers();
  } catch (err) {
    fail(err);
  } finally {
    busy.seed = false;
  }
}

onMounted(() => {
  void loadDepots().then(loadDrivers);
});
watch(clientId, () => {
  selectedDepot.value = '';
  void loadDepots().then(loadDrivers);
});
watch(selectedDepot, () => void loadDrivers());
</script>

<template>
  <div class="max-w-5xl p-6">
    <PageHeader
      title="Drivers"
      subtitle="Transport-context staff — local identities bound to a home depot (staff code + PIN
        in the driver app, the picker pattern). A depot serves many stores — manage depots under
        Transport → Depots. Suspension and depot moves bite within one session refresh."
    />

    <UAlert v-if="error" :description="error" color="error" variant="soft" class="mb-3" />
    <UAlert v-if="notice" :description="notice" color="success" variant="soft" class="mb-3" />

    <div v-if="depots.length === 0" class="rounded-lg border border-neutral-200 bg-white p-6">
      <p class="text-sm text-neutral-500">
        No depots in the registry — create them under Transport → Depots (or use its seed tooling),
        then manage drivers here.
      </p>
    </div>

    <template v-else>
      <div class="mb-4 flex flex-wrap items-center gap-3">
        <USelect
          v-model="selectedDepot"
          :items="depotOptions"
          value-key="value"
          placeholder="Select a depot…"
          class="w-96"
        />
        <UInput
          v-model="rosterSearch"
          icon="i-lucide-search"
          placeholder="Name or staff code…"
          class="w-52"
        />
        <USelect v-model="statusFilter" :items="statusOptions" value-key="value" class="w-36" />
        <span class="text-xs text-neutral-400">
          {{
            visibleDrivers.length === drivers.length
              ? `${drivers.length} driver(s)`
              : `${visibleDrivers.length} of ${drivers.length}`
          }}
        </span>
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
        <UFormField label="Vehicle class">
          <USelect
            v-model="createForm.vehicleClass"
            :items="classOptions"
            value-key="value"
            class="w-36"
          />
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
              <SortableTh v-model="sort" field="staffCode" label="Staff code" />
              <SortableTh v-model="sort" field="displayName" label="Name" />
              <th class="px-3 py-2">Vehicle</th>
              <th class="px-3 py-2">Class</th>
              <SortableTh v-model="sort" field="status" label="Status" />
              <th class="px-3 py-2">Move to depot</th>
              <th class="px-3 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="d in visibleDrivers" :key="d.id" class="border-t border-neutral-100">
              <td class="px-3 py-2 font-mono">{{ d.staffCode }}</td>
              <td class="px-3 py-2">{{ d.displayName }}</td>
              <td class="px-3 py-2 font-mono text-xs">{{ d.defaultVehicleReg ?? '—' }}</td>
              <td class="px-3 py-2 text-xs">{{ d.defaultVehicleClass ?? '—' }}</td>
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
                    :items="depotOptions.filter((o) => o.value !== d.depotRef)"
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
            <tr v-if="visibleDrivers.length === 0 && !busy.load">
              <td colspan="7" class="px-3 py-8 text-center text-neutral-400">
                {{
                  drivers.length === 0
                    ? 'No drivers for this depot — create one above or seed below.'
                    : 'No drivers match the filters.'
                }}
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
              v-model.number="seedForm.perDepot"
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
