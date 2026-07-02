<script setup lang="ts">
import { ref, computed } from 'vue';
import { useRouter } from 'vue-router';
import { apiFetch } from '@/api/client';
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

// Default to POINT: a layer is a container whose features carry their own
// geometry (matches the backend — "Point layers don't require geometry at the
// layer level"). RADIUS/POLYGON layers set an optional default geometry, so we
// only collect + send those fields when the matching type is selected.
const form = ref({
  code: '',
  name: '',
  description: '',
  layerType: 'POINT' as 'POINT' | 'RADIUS' | 'POLYGON',
  centerLat: null as number | null,
  centerLon: null as number | null,
  radius: 1000 as number | null,
  geometry: '',
});

async function handleSubmit() {
  if (!clientId.value) return;
  const f = form.value;
  const payload: Record<string, unknown> = {
    code: f.code,
    name: f.name,
    description: f.description.trim() || null,
    layerType: f.layerType,
  };
  if (f.layerType === 'RADIUS') {
    payload['centerLat'] = f.centerLat;
    payload['centerLon'] = f.centerLon;
    payload['radius'] = f.radius;
  } else if (f.layerType === 'POLYGON') {
    payload['geometry'] = f.geometry.trim() || null;
  }

  saving.value = true;
  try {
    const result = await apiFetch<{ id: string }>(
      `/clients/${clientId.value}/layers`,
      { method: 'POST', body: JSON.stringify(payload) },
      { suppressErrorToast: true },
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
          </div>

          <!-- POINT: no layer-level geometry; features provide their own coordinates. -->
          <small v-if="form.layerType === 'POINT'" style="color: #64748b">
            Point layers hold no geometry of their own — add features with their own coordinates
            after creating the layer.
          </small>

          <!-- RADIUS: default center + radius applied to the layer. -->
          <template v-else-if="form.layerType === 'RADIUS'">
            <div style="display: flex; gap: 16px">
              <div style="flex: 1">
                <label style="display: block; margin-bottom: 6px; font-weight: 500">Center Latitude</label>
                <InputNumber
                  v-model="form.centerLat"
                  :min="-90"
                  :max="90"
                  :max-fraction-digits="7"
                  placeholder="e.g. -26.2041"
                  class="w-full"
                />
              </div>
              <div style="flex: 1">
                <label style="display: block; margin-bottom: 6px; font-weight: 500">Center Longitude</label>
                <InputNumber
                  v-model="form.centerLon"
                  :min="-180"
                  :max="180"
                  :max-fraction-digits="7"
                  placeholder="e.g. 28.0473"
                  class="w-full"
                />
              </div>
            </div>
            <div>
              <label style="display: block; margin-bottom: 6px; font-weight: 500"
                >Default Radius (meters)</label
              >
              <InputNumber v-model="form.radius" :min="1" :max="100000" suffix=" m" class="w-full" />
              <small style="color: #64748b">All features in this layer default to this radius.</small>
            </div>
          </template>

          <!-- POLYGON: GeoJSON boundary. -->
          <div v-else-if="form.layerType === 'POLYGON'">
            <label for="geometry" style="display: block; margin-bottom: 6px; font-weight: 500"
              >Polygon GeoJSON</label
            >
            <Textarea
              id="geometry"
              v-model="form.geometry"
              rows="6"
              placeholder='{"type":"Polygon","coordinates":[[[lon,lat], ...]]}'
              class="w-full"
              style="font-family: monospace"
            />
            <small style="color: #64748b">A GeoJSON Polygon geometry defining the layer boundary.</small>
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
