<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { api, clientId } from '../context.js';
import { persistedFilter } from '../lib/persisted-filter.js';
import PageHeader from '../components/PageHeader.vue';
import FilterBar from '../components/table/FilterBar.vue';
import SortableTh, { type SortState } from '../components/table/SortableTh.vue';

interface StoreSummary {
  id: string;
  storeRef: string;
  name: string;
}

interface PrinterDto {
  id: string;
  clientId: string;
  storeRef: string;
  name: string;
  host: string;
  port: number;
  dpi: number;
  labelWidthMm: number;
  labelHeightMm: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

const printers = ref<PrinterDto[]>([]);
const stores = ref<StoreSummary[]>([]);
const filter = persistedFilter('printers', 'search', '');
/** Any-of store filter (client-side — the whole set is loaded anyway). */
const storeFilter = persistedFilter<string[]>('printers', 'stores', []);
const sort = persistedFilter<SortState>('printers', 'sort', { field: 'storeRef', dir: 'asc' });
const error = ref<string | null>(null);
const notice = ref<string | null>(null);
const loading = ref(false);
const saving = ref(false);
const rowBusy = ref<string | null>(null);

/** null = the form adds a printer; a printer id = it edits that row. */
const editingId = ref<string | null>(null);

const blankForm = () => ({
  storeRef: '',
  name: '',
  host: '',
  port: 9100,
  dpi: 203,
  labelWidthMm: 100,
  labelHeightMm: 75,
});
const form = reactive(blankForm());

const storeOptions = computed(() =>
  stores.value.map((s) => ({ label: `${s.storeRef} · ${s.name}`, value: s.storeRef })),
);
const dpiOptions = [203, 300, 600].map((d) => ({ label: `${d} dpi`, value: d }));
const storeNames = computed(() => new Map(stores.value.map((s) => [s.storeRef, s.name])));

function fail(err: unknown): void {
  error.value = err instanceof Error ? err.message : String(err);
}

async function loadStores(): Promise<void> {
  try {
    const res = await api.json<{ stores: StoreSummary[] }>(`/clients/${clientId.value}/stores`);
    stores.value = res.stores;
  } catch (err) {
    fail(err);
  }
}

async function loadPrinters(): Promise<void> {
  loading.value = true;
  error.value = null;
  try {
    const res = await api.json<{ printers: PrinterDto[] }>(`/clients/${clientId.value}/printers`);
    printers.value = res.printers;
  } catch (err) {
    fail(err);
  } finally {
    loading.value = false;
  }
}

function resetForm(): void {
  Object.assign(form, blankForm());
  editingId.value = null;
}

function startEdit(p: PrinterDto): void {
  editingId.value = p.id;
  Object.assign(form, {
    storeRef: p.storeRef,
    name: p.name,
    host: p.host,
    port: p.port,
    dpi: p.dpi,
    labelWidthMm: p.labelWidthMm,
    labelHeightMm: p.labelHeightMm,
  });
}

async function save(): Promise<void> {
  saving.value = true;
  error.value = null;
  try {
    const fields = {
      name: form.name.trim(),
      host: form.host.trim(),
      port: form.port,
      dpi: form.dpi,
      labelWidthMm: form.labelWidthMm,
      labelHeightMm: form.labelHeightMm,
    };
    if (editingId.value) {
      await api.json(`/clients/${clientId.value}/printers/${editingId.value}`, {
        method: 'PATCH',
        body: fields,
      });
      notice.value = `Updated ${fields.name}.`;
    } else {
      await api.json(`/clients/${clientId.value}/printers`, {
        method: 'POST',
        body: { storeRef: form.storeRef, ...fields },
      });
      notice.value = `Added ${fields.name} at ${form.storeRef}.`;
    }
    resetForm();
    await loadPrinters();
  } catch (err) {
    fail(err);
  } finally {
    saving.value = false;
  }
}

async function toggleActive(p: PrinterDto): Promise<void> {
  rowBusy.value = p.id;
  error.value = null;
  try {
    await api.json(`/clients/${clientId.value}/printers/${p.id}`, {
      method: 'PATCH',
      body: { active: !p.active },
    });
    await loadPrinters();
  } catch (err) {
    fail(err);
  } finally {
    rowBusy.value = null;
  }
}

async function remove(p: PrinterDto): Promise<void> {
  if (!window.confirm(`Delete printer "${p.name}" at ${p.storeRef}? This cannot be undone.`)) {
    return;
  }
  rowBusy.value = p.id;
  error.value = null;
  try {
    await api.json(`/clients/${clientId.value}/printers/${p.id}`, { method: 'DELETE' });
    notice.value = `Deleted ${p.name}.`;
    if (editingId.value === p.id) resetForm();
    await loadPrinters();
  } catch (err) {
    fail(err);
  } finally {
    rowBusy.value = null;
  }
}

const visible = computed<PrinterDto[]>(() => {
  const q = filter.value.trim().toLowerCase();
  const matches = printers.value.filter((p) => {
    if (storeFilter.value.length > 0 && !storeFilter.value.includes(p.storeRef)) return false;
    if (!q) return true;
    return [p.storeRef, storeNames.value.get(p.storeRef) ?? '', p.name].some((v) =>
      v.toLowerCase().includes(q),
    );
  });
  const key = (p: PrinterDto): string => (sort.value.field === 'name' ? p.name : p.storeRef);
  const flip = sort.value.dir === 'desc' ? -1 : 1;
  return [...matches].sort((a, b) => flip * key(a).localeCompare(key(b)) || a.name.localeCompare(b.name));
});

const activeFilterCount = computed(() => (storeFilter.value.length > 0 ? 1 : 0));
const hasActiveFilters = computed(
  () => activeFilterCount.value > 0 || filter.value.trim().length > 0,
);
function clearFilters(): void {
  filter.value = '';
  storeFilter.value = [];
}

onMounted(() => {
  void loadPrinters();
  void loadStores();
});
watch(clientId, () => {
  resetForm();
  void loadPrinters();
  void loadStores();
});
</script>

<template>
  <div class="max-w-5xl p-6">
    <PageHeader title="Printers">
      <template #subtitle>
        Store-bound label printers (ZPL over the LAN) — base equipment picking stations bind to for
        bag-label printing. The server renders the ZPL; the station delivers it, so
        <span class="font-mono">host:port</span> only needs to resolve on the store LAN.
      </template>
    </PageHeader>

