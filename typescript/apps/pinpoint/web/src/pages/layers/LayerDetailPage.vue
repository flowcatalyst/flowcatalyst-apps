<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useConfirm } from 'primevue/useconfirm';
import { apiFetch } from '@/api/client';
import { useClientStore } from '@/stores/client';
import { toast } from '@flowcatalyst-apps/web-kit';
import { getErrorMessage } from '@flowcatalyst-apps/web-kit';

interface PropertyItem {
  key: string;
  value: string;
}
interface PropertySetItem {
  id: string;
  name: string;
  description: string | null;
  properties: PropertyItem[];
}
interface FeatureItem {
  id: string;
  label: string;
  centerLat: number | null;
  centerLon: number | null;
  radiusMeters: number | null;
  polygonGeojson: string | null;
  propertyValues: Record<string, string>;
  status: string;
  createdAt: string;
}
interface LayerDetail {
  id: string;
  code: string;
  name: string;
  description: string | null;
  layerType: string;
  status: string;
  centerLat: number | null;
  centerLon: number | null;
  radiusMeters: number | null;
  polygonGeojson: string | null;
  propertySets: PropertySetItem[];
  partitionIds: string[];
  createdAt: string;
}

interface Partition {
  id: string;
  code: string;
  name: string;
}

const route = useRoute();
const router = useRouter();
const confirm = useConfirm();
const clientStore = useClientStore();
const layer = ref<LayerDetail | null>(null);
const features = ref<FeatureItem[]>([]);
const loading = ref(true);
const editing = ref(false);
const saving = ref(false);
const featureSearch = ref('');
const partitions = ref<Partition[]>([]);
const selectedPartitionIds = ref<string[]>([]);
const savingPartitions = ref(false);

const filteredFeatures = computed(() => {
  const q = featureSearch.value.toLowerCase().trim();
  if (!q) return features.value;
  return features.value.filter((f) => {
    if (f.label.toLowerCase().includes(q)) return true;
    // Also search property values
    for (const v of Object.values(f.propertyValues)) {
      if (v.toLowerCase().includes(q)) return true;
    }
    return false;
  });
});

// Feature dialog state
const showFeatureDialog = ref(false);
const editingFeature = ref<FeatureItem | null>(null);
const featureSaving = ref(false);
const featureError = ref('');
const featureForm = ref({
  label: '',
  centerLat: null as number | null,
  centerLon: null as number | null,
  radiusMeters: null as number | null,
  polygonGeojson: null as string | null,
  propertyValues: {} as Record<string, string>,
});

const creatingSchemaPending = ref(false);

const editForm = ref({ name: '', description: '' });
const clientId = clientStore.selectedClientId;

function layerPath(suffix = '') {
  return `/clients/${clientId}/layers/${route.params['id'] as string}${suffix}`;
}

// The single property set (schema) for this layer
const propertySet = computed(() => layer.value?.propertySets[0] ?? null);

const propertyKeys = computed(() => {
  const ps = propertySet.value;
  if (!ps) return [];
  return ps.properties.filter((p) => p.key.trim()).map((p) => p.key);
});

onMounted(async () => {
  if (!clientId) {
    loading.value = false;
    return;
  }
  try {
    layer.value = await apiFetch<LayerDetail>(layerPath());
    selectedPartitionIds.value = layer.value.partitionIds ?? [];
    const featureResp = await apiFetch<{ items: FeatureItem[] }>(layerPath('/features'));
    features.value = featureResp.items;
    // Load partitions for assignment UI
    const partResp = await apiFetch<{ items: Partition[] }>(`/clients/${clientId}/partitions`);
    partitions.value = partResp.items;
  } catch {
    /* global toast */
  } finally {
    loading.value = false;
  }
});

