<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { api, clientId } from '../context.js';
import { osmUrl } from '../lib/geo.js';
import PageHeader from '../components/PageHeader.vue';

/**
 * Depot registry — transport topology, independent of stores (Andrew,
 * 2026-07-13: no 1:1 depot↔store). A depot is where drivers are based; the
 * store links say which stores it serves — the driver's offer feed spans
 * all of them. For EPOD-adopted clients the ref should equal EPOD's depot
 * reference so their claim proxy resolves directly.
 */
interface StoreSummary {
  storeRef: string;
  name: string;
  city: string | null;
}

interface DepotSummary {
  depotRef: string;
  name: string;
  geo: { lat: number; lng: number } | null;
  storeRefs: string[];
}

const stores = ref<StoreSummary[]>([]);
const depots = ref<DepotSummary[]>([]);
const error = ref<string | null>(null);
const notice = ref<string | null>(null);
const busy = reactive({ load: false, save: false, seed: false });
const rowBusy = ref<string | null>(null);

/** Create/edit form — editing loads an existing depot into it. */
const form = reactive({ depotRef: '', name: '', storeRefs: [] as string[] });
const editing = ref<string | null>(null);

const storeOptions = computed(() =>
  stores.value.map((s) => ({ label: `${s.storeRef} · ${s.name}`, value: s.storeRef })),
);
const storeNames = computed(() => new Map(stores.value.map((s) => [s.storeRef, s.name])));

function fail(err: unknown): void {
  error.value = err instanceof Error ? err.message : String(err);
}

async function load(): Promise<void> {
  busy.load = true;
  error.value = null;
  try {
    const [storeRes, depotRes] = await Promise.all([
      api.json<{ stores: StoreSummary[] }>(`/clients/${clientId.value}/stores`),
      api.json<{ depots: DepotSummary[] }>(`/clients/${clientId.value}/depots`),
    ]);
    stores.value = storeRes.stores;
    depots.value = depotRes.depots;
  } catch (err) {
    fail(err);
  } finally {
    busy.load = false;
  }
}

function startEdit(depot: DepotSummary): void {
  editing.value = depot.depotRef;
  form.depotRef = depot.depotRef;
  form.name = depot.name;
  form.storeRefs = [...depot.storeRefs];
}

function resetForm(): void {
  editing.value = null;
  form.depotRef = '';
  form.name = '';
  form.storeRefs = [];
}

async function save(): Promise<void> {
  busy.save = true;
  error.value = null;
  try {
    await api.json(
      `/clients/${clientId.value}/depots/${encodeURIComponent(form.depotRef.trim())}`,
      {
        method: 'PUT',
        body: { name: form.name.trim(), storeRefs: form.storeRefs },
      },
    );
    notice.value = `${editing.value ? 'Updated' : 'Created'} depot ${form.depotRef.trim()} (${form.storeRefs.length} stores).`;
    resetForm();
    await load();
  } catch (err) {
    fail(err);
  } finally {
    busy.save = false;
  }
}

async function removeDepot(depot: DepotSummary): Promise<void> {
  if (!window.confirm(`Delete depot ${depot.depotRef}? Drivers must be reassigned first.`)) return;
  rowBusy.value = depot.depotRef;
  error.value = null;
  try {
    await api.json(`/clients/${clientId.value}/depots/${encodeURIComponent(depot.depotRef)}`, {
      method: 'DELETE',
    });
    if (editing.value === depot.depotRef) resetForm();
    await load();
  } catch (err) {
    fail(err);
  } finally {
    rowBusy.value = null;
  }
}

async function seedFromCities(): Promise<void> {
  busy.seed = true;
  error.value = null;
  try {
    const res = await api.json<{ depots: number; stores: number }>(
      `/clients/${clientId.value}/depots/seed`,
      { method: 'POST', body: {} },
    );
    notice.value = `Seeded ${res.depots} depots (one per city) covering ${res.stores} stores.`;
    await load();
  } catch (err) {
    fail(err);
  } finally {
    busy.seed = false;
  }
}

onMounted(() => void load());
watch(clientId, () => {
  resetForm();
  void load();
});
</script>

