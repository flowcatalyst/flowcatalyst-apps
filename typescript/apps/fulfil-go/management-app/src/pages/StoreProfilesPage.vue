<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { api, clientId } from '../context.js';
import PageHeader from '../components/PageHeader.vue';

/**
 * Store profiles for ONE owning domain — layered operational settings. The
 * 'default' profile IS that domain's global config; other profiles override
 * it selectively; stores link to a profile per domain on the Stores page
 * (field-level per-store overrides exist in the API, UI later). Empty
 * input = inherit (placeholder shows the inherited value).
 *
 * Two instances of this page exist: Picking → Pick profiles and
 * Transport → Transport profiles (Andrew, 2026-07-13 split).
 */
const props = defineProps<{ domain: 'pick' | 'transport' }>();

interface Profile {
  code: string;
  name: string;
  settings: Record<string, unknown>;
}

interface NumberFieldDef {
  key: string;
  label: string;
  help: string;
}

const PICK_FIELDS: NumberFieldDef[] = [
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

const TRANSPORT_FIELDS: NumberFieldDef[] = [
  {
    key: 'transportLeadTimeMinutes',
    label: 'Transport lead time (min)',
    help: 'STANDARD service level requests transport this long before slot start.',
  },
];

/** Pick sort — '' = inherit (field omitted from the profile on save). */
const SORT_ALGORITHMS = [
  { label: 'Walk sequence (planogram walk order)', value: 'walk-sequence' },
  { label: 'Aisle → bay → shelf', value: 'aisle-bay-shelf' },
  { label: 'Temperature zones (ambient → chilled → frozen → hot)', value: 'temperature-zone' },
  { label: 'As received (upstream order)', value: 'as-received' },
];

/** Known execution systems — free codes; the common ones get a select. */
const EXECUTION_SYSTEMS = [
  { label: 'FulfilGo execution app', value: 'own' },
  { label: 'EPOD (Integral driver app)', value: 'epod' },
];

const title = computed(() => (props.domain === 'pick' ? 'Pick profiles' : 'Transport profiles'));
const numberFields = computed(() => (props.domain === 'pick' ? PICK_FIELDS : TRANSPORT_FIELDS));

const defaults = ref<Record<string, unknown>>({});
const profiles = ref<Profile[]>([]);
const selectedCode = ref('default');
const form = reactive<Record<string, number | ''>>({});
/** String-valued fields (selects / free text); '' = inherit. */
const formPickSort = ref<string>('');
const formDefaultExec = ref<string>('');
const formExecAlternatives = ref<string>('');
const formDefaultProvider = ref<string>('');
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

function inheritedString(key: string, codeFallback: string): string {
  if (selectedCode.value !== 'default') {
    const fromDefault = defaultProfile.value?.settings[key];
    if (typeof fromDefault === 'string') return fromDefault;
  }
  const fallback = defaults.value[key];
  return typeof fallback === 'string' ? fallback : codeFallback;
}

function loadForm(): void {
  const settings = selected.value?.settings ?? {};
  for (const field of numberFields.value) {
    const value = settings[field.key];
    form[field.key] = typeof value === 'number' ? value : '';
  }
  const sort = settings['pickSortAlgorithm'];
  formPickSort.value = typeof sort === 'string' ? sort : '';
  const exec = settings['defaultExecutionSystem'];
  formDefaultExec.value = typeof exec === 'string' ? exec : '';
  const alts = settings['executionSystems'];
  formExecAlternatives.value = Array.isArray(alts) ? alts.join(', ') : '';
  const provider = settings['defaultTransportProvider'];
  formDefaultProvider.value = typeof provider === 'string' ? provider : '';
  formName.value = selected.value?.name ?? selectedCode.value;
}

async function load(): Promise<void> {
  error.value = null;
  try {
    const res = await api.json<{ defaults: Record<string, unknown>; profiles: Profile[] }>(
      `/clients/${clientId.value}/config/${props.domain}/store-profiles`,
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
  notice.value = null;
  try {
    // Start from the saved settings so API-set fields the UI doesn't edit
    // (e.g. transportProviders entries) survive the PUT replace.
    const settings: Record<string, unknown> = { ...selected.value?.settings };
    for (const field of numberFields.value) {
      const value = form[field.key];
      if (value !== '' && value !== undefined) settings[field.key] = Number(value);
      else delete settings[field.key];
    }
    if (props.domain === 'pick') {
      if (formPickSort.value !== '') settings['pickSortAlgorithm'] = formPickSort.value;
      else delete settings['pickSortAlgorithm'];
    } else {
      if (formDefaultExec.value !== '') {
        settings['defaultExecutionSystem'] = formDefaultExec.value;
      } else {
        delete settings['defaultExecutionSystem'];
      }
      const alternatives = formExecAlternatives.value
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      if (alternatives.length > 0) settings['executionSystems'] = alternatives;
      else delete settings['executionSystems'];
      if (formDefaultProvider.value !== '') {
        settings['defaultTransportProvider'] = formDefaultProvider.value;
      } else {
        delete settings['defaultTransportProvider'];
      }
    }
    await api.json(
      `/clients/${clientId.value}/config/${props.domain}/store-profiles/${selectedCode.value}`,
      {
        method: 'PUT',
        body: { name: formName.value || selectedCode.value, settings },
      },
    );
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
    await api.json(
      `/clients/${clientId.value}/config/${props.domain}/store-profiles/${newProfile.code}`,
      {
        method: 'PUT',
        body: { name: newProfile.name || newProfile.code, settings: {} },
      },
    );
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
watch(() => props.domain, () => void load());
</script>

<template>
  <div class="max-w-4xl p-6">
    <PageHeader
      :title="title"
      :subtitle="`${domain === 'pick' ? 'Picking' : 'Transport'} settings, layered: defaults →
        'default' profile (the global config) → profile → per-store overrides. Empty fields
        inherit — placeholders show the inherited value.`"
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
            v-for="field in numberFields"
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
            v-if="domain === 'pick'"
            label="Pick sort algorithm"
            help="How the station orders pick lines. Captured onto each pick at intake — a change
              affects new picks only, never a picker mid-trolley."
          >
            <USelect
              v-model="formPickSort"
              :items="[
                { label: `Inherit (${inheritedString('pickSortAlgorithm', 'walk-sequence')})`, value: '' },
                ...SORT_ALGORITHMS,
              ]"
              class="w-64"
            />
          </UFormField>

          <template v-if="domain === 'transport'">
            <UFormField
              label="Default execution system"
              help="The system transport defaults to for this store's work."
            >
              <USelect
                v-model="formDefaultExec"
                :items="[
                  {
                    label: `Inherit (${inheritedString('defaultExecutionSystem', 'none')})`,
                    value: '',
                  },
                  ...EXECUTION_SYSTEMS,
                ]"
                class="w-64"
              />
            </UFormField>
            <UFormField
              label="Alternative execution systems"
              help="Comma-separated codes also allowed at this store (e.g. own, epod)."
            >
              <UInput v-model="formExecAlternatives" placeholder="own, epod" class="w-64 font-mono" />
            </UFormField>
            <UFormField
              label="Default transport provider"
              help="Provider the resolver ranks first when it is a candidate (e.g. own, uber, epod).
                Allowed-provider entries with coverage/config are API-managed."
            >
              <UInput v-model="formDefaultProvider" placeholder="inherit" class="w-64 font-mono" />
            </UFormField>
          </template>
        </div>
      </section>
    </div>
  </div>
</template>
