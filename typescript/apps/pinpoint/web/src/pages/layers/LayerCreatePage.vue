<script setup lang="ts">
import { ref, computed } from 'vue';
import { useRouter } from 'vue-router';
import { api, ok, suppressErrorToast } from '@/api/client';
import { useClientStore } from '@/stores/client';
import { toast } from '@flowcatalyst-apps/web-kit';
import { getErrorMessage } from '@flowcatalyst-apps/web-kit';

const router = useRouter();
const clientStore = useClientStore();
const saving = ref(false);
const clientId = computed(() => clientStore.selectedClientId);

const layerTypeOptions = [
  { label: 'Radius', value: 'RADIUS' },
  { label: 'Polygon', value: 'POLYGON' },
  { label: 'Point', value: 'POINT' },
];

// A layer is just a container + a type label; its geometry lives on the
// features (points) you add to it afterward. So creation needs only
// code / name / description / type — no layer-level center/radius/geojson.
const form = ref({
  code: '',
  name: '',
  description: '',
  layerType: 'POINT' as 'POINT' | 'RADIUS' | 'POLYGON',
});

async function handleSubmit() {
  if (!clientId.value) return;
  const f = form.value;
  saving.value = true;
  try {
    const result = await ok(
      api.POST('/bff/clients/{clientId}/layers', {
        params: { path: { clientId: clientId.value } },
        body: {
          code: f.code,
          name: f.name,
          description: f.description.trim() || null,
          layerType: f.layerType,
        },
        ...suppressErrorToast,
      }),
    );
    toast.success('Layer Created', `Layer "${f.name}" has been created.`);
    await router.push(`/layers/${result.id}`);
  } catch (e) {
    toast.error('Failed to create layer', getErrorMessage(e, 'Unknown error'));
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="page-container" style="max-width: 800px">
    <div class="page-header">
      <div>
        <h1 class="page-title">New Layer</h1>
        <p class="page-subtitle">Define a geographic region</p>
      </div>
    </div>

    <div class="fc-card">
      <form @submit.prevent="handleSubmit">
        <div style="display: flex; flex-direction: column; gap: 16px">
          <div>
            <label for="code" style="display: block; margin-bottom: 6px; font-weight: 500"
              >Code</label
            >
            <InputText
              id="code"
              v-model="form.code"
              placeholder="e.g. delivery-zones"
              class="w-full"
              required
            />
            <small style="color: #64748b"
              >Unique identifier. Cannot be changed after creation.</small
            >
          </div>

          <div>
            <label for="name" style="display: block; margin-bottom: 6px; font-weight: 500"
              >Name</label
            >
            <InputText
              id="name"
              v-model="form.name"
              placeholder="Enter layer name"
              class="w-full"
              required
            />
          </div>

          <div>
            <label for="description" style="display: block; margin-bottom: 6px; font-weight: 500"
              >Description</label
            >
            <InputText
              id="description"
              v-model="form.description"
              placeholder="Optional"
              class="w-full"
            />
          </div>

          <div>
            <label for="layer_type" style="display: block; margin-bottom: 6px; font-weight: 500"
              >Type</label
            >
            <Select
              id="layer_type"
              v-model="form.layerType"
              :options="layerTypeOptions"
              option-label="label"
              option-value="value"
              class="w-full"
            />
            <small style="color: #64748b">
              A label for the features this layer holds. Add features (points, with their own
              coordinates) after creating the layer — the layer itself carries no geometry.
            </small>
          </div>

          <div style="display: flex; gap: 8px; justify-content: flex-end">
            <Button label="Cancel" severity="secondary" @click="router.back()" />
            <Button label="Create Layer" type="submit" :loading="saving" />
          </div>
        </div>
      </form>
    </div>
  </div>
</template>