<template>
  <div class="max-w-5xl p-6">
    <PageHeader
      title="Depots"
      subtitle="Where drivers are based. Each depot serves one or more stores — the driver's offer
        feed spans all of them. For EPOD clients, use EPOD's depot reference as the ref."
    />

    <UAlert v-if="error" :description="error" color="error" variant="soft" class="mb-3" />
    <UAlert v-if="notice" :description="notice" color="success" variant="soft" class="mb-3" />

    <!-- Create / edit -->
    <form
      class="mb-4 flex flex-wrap items-end gap-3 rounded-lg border border-neutral-200 bg-white p-4"
      @submit.prevent="save"
    >
      <UFormField label="Depot ref">
        <UInput
          v-model="form.depotRef"
          placeholder="dep-bloemfontein"
          class="w-48 font-mono"
          :disabled="editing !== null"
        />
      </UFormField>
      <UFormField label="Name">
        <UInput v-model="form.name" placeholder="Bloemfontein Depot" class="w-56" />
      </UFormField>
      <UFormField label="Serves stores">
        <USelect
          v-model="form.storeRefs"
          multiple
          :items="storeOptions"
          value-key="value"
          placeholder="Pick stores…"
          class="w-80"
        />
      </UFormField>
      <UButton
        type="submit"
        :loading="busy.save"
        :disabled="!form.depotRef.trim() || !form.name.trim()"
      >
        {{ editing ? 'Save depot' : 'Create depot' }}
      </UButton>
      <UButton v-if="editing" color="neutral" variant="ghost" @click="resetForm">Cancel</UButton>
    </form>

    <!-- Registry -->
    <div class="overflow-x-auto rounded-lg border border-neutral-200 bg-white">
      <table class="w-full text-sm">
        <thead>
          <tr class="bg-neutral-50 text-left text-xs font-semibold text-navy-700">
            <th class="px-3 py-2">Ref</th>
            <th class="px-3 py-2">Name</th>
            <th class="px-3 py-2">Serves</th>
            <th class="px-3 py-2">Map</th>
            <th class="px-3 py-2 text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="d in depots" :key="d.depotRef" class="border-t border-neutral-100 align-top">
            <td class="px-3 py-2 font-mono text-xs">{{ d.depotRef }}</td>
            <td class="px-3 py-2">{{ d.name }}</td>
            <td class="px-3 py-2 text-xs">
              <span v-if="d.storeRefs.length === 0" class="text-amber-600">no stores linked</span>
              <span v-else class="flex flex-wrap gap-1">
                <span
                  v-for="ref in d.storeRefs"
                  :key="ref"
                  class="rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-[11px] text-neutral-600"
                  :title="storeNames.get(ref)"
                >
                  {{ ref }}
                </span>
              </span>
            </td>
            <td class="px-3 py-2">
              <a
                v-if="d.geo"
                :href="osmUrl(d.geo.lat, d.geo.lng)"
                target="_blank"
                rel="noopener"
                class="inline-flex items-center gap-1 text-xs text-brand-600 hover:underline"
                :title="`${d.geo.lat.toFixed(5)}, ${d.geo.lng.toFixed(5)}`"
              >
                <UIcon name="i-lucide-map-pin" class="size-3.5" />
                Map
              </a>
              <span v-else class="text-xs text-neutral-300">—</span>
            </td>
            <td class="px-3 py-2">
              <div class="flex justify-end gap-1">
                <UButton size="xs" variant="soft" @click="startEdit(d)">Edit</UButton>
                <UButton
                  size="xs"
                  color="error"
                  variant="soft"
                  :loading="rowBusy === d.depotRef"
                  @click="removeDepot(d)"
                >
                  Delete
                </UButton>
              </div>
            </td>
          </tr>
          <tr v-if="depots.length === 0 && !busy.load">
            <td colspan="5" class="px-3 py-8 text-center text-neutral-400">
              No depots yet — create one above or seed from store cities below.
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Dev seeding -->
    <details class="mt-4 rounded-lg border border-dashed border-neutral-300 bg-white p-4">
      <summary class="cursor-pointer text-sm font-medium text-neutral-600">
        Dev tooling: seed depots from store cities
      </summary>
      <div class="mt-3 flex items-center gap-3">
        <p class="text-xs text-neutral-500">
          One depot per city, serving that city's stores — idempotent (re-runs re-link).
        </p>
        <UButton :loading="busy.seed" variant="soft" @click="seedFromCities">Seed depots</UButton>
      </div>
    </details>
  </div>
</template>
