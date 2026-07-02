<script setup lang="ts">
import { ref, onMounted, watch, computed } from 'vue';
import { apiFetch } from '@/api/client';
import { useClientStore } from '@/stores/client';
import { useAuthStore } from '@/stores/auth';
import { toast } from '@flowcatalyst-apps/web-kit';
import { getErrorMessage } from '@flowcatalyst-apps/web-kit';

interface MatchingConfig {
  id: string;
  clientId: string | null;
  partitionId: string | null;
  streetThreshold: number;
  houseNumberThreshold: number;
  postalCodeThreshold: number;
  stateThreshold: number;
  addressNameThreshold: number;
  overallThreshold: number;
  createdAt: string;
  updatedAt: string;
}

const clientStore = useClientStore();
const authStore = useAuthStore();
const config = ref<MatchingConfig | null>(null);
const loading = ref(true);
const editing = ref(false);
const saving = ref(false);

const editForm = ref({
  streetThreshold: 85,
  houseNumberThreshold: 95,
  postalCodeThreshold: 95,
  stateThreshold: 80,
  addressNameThreshold: 80,
  overallThreshold: 85,
});

const clientId = computed(() => clientStore.selectedClientId);

const configScope = computed(() => {
  if (!config.value) return '';
  if (config.value.partitionId) return 'Partition';
  if (config.value.clientId) return 'Client';
  return 'Global (Default)';
});

async function loadConfig() {
  if (!clientId.value) {
    config.value = null;
    loading.value = false;
    return;
  }
  loading.value = true;
  try {
    config.value = await apiFetch<MatchingConfig>(`/clients/${clientId.value}/matching-config`);
  } catch {
    config.value = null;
  } finally {
    loading.value = false;
  }
}

function startEdit() {
  if (!config.value) return;
  editForm.value = {
    streetThreshold: Math.round(config.value.streetThreshold * 100),
    houseNumberThreshold: Math.round(config.value.houseNumberThreshold * 100),
    postalCodeThreshold: Math.round(config.value.postalCodeThreshold * 100),
    stateThreshold: Math.round(config.value.stateThreshold * 100),
    addressNameThreshold: Math.round(config.value.addressNameThreshold * 100),
    overallThreshold: Math.round(config.value.overallThreshold * 100),
  };
  editing.value = true;
}

async function handleSave() {
  if (!config.value || !clientId.value) return;
  saving.value = true;
  try {
    await apiFetch(`/clients/${clientId.value}/matching-config`, {
      method: 'PUT',
      body: JSON.stringify({
        streetThreshold: editForm.value.streetThreshold / 100,
        houseNumberThreshold: editForm.value.houseNumberThreshold / 100,
        postalCodeThreshold: editForm.value.postalCodeThreshold / 100,
        stateThreshold: editForm.value.stateThreshold / 100,
        addressNameThreshold: editForm.value.addressNameThreshold / 100,
        overallThreshold: editForm.value.overallThreshold / 100,
      }),
    }, { suppressErrorToast: true });
    toast.success('Saved', 'Matching configuration updated.');
    editing.value = false;
    await loadConfig();
  } catch (e) {
    toast.error('Failed to save', getErrorMessage(e, 'Unknown error'));
  } finally {
    saving.value = false;
  }
}

onMounted(loadConfig);
watch(clientId, loadConfig);
</script>

