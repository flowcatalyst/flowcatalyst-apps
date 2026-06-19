<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, computed } from 'vue';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { apiFetch } from '@/api/client';
import { useClientStore } from '@/stores/client';
import { toast } from '@flowcatalyst-apps/web-kit';
import { getErrorMessage } from '@flowcatalyst-apps/web-kit';

interface LayerItem {
  id: string;
  code: string;
  name: string;
  layerType: string;
}

interface FeatureItem {
  id: string;
  label: string;
  centerLat: number | null;
  centerLon: number | null;
  radiusMeters: number | null;
  polygonGeojson: string | null;
  propertyValues: Record<string, string>;
}

interface PropertySetItem {
  id: string;
  name: string;
  properties: Array<{ key: string; value: string }>;
}

interface LayerDetail {
  id: string;
  code: string;
  name: string;
  layerType: string;
  radiusMeters: number | null;
  propertySets: PropertySetItem[];
}

const clientStore = useClientStore();
const clientId = computed(() => clientStore.selectedClientId);

const layers = ref<LayerItem[]>([]);
const layerOptions = computed(() =>
  layers.value.map((l) => ({ label: `${l.name} (${l.code})`, value: l.id })),
);
const selectedLayerId = ref<string | null>(null);
const features = ref<FeatureItem[]>([]);
const selectedFeature = ref<FeatureItem | null>(null);
const layerDetail = ref<LayerDetail | null>(null);
const loading = ref(true);
const featureLoading = ref(false);
const editing = ref(false);
const saving = ref(false);

const mapContainer = ref<HTMLElement | null>(null);
let map: L.Map | null = null;
let featureLayer: L.LayerGroup | null = null;

const propertyKeys = computed(() => {
  const ps = layerDetail.value?.propertySets[0];
  if (!ps) return [];
  return ps.properties.filter((p) => p.key.trim()).map((p) => p.key);
});

onMounted(async () => {
  if (!clientId.value) {
    loading.value = false;
    return;
  }
  try {
    const resp = await apiFetch<{ items: LayerItem[] }>(`/clients/${clientId.value}/layers`);
    layers.value = resp.items;
  } catch {
    /* toast */
  } finally {
    loading.value = false;
  }

  if (mapContainer.value) {
    map = L.map(mapContainer.value).setView([-26.2, 28.0], 10);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(map);
    featureLayer = L.layerGroup().addTo(map);

    // Leaflet needs a size recalc after the container is laid out
    setTimeout(() => map?.invalidateSize(), 100);
  }
});

onUnmounted(() => {
  map?.remove();
  map = null;
});

watch(selectedLayerId, async (layerId) => {
  selectedFeature.value = null;
  editing.value = false;
  if (!layerId || !clientId.value) {
    features.value = [];
    layerDetail.value = null;
    featureLayer?.clearLayers();
    return;
  }
  featureLoading.value = true;
  try {
    const [detail, featureResp] = await Promise.all([
      apiFetch<LayerDetail>(`/clients/${clientId.value}/layers/${layerId}`),
      apiFetch<{ items: FeatureItem[] }>(`/clients/${clientId.value}/layers/${layerId}/features`),
    ]);
    layerDetail.value = detail;
    features.value = featureResp.items;
    renderFeatures();
  } catch {
    /* toast */
  } finally {
    featureLoading.value = false;
  }
});

function renderFeatures() {
  if (!map || !featureLayer) return;
  featureLayer.clearLayers();

  const bounds: L.LatLng[] = [];
  const layer = layers.value.find((l) => l.id === selectedLayerId.value);
  const layerRadius = layerDetail.value?.radiusMeters ?? null;

  for (const f of features.value) {
    if (f.centerLat != null && f.centerLon != null) {
      const latLng = L.latLng(f.centerLat, f.centerLon);
      bounds.push(latLng);

      const radius = f.radiusMeters ?? layerRadius;
      if (layer?.layerType === 'RADIUS' && radius) {
        const circle = L.circle(latLng, {
          radius,
          color: '#0967d2',
          fillOpacity: 0.15,
          weight: 2,
        });
        circle.on('click', () => selectFeature(f));
        circle.bindTooltip(f.label);
        circle.addTo(featureLayer!);
      } else {
        const marker = L.marker(latLng);
        marker.on('click', () => selectFeature(f));
        marker.bindTooltip(f.label);
        marker.addTo(featureLayer!);
      }
    }

    if (f.polygonGeojson) {
      try {
        const geojson = JSON.parse(f.polygonGeojson) as GeoJSON.GeoJsonObject;
        const geoLayer = L.geoJSON(geojson, {
          style: { color: '#0967d2', weight: 2, fillOpacity: 0.15 },
          onEachFeature: (_feature, lyr) => {
            lyr.on('click', () => selectFeature(f));
            (lyr as L.Layer & { bindTooltip: (s: string) => void }).bindTooltip(f.label);
          },
        });
        geoLayer.addTo(featureLayer!);
        const gjBounds = geoLayer.getBounds();
        if (gjBounds.isValid()) {
          bounds.push(gjBounds.getNorthEast());
          bounds.push(gjBounds.getSouthWest());
        }
      } catch {
        /* invalid geojson */
      }
    }
  }

  if (bounds.length > 0) {
    map.fitBounds(L.latLngBounds(bounds), { padding: [40, 40] });
  }
}

function selectFeature(f: FeatureItem) {
  selectedFeature.value = { ...f, propertyValues: { ...f.propertyValues } };
  editing.value = false;
}

function startEdit() {
  editing.value = true;
}