    <UAlert v-if="error" :description="error" color="error" variant="soft" class="mb-3" />
    <UAlert v-if="notice" :description="notice" color="success" variant="soft" class="mb-3" />

    <!-- Add / edit (storeRef is immutable — delete and re-add to move equipment) -->
    <form
      class="mb-4 flex flex-wrap items-end gap-3 rounded-lg border border-neutral-200 bg-white p-4"
      @submit.prevent="save"
    >
      <UFormField label="Store">
        <USelect
          v-model="form.storeRef"
          :items="storeOptions"
          value-key="value"
          placeholder="Select a store…"
          :disabled="editingId !== null"
          class="w-64"
        />
      </UFormField>
      <UFormField label="Name">
        <UInput v-model="form.name" placeholder="Packing bench" class="w-40" />
      </UFormField>
      <UFormField label="Host">
        <UInput v-model="form.host" placeholder="192.168.0.50" class="w-40 font-mono" />
      </UFormField>
      <UFormField label="Port">
        <UInput v-model.number="form.port" type="number" :min="1" :max="65535" class="w-24" />
      </UFormField>
      <UFormField label="DPI">
        <USelect v-model="form.dpi" :items="dpiOptions" value-key="value" class="w-28" />
      </UFormField>
      <UFormField label="Label width (mm)">
        <UInput v-model.number="form.labelWidthMm" type="number" :min="1" class="w-24" />
      </UFormField>
      <UFormField label="Label height (mm)">
        <UInput v-model.number="form.labelHeightMm" type="number" :min="1" class="w-24" />
      </UFormField>
      <UButton
        type="submit"
        :loading="saving"
        :disabled="!form.storeRef || !form.name.trim() || !form.host.trim()"
      >
        {{ editingId ? 'Save changes' : 'Add printer' }}
      </UButton>
      <UButton v-if="editingId" variant="ghost" color="neutral" @click="resetForm">
        Cancel
      </UButton>
    </form>