async function handleSavePartitions() {
  savingPartitions.value = true;
  try {
    await apiFetch(layerPath('/partitions'), {
      method: 'PUT',
      body: JSON.stringify({ partitionIds: selectedPartitionIds.value }),
    });
    if (layer.value) layer.value.partitionIds = [...selectedPartitionIds.value];
    toast.success(
      'Updated',
      selectedPartitionIds.value.length === 0
        ? 'Layer applies to all partitions.'
        : `Layer assigned to ${selectedPartitionIds.value.length} partition(s).`,
    );
  } catch (e) {
    toast.error('Failed to update partitions', getErrorMessage(e, 'Unknown error'));
  } finally {
    savingPartitions.value = false;
  }
}

// ── Layer Edit ────────────────────────────────────────────────────────────

function startEdit() {
  if (!layer.value) return;
  editForm.value = { name: layer.value.name, description: layer.value.description ?? '' };
  editing.value = true;
}

async function handleSave() {
  if (!layer.value) return;
  saving.value = true;
  try {
    layer.value = await apiFetch<LayerDetail>(layerPath(), {
      method: 'PUT',
      body: JSON.stringify({
        name: editForm.value.name,
        description: editForm.value.description || null,
        centerLat: layer.value.centerLat,
        centerLon: layer.value.centerLon,
        radiusMeters: layer.value.radiusMeters,
        polygonGeojson: layer.value.polygonGeojson,
      }),
    });
    toast.success('Saved', 'Layer updated.');
    editing.value = false;
  } catch (e) {
    toast.error('Failed to save', getErrorMessage(e, 'Unknown error'));
  } finally {
    saving.value = false;
  }
}

function confirmDeleteLayer() {
  confirm.require({
    message: `Delete layer "${layer.value?.name}"? All features and property sets will be removed.`,
    header: 'Delete Layer',
    icon: 'pi pi-exclamation-triangle',
    acceptClass: 'p-button-danger',
    accept: async () => {
      try {
        await apiFetch(layerPath(), { method: 'DELETE' });
        toast.success('Deleted', 'Layer deleted.');
        await router.push('/layers');
      } catch (e) {
        toast.error('Failed to delete', getErrorMessage(e, 'Unknown error'));
      }
    },
  });
}

// ── Features ──────────────────────────────────────────────────────────────

function openAddFeature() {
  editingFeature.value = null;
  featureError.value = '';
  featureForm.value = {
    label: '',
    centerLat: null,
    centerLon: null,
    radiusMeters: layer.value?.layerType === 'POINT' ? null : (layer.value?.radiusMeters ?? null),
    polygonGeojson: null,
    propertyValues: {},
  };
  showFeatureDialog.value = true;
}

function openEditFeature(f: FeatureItem) {
  editingFeature.value = f;
  featureError.value = '';
  featureForm.value = {
    label: f.label,
    centerLat: f.centerLat,
    centerLon: f.centerLon,
    radiusMeters: f.radiusMeters,
    polygonGeojson: f.polygonGeojson,
    propertyValues: { ...f.propertyValues },
  };
  showFeatureDialog.value = true;
}

function onRadiusChange(data: { lat: number; lon: number; radius: number }) {
  featureForm.value.centerLat = data.lat;
  featureForm.value.centerLon = data.lon;
}

function onPointChange(data: { lat: number; lon: number }) {
  featureForm.value.centerLat = data.lat;
  featureForm.value.centerLon = data.lon;
}

function onPolygonChange(data: { geojson: string }) {
  featureForm.value.polygonGeojson = data.geojson;
}

async function handleSaveFeature() {
  featureError.value = '';
  if (!featureForm.value.label.trim()) {
    featureError.value = 'Label is required.';
    return;
  }
  featureSaving.value = true;
  try {
    if (editingFeature.value) {
      const updated = await apiFetch<FeatureItem>(
        layerPath(`/features/${editingFeature.value.id}`),
        { method: 'PUT', body: JSON.stringify(featureForm.value) },
      );
      const idx = features.value.findIndex((f) => f.id === updated.id);
      if (idx >= 0) features.value[idx] = updated;
    } else {
      const created = await apiFetch<FeatureItem>(layerPath('/features'), {
        method: 'POST',
        body: JSON.stringify(featureForm.value),
      });
      features.value.push(created);
    }
    showFeatureDialog.value = false;
    toast.success('Saved', editingFeature.value ? 'Feature updated.' : 'Feature created.');
  } catch (e) {
    featureError.value = getErrorMessage(e, 'Failed to save feature.');
  } finally {
    featureSaving.value = false;
  }
}