<template>
  <div class="page-container" style="max-width: 700px">
    <div class="page-header">
      <div>
        <h1 class="page-title">Matching Config</h1>
        <p class="page-subtitle">
          {{ clientStore.selectedClient?.name ?? 'Select a client' }}
        </p>
      </div>
      <Button
        v-if="config && !editing && authStore.can('pinpoint:matching:config:manage')"
        label="Edit Thresholds"
        icon="pi pi-pencil"
        severity="secondary"
        @click="startEdit"
      />
    </div>

    <div v-if="!clientId" class="fc-card" style="text-align: center; padding: 48px">
      <i class="pi pi-building" style="font-size: 48px; color: #bcccdc"></i>
      <p style="color: #64748b; margin-top: 16px">Select a client first</p>
      <RouterLink to="/clients" style="color: #0967d2">Go to Clients</RouterLink>
    </div>

    <ProgressSpinner
      v-else-if="loading"
      style="display: flex; justify-content: center; padding: 48px"
    />

    <template v-else-if="config">
      <div class="fc-card" style="margin-bottom: 16px">
        <div class="scope-badge">
          <Tag :value="configScope" severity="info" />
          <span class="scope-hint"> Config cascade: partition &rarr; client &rarr; global </span>
        </div>
      </div>

      <!-- Edit mode -->
      <div v-if="editing" class="fc-card">
        <h3 style="margin: 0 0 20px; font-size: 16px; color: #243b53">Edit Thresholds</h3>
        <div class="threshold-list">
          <div class="threshold-row">
            <div class="threshold-info">
              <span class="threshold-label">Street</span>
              <span class="threshold-hint">How similar street names must be</span>
            </div>
            <div class="threshold-control">
              <Slider
                v-model="editForm.streetThreshold"
                :min="0"
                :max="100"
                :step="1"
                style="width: 200px"
              />
              <span class="threshold-value">{{ editForm.streetThreshold }}%</span>
            </div>
          </div>
          <div class="threshold-row">
            <div class="threshold-info">
              <span class="threshold-label">House Number</span>
              <span class="threshold-hint">How similar house numbers must be</span>
            </div>
            <div class="threshold-control">
              <Slider
                v-model="editForm.houseNumberThreshold"
                :min="0"
                :max="100"
                :step="1"
                style="width: 200px"
              />
              <span class="threshold-value">{{ editForm.houseNumberThreshold }}%</span>
            </div>
          </div>
          <div class="threshold-row">
            <div class="threshold-info">
              <span class="threshold-label">Postal Code</span>
              <span class="threshold-hint">How similar postal codes must be</span>
            </div>
            <div class="threshold-control">
              <Slider
                v-model="editForm.postalCodeThreshold"
                :min="0"
                :max="100"
                :step="1"
                style="width: 200px"
              />
              <span class="threshold-value">{{ editForm.postalCodeThreshold }}%</span>
            </div>
          </div>
          <div class="threshold-row">
            <div class="threshold-info">
              <span class="threshold-label">State / Province</span>
              <span class="threshold-hint">How similar state names must be</span>
            </div>
            <div class="threshold-control">
              <Slider
                v-model="editForm.stateThreshold"
                :min="0"
                :max="100"
                :step="1"
                style="width: 200px"
              />
              <span class="threshold-value">{{ editForm.stateThreshold }}%</span>
            </div>
          </div>
          <div class="threshold-row">
            <div class="threshold-info">
              <span class="threshold-label">Address Name</span>
              <span class="threshold-hint">General address name similarity</span>
            </div>
            <div class="threshold-control">
              <Slider
                v-model="editForm.addressNameThreshold"
                :min="0"
                :max="100"
                :step="1"
                style="width: 200px"
              />
              <span class="threshold-value">{{ editForm.addressNameThreshold }}%</span>
            </div>
          </div>
          <div class="threshold-row overall">
            <div class="threshold-info">
              <span class="threshold-label">Overall</span>
              <span class="threshold-hint">Average score must exceed this</span>
            </div>
            <div class="threshold-control">
              <Slider
                v-model="editForm.overallThreshold"
                :min="0"
                :max="100"
                :step="1"
                style="width: 200px"
              />
              <span class="threshold-value">{{ editForm.overallThreshold }}%</span>
            </div>
          </div>
        </div>
        <div style="display: flex; gap: 8px; justify-content: flex-end; margin-top: 20px">
          <Button label="Cancel" severity="secondary" @click="editing = false" />
          <Button label="Save" :loading="saving" @click="handleSave" />
        </div>
      </div>

      <!-- View mode -->
      <div v-else class="fc-card">
        <h3 style="margin: 0 0 20px; font-size: 16px; color: #243b53">Thresholds</h3>
        <div class="threshold-list">
          <div class="threshold-row">
            <span class="threshold-label">Street</span>
            <span class="threshold-display">{{ (config.streetThreshold * 100).toFixed(0) }}%</span>
          </div>
          <div class="threshold-row">
            <span class="threshold-label">House Number</span>
            <span class="threshold-display"
              >{{ (config.houseNumberThreshold * 100).toFixed(0) }}%</span
            >
          </div>
          <div class="threshold-row">
            <span class="threshold-label">Postal Code</span>
            <span class="threshold-display"
              >{{ (config.postalCodeThreshold * 100).toFixed(0) }}%</span
            >
          </div>
          <div class="threshold-row">
            <span class="threshold-label">State / Province</span>
            <span class="threshold-display">{{ (config.stateThreshold * 100).toFixed(0) }}%</span>
          </div>
          <div class="threshold-row">
            <span class="threshold-label">Address Name</span>
            <span class="threshold-display"
              >{{ (config.addressNameThreshold * 100).toFixed(0) }}%</span
            >
          </div>
          <div class="threshold-row overall">
            <span class="threshold-label">Overall</span>
            <span class="threshold-display overall-value"
              >{{ (config.overallThreshold * 100).toFixed(0) }}%</span
            >
          </div>
        </div>
      </div>
    </template>

    <div v-else class="fc-card" style="text-align: center; padding: 48px">
      <i class="pi pi-sliders-h" style="font-size: 48px; color: #bcccdc"></i>
      <p style="color: #64748b; margin-top: 16px">No matching configuration found</p>
      <p style="font-size: 13px; color: #94a3b8">
        A global default config is needed. Run sync or create one.
      </p>
    </div>
  </div>
</template>

<style scoped>
.scope-badge {
  display: flex;
  align-items: center;
  gap: 12px;
}

.scope-hint {
  font-size: 13px;
  color: #94a3b8;
}

.threshold-list {
  display: flex;
  flex-direction: column;
}

.threshold-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 0;
  border-bottom: 1px solid #f1f5f9;
}

.threshold-row:last-child {
  border-bottom: none;
}

.threshold-row.overall {
  border-top: 2px solid #e2e8f0;
  margin-top: 4px;
  padding-top: 16px;
}

.threshold-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.threshold-label {
  font-size: 14px;
  font-weight: 500;
  color: #1e293b;
}

.threshold-hint {
  font-size: 12px;
  color: #94a3b8;
}

.threshold-control {
  display: flex;
  align-items: center;
  gap: 12px;
}

.threshold-value {
  font-size: 14px;
  font-weight: 600;
  color: #102a43;
  min-width: 40px;
  text-align: right;
}

.threshold-display {
  font-size: 18px;
  font-weight: 600;
  color: #102a43;
}

.overall-value {
  font-size: 22px;
  color: #0967d2;
}
</style>
