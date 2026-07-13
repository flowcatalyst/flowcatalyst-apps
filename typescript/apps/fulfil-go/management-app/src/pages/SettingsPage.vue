<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { api, clientId } from '../context.js';
import PageHeader from '../components/PageHeader.vue';

/**
 * Store profiles — layered operational settings. The 'default' profile IS
 * the global config; other profiles override it selectively; stores link
 * to a profile on the Stores page (field-level per-store overrides exist
 * in the API, UI later). Empty input = inherit (placeholder shows the
 * inherited value).
 */
interface Profile {
  code: string;
  name: string;
  /** Numeric fields edited here; execution-system fields (string/string[])
   *  are API-set for now and must survive a UI save untouched. */
  settings: Record<string, unknown>;
}

const FIELDS: Array<{ key: string; label: string; help: string }> = [
  {
    key: 'pickLeadTimeMinutesDelivery',
    label: 'Pick lead time — delivery (min)',
    help: 'Minutes before slot start that delivery parts release to picking.',
  },
  {
    key: 'pickLeadTimeMinutesCollect',
    label: 'Pick lead time — collect (min)',
    help: 'Minutes before slot start that collection parts release to picking.',
  },
  {
    key: 'pickClaimSlaMinutes',
    label: 'Claim SLA (min)',
    help: 'Flightboard: a requested pick unclaimed longer than this is late.',
  },
  {
    key: 'pickClaimUrgentBeforeSlotMinutes',
    label: 'Claim urgency window (min)',
    help: 'Flightboard: unclaimed with less than this to slot start is urgent.',
  },
  {
    key: 'pickingDeadlineBeforeSlotMinutes',
    label: 'Picking deadline buffer (min)',
    help: 'Flightboard: claimed but incomplete with less than this to slot start is late.',
  },
  {
    key: 'releaseOverdueMinutes',
    label: 'Release overdue after (min)',
    help: 'Flightboard: a pending part this long past release time means the cron missed it.',
  },
];

/** Pick sort algorithm — the one non-numeric field this page edits.
 *  '' = inherit (field omitted from the profile's settings on save). */
const SORT_ALGORITHMS = [
  { label: 'Walk sequence (planogram walk order)', value: 'walk-sequence' },
  { label: 'Aisle → bay → shelf', value: 'aisle-bay-shelf' },
  { label: 'As received (upstream order)', value: 'as-received' },
];

const defaults = ref<Record<string, unknown>>({});
const profiles = ref<Profile[]>([]);
const selectedCode = ref('default');
const form = reactive<Record<string, number | ''>>({});
/** Separate from the numeric FIELDS loop — string-valued select. */
const formPickSort = ref<string>('');
const formName = ref('');
const newProfile = reactive({ code: '', name: '' });
const busy = ref(false);
const error = ref<string | null>(null);
const notice = ref<string | null>(null);

const selected = computed(() => profiles.value.find((p) => p.code === selectedCode.value));
const defaultProfile = computed(() => profiles.value.find((p) => p.code === 'default'));

/** Placeholder = what the field inherits when left empty on THIS profile. */
function inheritedValue(key: string): number {
  if (selectedCode.value !== 'default') {
    const fromDefault = defaultProfile.value?.settings[key];
    if (typeof fromDefault === 'number') return fromDefault;
  }
  const fallback = defaults.value[key];
  return typeof fallback === 'number' ? fallback : 0;
}

/** What pickSortAlgorithm inherits when unset on THIS profile. */
const inheritedPickSort = computed<string>(() => {
  if (selectedCode.value !== 'default') {
    const fromDefault = defaultProfile.value?.settings['pickSortAlgorithm'];
    if (typeof fromDefault === 'string') return fromDefault;
  }
  const fallback = defaults.value['pickSortAlgorithm'];
  return typeof fallback === 'string' ? fallback : 'walk-sequence';
});

function loadForm(): void {
  const settings = selected.value?.settings ?? {};
  for (const field of FIELDS) {
    const value = settings[field.key];
    form[field.key] = typeof value === 'number' ? value : '';
  }
  const sort = settings['pickSortAlgorithm'];
  formPickSort.value = typeof sort === 'string' ? sort : '';
  formName.value = selected.value?.name ?? selectedCode.value;
}

async function load(): Promise<void> {
  error.value = null;
  try {
    const res = await api.json<{ defaults: Record<string, number>; profiles: Profile[] }>(
      `/clients/${clientId.value}/config/store-profiles`,
    );
    defaults.value = res.defaults;
    profiles.value = res.profiles;
    if (!res.profiles.some((p) => p.code === selectedCode.value)) selectedCode.value = 'default';
    loadForm();
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  }
}