function closePanel() {
  selectedFeature.value = null;
  editing.value = false;
}

async function handleSave() {
  if (!selectedFeature.value || !clientId.value || !selectedLayerId.value) return;
  saving.value = true;
  try {
    const updated = await apiFetch<FeatureItem>(
      `/clients/${clientId.value}/layers/${selectedLayerId.value}/features/${selectedFeature.value.id}`,
      { method: 'PUT', body: JSON.stringify(selectedFeature.value) },
    );
    const idx = features.value.findIndex((f) => f.id === updated.id);
    if (idx >= 0) features.value[idx] = updated;
    selectedFeature.value = { ...updated, propertyValues: { ...updated.propertyValues } };
    editing.value = false;
    renderFeatures();
    toast.success('Saved', 'Feature updated.');
  } catch (e) {
    toast.error('Failed to save', getErrorMessage(e, 'Unknown error'));
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="map-page">
    <!-- Toolbar -->
    <div class="map-toolbar">
      <Select
        v-model="selectedLayerId"
        :options="layerOptions"
        option-label="label"
        option-value="value"
        placeholder="Select a layer..."
        :filter="true"
        filter-placeholder="Search layers..."
        :show-clear="true"
        style="min-width: 300px"
      />
      <div v-if="selectedLayerId" class="toolbar-info">
        <span v-if="featureLoading"><ProgressSpinner style="width: 16px; height: 16px" /></span>
        <span v-else>{{ features.length }} feature{{ features.length === 1 ? '' : 's' }}</span>
      </div>
    </div>

    <div class="map-body">
      <!-- Map -->
      <div ref="mapContainer" class="map-container"></div>

      <!-- Feature detail panel (slides in from right) -->
      <div v-if="selectedFeature" class="feature-panel">
        <div class="panel-header">
          <h3 style="margin: 0; font-size: 15px">
            {{ editing ? 'Edit Feature' : selectedFeature.label }}
          </h3>
          <div style="display: flex; gap: 4px">
            <Button
              v-if="!editing"
              icon="pi pi-pencil"
              severity="secondary"
              text
              size="small"
              @click="startEdit"
            />
            <Button icon="pi pi-times" severity="secondary" text size="small" @click="closePanel" />
          </div>
        </div>

        <!-- Edit mode -->
        <div v-if="editing" class="panel-content">
          <div style="margin-bottom: 12px">
            <label class="field-label">Label</label>
            <InputText v-model="selectedFeature.label" class="w-full" size="small" />
          </div>
          <div v-for="key in propertyKeys" :key="key" style="margin-bottom: 8px">
            <label class="field-label">{{ key }}</label>
            <InputText v-model="selectedFeature.propertyValues[key]" class="w-full" size="small" />
          </div>
          <div style="display: flex; gap: 8px; margin-top: 16px">
            <Button label="Cancel" severity="secondary" size="small" @click="editing = false" />
            <Button label="Save" size="small" :loading="saving" @click="handleSave" />
          </div>
        </div>

        <!-- View mode -->
        <div v-else class="panel-content">
          <div v-if="selectedFeature.centerLat != null" class="detail-row">
            <span class="detail-key">Location</span>
            <span class="detail-val"
              >{{ selectedFeature.centerLat.toFixed(5) }},
              {{ selectedFeature.centerLon?.toFixed(5) }}</span
            >
          </div>
          <div v-if="selectedFeature.radiusMeters" class="detail-row">
            <span class="detail-key">Radius</span>
            <span class="detail-val">{{ selectedFeature.radiusMeters }}m</span>
          </div>
          <div v-if="selectedFeature.polygonGeojson" class="detail-row">
            <span class="detail-key">Geometry</span>
            <span class="detail-val">Polygon</span>
          </div>
          <div v-for="key in propertyKeys" :key="key" class="detail-row">
            <span class="detail-key">{{ key }}</span>
            <span class="detail-val">{{ selectedFeature.propertyValues[key] ?? '—' }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.map-page {
  display: flex;
  flex-direction: column;
  height: calc(100vh - 80px);
  margin: -16px;
}

.map-toolbar {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 12px 16px;
  background: white;
  border-bottom: 1px solid #e2e8f0;
  z-index: 10;
}

.toolbar-info {
  font-size: 13px;
  color: #64748b;
}

.map-body {
  flex: 1;
  display: flex;
  position: relative;
  min-height: 0;
}

.map-container {
  flex: 1;
  min-height: 0;
}

.feature-panel {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  width: 340px;
  background: white;
  border-left: 1px solid #e2e8f0;
  box-shadow: -4px 0 20px rgba(0, 0, 0, 0.08);
  z-index: 500;
  display: flex;
  flex-direction: column;
  animation: slideIn 0.2s ease;
}

@keyframes slideIn {
  from {
    transform: translateX(100%);
  }
  to {
    transform: translateX(0);
  }
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid #f1f5f9;
}

.panel-content {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
}

.field-label {
  display: block;
  font-size: 12px;
  font-weight: 500;
  color: #64748b;
  margin-bottom: 4px;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.detail-row {
  display: flex;
  justify-content: space-between;
  padding: 8px 0;
  border-bottom: 1px solid #f8fafc;
}

.detail-key {
  font-size: 13px;
  color: #64748b;
}

.detail-val {
  font-size: 13px;
  font-weight: 500;
  color: #1e293b;
}

@media (max-width: 768px) {
  .feature-panel {
    width: 100%;
    height: 50%;
    top: auto;
    left: 0;
    border-left: none;
    border-top: 1px solid #e2e8f0;
  }
}
</style>