function confirmDeleteFeature(f: FeatureItem) {
  confirm.require({
    message: `Delete feature "${f.label}"?`,
    header: 'Delete Feature',
    icon: 'pi pi-exclamation-triangle',
    acceptClass: 'p-button-danger',
    accept: async () => {
      try {
        await apiFetch(layerPath(`/features/${f.id}`), { method: 'DELETE' });
        features.value = features.value.filter((x) => x.id !== f.id);
        toast.success('Deleted', 'Feature deleted.');
      } catch (e) {
        toast.error('Failed to delete', getErrorMessage(e, 'Unknown error'));
      }
    },
  });
}

async function toggleFeatureStatus(f: FeatureItem) {
  const newStatus = f.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
  try {
    const updated = await apiFetch<FeatureItem>(layerPath(`/features/${f.id}/status`), {
      method: 'PUT',
      body: JSON.stringify({ status: newStatus }),
    });
    const idx = features.value.findIndex((x) => x.id === f.id);
    if (idx >= 0) features.value[idx] = updated;
    toast.success('Updated', `Feature "${f.label}" is now ${newStatus.toLowerCase()}.`);
  } catch (e) {
    toast.error('Failed to update status', getErrorMessage(e, 'Unknown error'));
  }
}

// ── Property Schema (single set) ──────────────────────────────────────────

async function createSchema() {
  creatingSchemaPending.value = true;
  try {
    const ps = await apiFetch<PropertySetItem>(layerPath('/property-sets'), {
      method: 'POST',
      body: JSON.stringify({ name: 'Properties' }),
    });
    if (layer.value) layer.value.propertySets = [ps];
  } catch (e) {
    toast.error('Failed to create schema', getErrorMessage(e, 'Unknown error'));
  } finally {
    creatingSchemaPending.value = false;
  }
}

async function deleteSchema() {
  const ps = propertySet.value;
  if (!ps) return;
  try {
    await apiFetch(layerPath(`/property-sets/${ps.id}`), { method: 'DELETE' });
    if (layer.value) layer.value.propertySets = [];
  } catch (e) {
    toast.error('Failed to delete', getErrorMessage(e, 'Unknown error'));
  }
}

function addSchemaKey() {
  const ps = propertySet.value;
  if (!ps) return;
  if (ps.properties.length >= 6) {
    toast.warn('Limit', 'Max 6 properties.');
    return;
  }
  ps.properties = [...ps.properties, { key: '', value: '' }];
}

function removeSchemaKey(idx: number) {
  const ps = propertySet.value;
  if (!ps) return;
  ps.properties.splice(idx, 1);
  void saveSchema();
}

async function saveSchema() {
  const ps = propertySet.value;
  if (!ps) return;
  try {
    await apiFetch(layerPath(`/property-sets/${ps.id}/properties`), {
      method: 'PUT',
      body: JSON.stringify({ properties: ps.properties.filter((p) => p.key.trim()) }),
    });
    toast.success('Saved', 'Property schema updated.');
  } catch (e) {
    toast.error('Failed to save', getErrorMessage(e, 'Unknown error'));
  }
}
</script>