async function save(): Promise<void> {
  busy.value = true;
  error.value = null;
  try {
    // Start from the saved settings so API-set fields the UI doesn't edit
    // (executionSystems / defaultExecutionSystem) survive the PUT replace.
    const settings: Record<string, unknown> = { ...selected.value?.settings };
    for (const field of FIELDS) {
      const value = form[field.key];
      if (value !== '' && value !== undefined) settings[field.key] = Number(value);
      else delete settings[field.key];
    }
    if (formPickSort.value !== '') settings['pickSortAlgorithm'] = formPickSort.value;
    else delete settings['pickSortAlgorithm'];
    await api.json(`/clients/${clientId.value}/config/store-profiles/${selectedCode.value}`, {
      method: 'PUT',
      body: { name: formName.value || selectedCode.value, settings },
    });
    notice.value = `Saved '${selectedCode.value}'.`;
    await load();
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    busy.value = false;
  }
}

async function createProfile(): Promise<void> {
  if (!newProfile.code) return;
  busy.value = true;
  error.value = null;
  try {
    await api.json(`/clients/${clientId.value}/config/store-profiles/${newProfile.code}`, {
      method: 'PUT',
      body: { name: newProfile.name || newProfile.code, settings: {} },
    });
    selectedCode.value = newProfile.code;
    newProfile.code = '';
    newProfile.name = '';
    await load();
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    busy.value = false;
  }
}

onMounted(() => void load());
watch(clientId, () => void load());
watch(selectedCode, loadForm);
</script>

<template>
  <div class="mx-auto max-w-4xl p-6">
    <PageHeader
      title="Store profiles"
      subtitle="Operational settings, layered: defaults → 'default' profile (the global config) →
        profile → per-store overrides. Empty fields inherit — placeholders show the inherited
        value. Process settings hydrate onto fulfilments at creation; flightboard SLAs apply
        live."
    />

    <UAlert v-if="error" :description="error" color="error" variant="soft" class="mb-3" />
    <UAlert v-if="notice" :description="notice" color="success" variant="soft" class="mb-3" />

    <div class="flex gap-6">
      <!-- Profile list -->
      <aside class="w-56 shrink-0">
        <p class="mb-2 text-[11px] font-semibold uppercase tracking-wide text-neutral-400">
          Profiles
        </p>
        <div class="flex flex-col gap-1">
          <button
            v-for="p in profiles"
            :key="p.code"
            type="button"
            class="rounded-md px-3 py-2 text-left text-sm transition-colors"
            :class="
              p.code === selectedCode
                ? 'bg-brand-50 font-medium text-brand-700'
                : 'text-neutral-600 hover:bg-neutral-100'
            "
            @click="selectedCode = p.code"
          >
            {{ p.name }}
            <span class="block font-mono text-[11px] text-neutral-400">{{ p.code }}</span>
          </button>
        </div>

        <form
          class="mt-4 flex flex-col gap-2 border-t border-neutral-200 pt-3"
          @submit.prevent="createProfile"
        >
          <p class="text-[11px] font-semibold uppercase tracking-wide text-neutral-400">
            New profile
          </p>
          <UInput
            v-model="newProfile.code"
            placeholder="code (kebab-case)"
            size="sm"
            class="font-mono"
          />
          <UInput v-model="newProfile.name" placeholder="Name" size="sm" />
          <UButton
            type="submit"
            size="sm"
            variant="soft"
            :disabled="!newProfile.code"
            :loading="busy"
          >
            Create
          </UButton>
        </form>
      </aside>

      <!-- Editor -->
      <section class="min-w-0 flex-1 rounded-lg border border-neutral-200 bg-white p-5">
        <div class="mb-4 flex items-center justify-between gap-3">
          <UFormField label="Profile name" class="flex-1">
            <UInput v-model="formName" class="w-64" />
          </UFormField>
          <UButton :loading="busy" @click="save">Save profile</UButton>
        </div>
        <p v-if="selectedCode === 'default'" class="mb-4 text-xs text-neutral-500">
          This is the <span class="font-semibold">global configuration</span> — every store inherits
          it unless a different profile or a store override says otherwise.
        </p>

        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <UFormField
            v-for="field in FIELDS"
            :key="field.key"
            :label="field.label"
            :help="field.help"
          >
            <UInput
              :model-value="form[field.key] ?? ''"
              type="number"
              :min="0"
              :placeholder="`${inheritedValue(field.key)} (inherited)`"
              class="w-40"
              @update:model-value="
                (v: string | number | null) =>
                  (form[field.key] = v === '' || v === null ? '' : Number(v))
              "
            />
          </UFormField>

          <UFormField
            label="Pick sort algorithm"
            help="How the station orders pick lines. Captured onto each pick at intake — a change
              affects new picks only, never a picker mid-trolley."
          >
            <USelect
              v-model="formPickSort"
              :items="[{ label: `Inherit (${inheritedPickSort})`, value: '' }, ...SORT_ALGORITHMS]"
              class="w-64"
            />
          </UFormField>
        </div>
      </section>
    </div>
  </div>
</template>
