<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { api, clientId } from '../context.js';
import { buildFulfilment, DEFAULT_OPTIONS } from '../lib/generator.js';
import storeFixtures from '../generator/data/stores.json';

// Reka UI (Nuxt UI's select) rejects empty-string item values — use a sentinel.
const RANDOM_STORE = '__random__';

const form = reactive({
  count: 10,
  deliveryShare: DEFAULT_OPTIONS.deliveryShare * 100,
  asapShare: DEFAULT_OPTIONS.asapShare * 100,
  multiStoreShare: DEFAULT_OPTIONS.multiStoreShare * 100,
  /** RANDOM_STORE = random per fulfilment; otherwise every fulfilment anchors here. */
  storeRef: RANDOM_STORE,
});

const storeOptions = computed(() => [
  { label: 'Random store (default)', value: RANDOM_STORE },
  ...storeFixtures.map((s) => ({ label: `${s.ref} · ${s.name}`, value: s.ref })),
]);

interface RunResult {
  externalRef: string;
  outcome: 'created' | 'exists' | 'failed';
  detail: string;
}

const running = ref(false);
const results = ref<RunResult[]>([]);

async function run(): Promise<void> {
  running.value = true;
  results.value = [];
  const batch = Date.now().toString(36).toUpperCase();
  for (let i = 0; i < form.count; i++) {
    const externalRef = `GEN-${batch}-${i + 1}`;
    const payload = buildFulfilment(clientId.value, externalRef, {
      deliveryShare: form.deliveryShare / 100,
      asapShare: form.asapShare / 100,
      multiStoreShare: form.multiStoreShare / 100,
      ...(form.storeRef !== RANDOM_STORE ? { storeRef: form.storeRef } : {}),
    });
    try {
      const res = await api.request(`/clients/${clientId.value}/fulfilments`, {
        method: 'POST',
        body: payload,
      });
      const body = (await res.json()) as { fulfilmentId?: string; code?: string; message?: string };
      if (res.status === 201) {
        results.value.push({
          externalRef,
          outcome: 'created',
          detail: `${body.fulfilmentId} (${payload.type}/${payload.serviceLevel}, ${payload.parts.length} part(s))`,
        });
      } else if (body.code === 'FULFILMENT_ALREADY_EXISTS') {
        results.value.push({ externalRef, outcome: 'exists', detail: body.message ?? '' });
      } else {
        results.value.push({
          externalRef,
          outcome: 'failed',
          detail: `${res.status} ${body.code ?? ''} ${body.message ?? ''}`,
        });
      }
    } catch (err) {
      results.value.push({
        externalRef,
        outcome: 'failed',
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  }
  running.value = false;
}
</script>

<template>
  <div class="mx-auto max-w-3xl p-6">
    <h1 class="mb-1 text-xl font-semibold text-[#102a43]">Fulfilment generator</h1>
    <p class="mb-4 text-sm text-neutral-500">
      Generates fulfilments for <span class="font-mono">{{ clientId }}</span> from 100 sample SA
      stores and 1000 sample products (committed fixtures). Deliveries get a drop-off within 5km of
      the store; collections use the store's collection point.
    </p>

    <div
      class="mb-4 grid grid-cols-2 gap-4 rounded-lg border border-neutral-200 bg-white p-4 sm:grid-cols-4"
    >
      <UFormField label="Count">
        <UInput v-model.number="form.count" type="number" :min="1" :max="200" />
      </UFormField>
      <UFormField label="Deliveries %">
        <UInput v-model.number="form.deliveryShare" type="number" :min="0" :max="100" />
      </UFormField>
      <UFormField label="ASAP %">
        <UInput v-model.number="form.asapShare" type="number" :min="0" :max="100" />
      </UFormField>
      <UFormField label="Multi-store %">
        <UInput v-model.number="form.multiStoreShare" type="number" :min="0" :max="100" />
      </UFormField>
      <UFormField label="Store" class="col-span-2">
        <USelect
          v-model="form.storeRef"
          :items="storeOptions"
          value-key="value"
          class="w-full"
        />
      </UFormField>
    </div>

    <UButton :loading="running" @click="run">Generate</UButton>

    <div v-if="results.length" class="mt-4 rounded-lg border border-neutral-200 bg-white">
      <div class="border-b border-neutral-100 px-3 py-2 text-sm text-neutral-500">
        {{ results.filter((r) => r.outcome === 'created').length }} created ·
        {{ results.filter((r) => r.outcome === 'failed').length }} failed
      </div>
      <ul class="max-h-96 overflow-y-auto text-xs">
        <li
          v-for="r in results"
          :key="r.externalRef"
          class="flex gap-2 border-b border-neutral-50 px-3 py-1.5"
        >
          <span
            :class="
              r.outcome === 'created'
                ? 'text-emerald-600'
                : r.outcome === 'exists'
                  ? 'text-amber-600'
                  : 'text-red-600'
            "
            >{{ r.outcome }}</span
          >
          <span class="font-mono">{{ r.externalRef }}</span>
          <span class="truncate text-neutral-500">{{ r.detail }}</span>
        </li>
      </ul>
    </div>
  </div>
</template>