<template>
  <div class="page-container" style="max-width: 1000px">
    <ProgressSpinner v-if="loading" style="display: flex; justify-content: center; padding: 48px" />

    <template v-else-if="layer">
      <div style="margin-bottom: 12px">
        <Button
          label="Back to Layers"
          icon="pi pi-arrow-left"
          severity="secondary"
          text
          @click="router.push('/layers')"
        />
      </div>

      <div class="page-header">
        <div>
          <h1 class="page-title">{{ layer.name }}</h1>
          <p class="page-subtitle">
            {{ layer.code }} &middot; {{ layer.layerType
            }}{{ layer.description ? ` — ${layer.description}` : '' }}
          </p>
        </div>
        <div style="display: flex; gap: 8px">
          <Button
            v-if="!editing"
            label="Edit"
            icon="pi pi-pencil"
            severity="secondary"
            @click="startEdit"
          />
          <Button
            v-if="!editing"
            label="Delete"
            icon="pi pi-trash"
            severity="danger"
            @click="confirmDeleteLayer"
          />
        </div>
      </div>

      <!-- Edit Form -->
      <div v-if="editing" class="fc-card" style="margin-bottom: 16px">
        <form @submit.prevent="handleSave">
          <div style="display: flex; flex-direction: column; gap: 16px">
            <div>
              <label style="display: block; margin-bottom: 6px; font-weight: 500">Name</label>
              <InputText v-model="editForm.name" class="w-full" required />
            </div>
            <div>
              <label style="display: block; margin-bottom: 6px; font-weight: 500"
                >Description</label
              >
              <InputText v-model="editForm.description" class="w-full" />
            </div>
            <div style="display: flex; gap: 8px; justify-content: flex-end">
              <Button label="Cancel" severity="secondary" @click="editing = false" />
              <Button label="Save" type="submit" :loading="saving" />
            </div>
          </div>
        </form>
      </div>

      <!-- Property Schema (single set) -->
      <div class="fc-card" style="margin-bottom: 16px">
        <div
          style="
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 12px;
          "
        >
          <h3 style="margin: 0; font-size: 16px; color: #243b53">Property Schema</h3>
          <Button
            v-if="propertySet"
            icon="pi pi-trash"
            severity="danger"
            text
            size="small"
            @click="deleteSchema"
            v-tooltip="'Remove schema'"
          />
        </div>

        <div v-if="!propertySet" style="text-align: center; padding: 16px">
          <p style="color: #94a3b8; margin-bottom: 12px">
            Define what data each feature in this layer carries (up to 6 columns).
          </p>
          <Button
            label="Define Properties"
            icon="pi pi-plus"
            severity="secondary"
            :loading="creatingSchemaPending"
            @click="createSchema"
          />
        </div>

        <template v-else>
          <div class="properties-table">
            <div v-for="(prop, idx) in propertySet.properties" :key="idx" class="property-row">
              <InputText
                v-model="prop.key"
                placeholder="Column name (e.g. zone, priority)"
                style="flex: 1"
                size="small"
              />
              <Button
                icon="pi pi-times"
                severity="danger"
                text
                size="small"
                @click="removeSchemaKey(idx)"
              />
            </div>
          </div>
          <div style="display: flex; justify-content: space-between; margin-top: 8px">
            <Button
              v-if="propertySet.properties.length < 6"
              label="Add Column"
              icon="pi pi-plus"
              text
              size="small"
              @click="addSchemaKey"
            />
            <span v-else style="font-size: 12px; color: #94a3b8">Max 6 columns</span>
            <Button label="Save Schema" size="small" severity="secondary" @click="saveSchema" />
          </div>
        </template>
      </div>

      <!-- Partition Assignment -->
      <div v-if="partitions.length > 0" class="fc-card" style="margin-bottom: 16px">
        <h3 style="margin: 0 0 12px; font-size: 16px; color: #243b53">
          <i class="pi pi-th-large" style="margin-right: 8px"></i>
          Partition Scope
          <Tag
            :value="
              selectedPartitionIds.length === 0
                ? 'All Partitions'
                : `${selectedPartitionIds.length} Partition(s)`
            "
            :severity="selectedPartitionIds.length === 0 ? 'success' : 'info'"
            style="margin-left: 8px"
          />
        </h3>
        <p style="font-size: 13px; color: #64748b; margin: 0 0 12px">
          Leave empty for this layer to apply to all partitions. Select specific partitions to
          restrict.
        </p>
        <div style="display: flex; gap: 8px; align-items: flex-start">
          <MultiSelect
            v-model="selectedPartitionIds"
            :options="partitions"
            option-label="name"
            option-value="id"
            placeholder="All Partitions"
            display="chip"
            filter
            class="w-full"
            style="flex: 1"
          />
          <Button
            label="Save"
            icon="pi pi-save"
            :loading="savingPartitions"
            @click="handleSavePartitions"
          />
        </div>
      </div>

      <!-- Features -->
      <div class="fc-card">
        <div
          style="
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 16px;
          "
        >
          <h3 style="margin: 0; font-size: 16px; color: #243b53">
            Features
            <span style="color: #94a3b8; font-weight: normal">({{ features.length }})</span>
          </h3>
          <Button label="Add Feature" icon="pi pi-plus" @click="openAddFeature" />
        </div>

        <div v-if="features.length > 0" style="margin-bottom: 12px">
          <InputText
            v-model="featureSearch"
            placeholder="Search features by label or property value..."
            class="w-full"
          />
        </div>

        <div v-if="features.length === 0" style="text-align: center; padding: 32px; color: #94a3b8">
          <i class="pi pi-map-marker" style="font-size: 32px; margin-bottom: 8px"></i>
          <p>No features yet. Add points or polygons to this layer.</p>
        </div>

        <DataTable
          v-else
          :value="filteredFeatures"
          :rows="20"
          :paginator="filteredFeatures.length > 20"
        >
          <Column field="label" header="Label">
            <template #body="{ data }">
              <button class="link-btn" @click="openEditFeature(data as FeatureItem)">
                {{ (data as FeatureItem).label }}
              </button>
            </template>
          </Column>
          <Column header="Geometry">
            <template #body="{ data }">
              <span v-if="(data as FeatureItem).centerLat != null">
                {{ (data as FeatureItem).centerLat?.toFixed(4) }},
                {{ (data as FeatureItem).centerLon?.toFixed(4) }}
                <span v-if="layer.layerType === 'RADIUS' && (data as FeatureItem).radiusMeters">
                  ({{ (data as FeatureItem).radiusMeters }}m)</span
                >
                <span v-else-if="layer.layerType === 'POINT'" style="color: #64748b"> Point</span>
              </span>
              <span v-else-if="(data as FeatureItem).polygonGeojson" style="color: #64748b"
                >Polygon</span
              >
              <span v-else style="color: #94a3b8">None</span>
            </template>
          </Column>
          <Column v-for="key in propertyKeys" :key="key" :header="key">
            <template #body="{ data }">
              {{ (data as FeatureItem).propertyValues[key] ?? '—' }}
            </template>
          </Column>
          <Column header="Status" style="width: 120px">
            <template #body="{ data }">
              <Button
                :label="(data as FeatureItem).status === 'ACTIVE' ? 'Active' : 'Inactive'"
                :severity="(data as FeatureItem).status === 'ACTIVE' ? 'success' : 'warn'"
                size="small"
                text
                @click="toggleFeatureStatus(data as FeatureItem)"
              />
            </template>
          </Column>
          <Column header="" style="width: 60px">
            <template #body="{ data }">
              <Button
                icon="pi pi-trash"
                severity="danger"
                text
                size="small"
                @click="confirmDeleteFeature(data as FeatureItem)"
              />
            </template>
          </Column>
        </DataTable>
      </div>

      <!-- Feature Create/Edit Dialog -->
      <Dialog
        v-model:visible="showFeatureDialog"
        :header="editingFeature ? 'Edit Feature' : 'Add Feature'"
        :modal="true"
        style="width: 700px"
      >
        <div style="display: flex; flex-direction: column; gap: 16px">
          <div>
            <label style="display: block; margin-bottom: 6px; font-weight: 500">Label</label>
            <InputText
              v-model="featureForm.label"
              placeholder="e.g. Sandton Central"
              class="w-full"
              required
            />
          </div>

          <div v-if="layer.layerType === 'RADIUS'">
            <label style="display: block; margin-bottom: 6px; font-weight: 500"
              >Radius (meters)</label
            >
            <InputNumber
              v-model="featureForm.radiusMeters"
              :min="1"
              :max="100000"
              suffix=" m"
              class="w-full"
            />
            <small style="color: #94a3b8">Layer default: {{ layer.radiusMeters ?? 1000 }}m</small>
          </div>

          <div
            v-if="layer.layerType === 'POINT'"
            style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px"
          >
            <div>
              <label style="display: block; margin-bottom: 6px; font-weight: 500">Latitude</label>
              <InputNumber
                v-model="featureForm.centerLat"
                :min-fraction-digits="1"
                :max-fraction-digits="8"
                class="w-full"
                placeholder="-26.2041"
              />
            </div>
            <div>
              <label style="display: block; margin-bottom: 6px; font-weight: 500">Longitude</label>
              <InputNumber
                v-model="featureForm.centerLon"
                :min-fraction-digits="1"
                :max-fraction-digits="8"
                class="w-full"
                placeholder="28.0473"
              />
            </div>
          </div>

          <div>
            <label style="display: block; margin-bottom: 6px; font-weight: 500">
              {{
                layer.layerType === 'POINT'
                  ? 'Click the map to place point (or enter coordinates above)'
                  : layer.layerType === 'RADIUS'
                    ? 'Click the map to set center point'
                    : 'Click the map to draw polygon'
              }}
            </label>
            <PpLayerEditor
              :mode="
                layer.layerType === 'POINT'
                  ? 'point'
                  : layer.layerType === 'RADIUS'
                    ? 'radius'
                    : 'polygon'
              "
              :center-lat="featureForm.centerLat ?? -26.2"
              :center-lon="featureForm.centerLon ?? 28.0"
              :radius="featureForm.radiusMeters ?? layer.radiusMeters ?? 1000"
              :geojson="featureForm.polygonGeojson ?? ''"
              @radius-change="onRadiusChange"
              @polygon-change="onPolygonChange"
              @point-change="onPointChange"
            />
          </div>

          <div v-if="propertyKeys.length > 0">
            <label style="display: block; margin-bottom: 6px; font-weight: 500">Properties</label>
            <div style="display: flex; flex-direction: column; gap: 8px">
              <div
                v-for="key in propertyKeys"
                :key="key"
                style="display: flex; gap: 8px; align-items: center"
              >
                <label style="min-width: 120px; font-size: 14px; color: #64748b">{{ key }}</label>
                <InputText
                  v-model="featureForm.propertyValues[key]"
                  :placeholder="key"
                  style="flex: 1"
                />
              </div>
            </div>
          </div>

          <div
            v-if="featureError"
            style="
              padding: 8px 12px;
              background: #fef2f2;
              border: 1px solid #fecaca;
              border-radius: 6px;
              color: #dc2626;
              font-size: 14px;
            "
          >
            {{ featureError }}
          </div>
        </div>
        <template #footer>
          <Button label="Cancel" severity="secondary" @click="showFeatureDialog = false" />
          <Button
            :label="editingFeature ? 'Update' : 'Create'"
            :loading="featureSaving"
            @click="handleSaveFeature"
          />
        </template>
      </Dialog>
    </template>
  </div>
</template>

<style scoped>
.property-set-card {
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 16px;
  margin-bottom: 12px;
}
.property-set-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
  padding-bottom: 8px;
  border-bottom: 1px solid #f1f5f9;
}
.properties-table {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.property-row {
  display: flex;
  gap: 8px;
  align-items: center;
}
.link-btn {
  background: none;
  border: none;
  color: #0967d2;
  cursor: pointer;
  font-weight: 500;
  font-size: 14px;
  padding: 0;
  text-decoration: none;
}
.link-btn:hover {
  text-decoration: underline;
}
</style>