    <FilterBar
      v-model:search="filter"
      show-search
      search-placeholder="Filter by store / printer name…"
      :active-count="activeFilterCount"
      :has-active="hasActiveFilters"
      @clear="clearFilters"
    >
      <template #filters>
        <div>
          <label class="mb-1 block text-xs font-medium text-neutral-500">Stores</label>
          <USelect
            v-model="storeFilter"
            multiple
            :items="storeOptions"
            value-key="value"
            placeholder="All stores"
            class="w-full"
          />
        </div>
      </template>
      <template #meta>
        {{
          visible.length === printers.length
            ? `${printers.length} registered`
            : `${visible.length} of ${printers.length}`
        }}
      </template>
    </FilterBar>

    <div class="overflow-x-auto rounded-lg border border-neutral-200 bg-white">
      <table class="w-full text-sm">
        <thead>
          <tr class="bg-neutral-50 text-left text-xs font-semibold text-navy-700">
            <SortableTh v-model="sort" field="storeRef" label="Store" />
            <SortableTh v-model="sort" field="name" label="Name" />
            <th class="px-3 py-2">Host:Port</th>
            <th class="px-3 py-2">DPI</th>
            <th class="px-3 py-2">Label size</th>
            <th class="px-3 py-2">Active</th>
            <th class="px-3 py-2 text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in visible" :key="p.id" class="border-t border-neutral-100">
            <td class="px-3 py-2">
              <span class="font-mono text-xs">{{ p.storeRef }}</span>
              <span v-if="storeNames.get(p.storeRef)" class="ml-1 text-neutral-500">
                {{ storeNames.get(p.storeRef) }}
              </span>
            </td>
            <td class="px-3 py-2">{{ p.name }}</td>
            <td class="px-3 py-2 font-mono text-xs">{{ p.host }}:{{ p.port }}</td>
            <td class="px-3 py-2 text-neutral-500">{{ p.dpi }}</td>
            <td class="px-3 py-2 text-neutral-500">
              {{ p.labelWidthMm }}×{{ p.labelHeightMm }} mm
            </td>
            <td class="px-3 py-2">
              <span
                class="rounded-full px-2 py-0.5 text-xs font-medium"
                :class="
                  p.active ? 'bg-emerald-50 text-emerald-700' : 'bg-neutral-100 text-neutral-500'
                "
              >
                {{ p.active ? 'active' : 'inactive' }}
              </span>
            </td>
            <td class="px-3 py-2">
              <div class="flex justify-end gap-1">
                <UButton
                  size="xs"
                  :color="p.active ? 'warning' : 'success'"
                  variant="soft"
                  :loading="rowBusy === p.id"
                  @click="toggleActive(p)"
                >
                  {{ p.active ? 'Deactivate' : 'Activate' }}
                </UButton>
                <UButton
                  size="xs"
                  variant="soft"
                  :disabled="rowBusy === p.id"
                  @click="startEdit(p)"
                >
                  Edit
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
          <tr v-if="visible.length === 0 && !loading">
            <td colspan="7" class="px-3 py-8 text-center text-neutral-400">
              {{
                printers.length === 0
                  ? "No printers yet — add the store's label printer above."
                  : 'No printers match the filters.'
              }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
