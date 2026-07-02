<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { apiFetch } from '@/api/client';
import { useClientStore } from '@/stores/client';
import { useAuthStore } from '@/stores/auth';
import { toast } from '@flowcatalyst-apps/web-kit';
import { getErrorMessage } from '@flowcatalyst-apps/web-kit';

interface FeatureAssociation {
  layerFeatureId: string;
  layerId: string;
  layerName: string;
  featureLabel: string;
  distanceMeters: number | null;
}

interface MasterLocation {
  id: string;
  address: string;
  houseNumber: string | null;
  road: string | null;
  suburb: string | null;
  city: string;
  state: string | null;
  postalCode: string | null;
  country: string;
  status: string;
  latitude: number | null;
  longitude: number | null;
  addressHash: string;
  createdAt: string;
  features: FeatureAssociation[];
}

interface ProcessingLogEntry {
  id: string;
  step: string;
  data: Record<string, unknown>;
  createdAt: string;
}

interface ReverseGeocodeResult {
  houseNumber: string | null;
  road: string | null;
  city: string;
  state: string | null;
  postalCode: string | null;
  country: string;
  formattedAddress: string;
  confidence: number;
}

interface Country {
  isoA3: string;
  isoA2: string;
  name: string;
}

interface MatchFeaturesResult {
  masterLocationId: string;
  locationsUpdated: number;
  featuresMatched: FeatureAssociation[];
}

const route = useRoute();
const router = useRouter();
const clientStore = useClientStore();
const authStore = useAuthStore();
const masterLocation = ref<MasterLocation | null>(null);
const loading = ref(true);
const reverseResult = ref<ReverseGeocodeResult | null>(null);
const reversingGeocode = ref(false);
const confirming = ref(false);
const matching = ref(false);
const geocoding = ref(false);
const validating = ref(false);
const editing = ref(false);
const saving = ref(false);
const editForm = ref({
  houseNumber: '',
  road: '',
  suburb: '',
  city: '',
  state: '',
  postalCode: '',
  country: '',
});
const countries = ref<Country[]>([]);

function countryDisplay(code: string): string {
  const c = countries.value.find((x) => x.isoA3 === code || x.isoA2 === code);
  return c ? `${c.name} (${c.isoA3})` : code;
}

const processingLog = ref<ProcessingLogEntry[]>([]);
const showLog = ref(false);
const loadingLog = ref(false);

const clientId = clientStore.selectedClientId;

onMounted(async () => {
  // Load countries for display and edit
  apiFetch<Country[]>('/countries')
    .then((c) => {
      countries.value = c;
    })
    .catch(() => {});

  if (!clientId) {
    loading.value = false;
    return;
  }
  try {
    masterLocation.value = await apiFetch<MasterLocation>(
      `/clients/${clientId}/master-locations/${route.params['id'] as string}`,
    );
  } catch {
    // handled by global error toast
  } finally {
    loading.value = false;
  }
});

async function handleReverseGeocode() {
  if (!masterLocation.value || !clientId) return;
  reversingGeocode.value = true;
  reverseResult.value = null;
  try {
    const result = await apiFetch<ReverseGeocodeResult>(
      `/clients/${clientId}/master-locations/${masterLocation.value.id}/reverse-geocode`,
      { method: 'POST' },
      { suppressErrorToast: true },
    );
    // Backfill: keep existing values where reverse geocode returned nothing
    const ml = masterLocation.value;

    // Resolve country code — Photon returns iso_a2 (e.g. "za"), we need iso_a3 (e.g. "ZAF")
    let resolvedCountry = result.country || ml.country;
    if (resolvedCountry && countries.value.length > 0) {
      const lower = resolvedCountry.toLowerCase();
      const match = countries.value.find(
        (c) =>
          c.isoA2.toLowerCase() === lower ||
          c.isoA3.toLowerCase() === lower ||
          c.name.toLowerCase() === lower,
      );
      if (match) resolvedCountry = match.isoA3;
    }

    reverseResult.value = {
      houseNumber: result.houseNumber ?? ml.houseNumber ?? null,
      road: result.road ?? ml.road ?? null,
      city: result.city || ml.city,
      state: result.state ?? ml.state ?? null,
      postalCode: result.postalCode ?? ml.postalCode ?? null,
      country: resolvedCountry,
      formattedAddress: result.formattedAddress,
      confidence: result.confidence,
    };
  } catch (e) {
    toast.error('Reverse geocode failed', getErrorMessage(e, 'Unknown error'));
  } finally {
    reversingGeocode.value = false;
  }
}

async function handleConfirm() {
  if (!masterLocation.value || !clientId || !reverseResult.value) return;
  confirming.value = true;
  try {
    const updated = await apiFetch<MasterLocation>(
      `/clients/${clientId}/master-locations/${masterLocation.value.id}/confirm-geocode`,
      {
        method: 'POST',
        body: JSON.stringify({
          houseNumber: reverseResult.value.houseNumber,
          road: reverseResult.value.road,
          city: reverseResult.value.city,
          state: reverseResult.value.state,
          postalCode: reverseResult.value.postalCode,
          country: reverseResult.value.country,
          latitude: masterLocation.value.latitude,
          longitude: masterLocation.value.longitude,
        }),
      },
      { suppressErrorToast: true },
    );
    // Merge (don't replace): the confirm-geocode response omits `features`, so a
    // straight assignment would blank the features list and crash the render.
    masterLocation.value = { ...masterLocation.value, ...updated };
    processingLog.value = [];
    toast.success('Validated', 'Master location has been validated with the confirmed address.');
    reverseResult.value = null;
  } catch (e) {
    toast.error('Failed to confirm', getErrorMessage(e, 'Unknown error'));
  } finally {
    confirming.value = false;
  }
}

async function handleMatchFeatures() {
  if (!masterLocation.value || !clientId) return;
  matching.value = true;
  try {
    const result = await apiFetch<MatchFeaturesResult>(
      `/clients/${clientId}/master-locations/${masterLocation.value.id}/match-features`,
      { method: 'POST' },
      { suppressErrorToast: true },
    );
    masterLocation.value.features = result.featuresMatched;
    const count = result.featuresMatched.length;
    toast.success(
      'Features Matched',
      `${count} feature${count === 1 ? '' : 's'} matched, ${result.locationsUpdated} location${result.locationsUpdated === 1 ? '' : 's'} updated.`,
    );
  } catch (e) {
    toast.error('Feature matching failed', getErrorMessage(e, 'Unknown error'));
  } finally {
    matching.value = false;
  }
}

function startEdit() {
  if (!masterLocation.value) return;
  editForm.value = {
    houseNumber: masterLocation.value.houseNumber ?? '',
    road: masterLocation.value.road ?? '',
    suburb: masterLocation.value.suburb ?? '',
    city: masterLocation.value.city,
    state: masterLocation.value.state ?? '',
    postalCode: masterLocation.value.postalCode ?? '',
    country: masterLocation.value.country,
  };
  editing.value = true;
}

async function handleSaveEdit() {
  if (!masterLocation.value || !clientId) return;
  saving.value = true;
  try {
    const updated = await apiFetch<MasterLocation>(
      `/clients/${clientId}/master-locations/${masterLocation.value.id}`,
      {
        method: 'PUT',
        body: JSON.stringify({
          houseNumber: editForm.value.houseNumber || null,
          road: editForm.value.road || null,
          suburb: editForm.value.suburb || null,
          city: editForm.value.city,
          state: editForm.value.state || null,
          postalCode: editForm.value.postalCode || null,
          country: editForm.value.country,
        }),
      },
      { suppressErrorToast: true },
    );
    masterLocation.value = { ...masterLocation.value, ...updated };
    editing.value = false;
    processingLog.value = []; // reset log cache
    toast.success('Updated', 'Master location address updated. Status reset to PENDING.');
  } catch (e) {
    toast.error('Failed to update', getErrorMessage(e, 'Unknown error'));
  } finally {
    saving.value = false;
  }
}

async function handleGeocode() {
  if (!masterLocation.value || !clientId) return;
  geocoding.value = true;
  try {
    const updated = await apiFetch<MasterLocation>(
      `/clients/${clientId}/master-locations/${masterLocation.value.id}/geocode`,
      { method: 'POST' },
      { suppressErrorToast: true },
    );
    masterLocation.value = { ...masterLocation.value, ...updated };
    processingLog.value = [];
    toast.success('Geocoded', 'Master location has been forward geocoded.');
  } catch (e) {
    toast.error('Geocoding failed', getErrorMessage(e, 'Unknown error'));
  } finally {
    geocoding.value = false;
  }
}

async function handleValidate() {
  if (!masterLocation.value || !clientId) return;
  validating.value = true;
  try {
    const updated = await apiFetch<MasterLocation>(
      `/clients/${clientId}/master-locations/${masterLocation.value.id}/validate`,
      { method: 'POST' },
      { suppressErrorToast: true },
    );
    masterLocation.value = { ...masterLocation.value, ...updated };
    processingLog.value = [];
    toast.success('Validated', 'Master location has been validated.');
  } catch (e) {
    toast.error('Validation failed', getErrorMessage(e, 'Unknown error'));
  } finally {
    validating.value = false;
  }
}

async function toggleProcessingLog() {
  showLog.value = !showLog.value;
  if (showLog.value && processingLog.value.length === 0 && masterLocation.value && clientId) {
    loadingLog.value = true;
    try {
      processingLog.value = await apiFetch<ProcessingLogEntry[]>(
        `/clients/${clientId}/master-locations/${masterLocation.value.id}/processing-log`,
        {},
        { suppressErrorToast: true },
      );
    } catch (e) {
      toast.error('Failed to load log', getErrorMessage(e, 'Unknown error'));
    } finally {
      loadingLog.value = false;
    }
  }
}

function stepLabel(step: string): string {
  switch (step) {
    case 'normalized':
      return 'Address Normalized';
    case 'created':
      return 'Master Created';
    case 'matched':
      return 'Location Matched';
    case 'geocoded':
      return 'Forward Geocoded';
    case 'reverse_geocoded':
      return 'Reverse Geocoded';
    case 'spatial_matched':
      return 'Spatial Matching';
    case 'llm_verified':
      return 'LLM Verified';
    case 'edited':
      return 'Address Edited';
    case 'validated':
      return 'Validated';
    default:
      return step;
  }
}

function stepIcon(step: string): string {
  switch (step) {
    case 'normalized':
      return 'pi pi-filter';
    case 'created':
      return 'pi pi-plus-circle';
    case 'matched':
      return 'pi pi-link';
    case 'geocoded':
      return 'pi pi-map-marker';
    case 'reverse_geocoded':
      return 'pi pi-replay';
    case 'spatial_matched':
      return 'pi pi-sitemap';
    case 'llm_verified':
      return 'pi pi-microchip-ai';
    case 'edited':
      return 'pi pi-pencil';
    case 'validated':
      return 'pi pi-check-circle';
    default:
      return 'pi pi-circle';
  }
}

function dismissResult() {
  reverseResult.value = null;
}
</script>

<template>
  <div class="page-container" style="max-width: 900px">
    <ProgressSpinner v-if="loading" style="display: flex; justify-content: center; padding: 48px" />

    <template v-else-if="masterLocation">
      <div style="margin-bottom: 12px">
        <Button
          label="Back"
          icon="pi pi-arrow-left"
          severity="secondary"
          text
          @click="router.back()"
        />
      </div>

      <div class="page-header">
        <div>
          <h1 class="page-title">{{ masterLocation.address }}</h1>
          <p class="page-subtitle">
            {{ masterLocation.city }}, {{ countryDisplay(masterLocation.country) }}
          </p>
        </div>
        <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap">
          <Tag
            :value="masterLocation.status"
            :severity="
              masterLocation.status === 'VALIDATED'
                ? 'success'
                : masterLocation.status === 'GEOCODED'
                  ? 'info'
                  : masterLocation.status === 'PENDING'
                    ? 'warn'
                    : 'danger'
            "
          />
          <Button
            v-if="!editing && authStore.can('pinpoint:locations:master_location:update')"
            label="Edit"
            icon="pi pi-pencil"
            severity="secondary"
            @click="startEdit"
          />
          <Button
            v-if="
              masterLocation.status === 'PENDING' &&
              authStore.can('pinpoint:locations:master_location:validate')
            "
            label="Geocode"
            icon="pi pi-map-marker"
            severity="secondary"
            :loading="geocoding"
            @click="handleGeocode"
          />
          <Button
            v-if="
              masterLocation.status !== 'VALIDATED' &&
              masterLocation.status !== 'PENDING' &&
              authStore.can('pinpoint:locations:master_location:confirm')
            "
            label="Validate"
            icon="pi pi-check"
            :loading="validating"
            @click="handleValidate"
          />
          <Button
            v-if="masterLocation.latitude != null && authStore.can('pinpoint:matching:spatial:lookup')"
            label="Match Features"
            icon="pi pi-sitemap"
            severity="secondary"
            :loading="matching"
            @click="handleMatchFeatures"
          />
          <Button
            v-if="
              masterLocation.latitude != null &&
              masterLocation.status !== 'VALIDATED' &&
              authStore.can('pinpoint:locations:master_location:validate')
            "
            label="Reverse Geocode"
            icon="pi pi-map"
            severity="secondary"
            :loading="reversingGeocode"
            @click="handleReverseGeocode"
          />
        </div>
      </div>

      <!-- Edit form -->
      <div v-if="editing" class="fc-card" style="margin-bottom: 16px; border: 2px solid #0967d2">
        <h3 style="margin: 0 0 16px; font-size: 16px; color: #243b53">
          <i class="pi pi-pencil" style="margin-right: 8px"></i>
          Edit Address
        </h3>
        <form @submit.prevent="handleSaveEdit">
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px">
            <div>
              <label style="display: block; margin-bottom: 4px; font-weight: 500; font-size: 13px"
                >House Number</label
              >
              <InputText v-model="editForm.houseNumber" placeholder="e.g. 123" class="w-full" />
            </div>
            <div>
              <label style="display: block; margin-bottom: 4px; font-weight: 500; font-size: 13px"
                >Road</label
              >
              <InputText v-model="editForm.road" placeholder="e.g. Main Street" class="w-full" />
            </div>
            <div>
              <label style="display: block; margin-bottom: 4px; font-weight: 500; font-size: 13px"
                >Suburb</label
              >
              <InputText v-model="editForm.suburb" placeholder="e.g. Sandton" class="w-full" />
            </div>
            <div>
              <label style="display: block; margin-bottom: 4px; font-weight: 500; font-size: 13px"
                >City</label
              >
              <InputText v-model="editForm.city" class="w-full" required />
            </div>
            <div>
              <label style="display: block; margin-bottom: 4px; font-weight: 500; font-size: 13px"
                >State / Province</label
              >
              <InputText v-model="editForm.state" class="w-full" />
            </div>
            <div>
              <label style="display: block; margin-bottom: 4px; font-weight: 500; font-size: 13px"
                >Postal Code</label
              >
              <InputText v-model="editForm.postalCode" class="w-full" />
            </div>
            <div>
              <label style="display: block; margin-bottom: 4px; font-weight: 500; font-size: 13px"
                >Country</label
              >
              <Select
                v-if="countries.length > 0"
                v-model="editForm.country"
                :options="countries"
                option-label="name"
                option-value="isoA3"
                filter
                filter-placeholder="Search countries..."
                class="w-full"
                placeholder="Select country"
              >
                <template #value="slotProps">
                  <span v-if="slotProps.value">
                    {{ countries.find((c) => c.isoA3 === slotProps.value)?.name }} ({{
                      slotProps.value
                    }})
                  </span>
                  <span v-else style="color: #94a3b8">Select country</span>
                </template>
                <template #option="slotProps">
                  {{ slotProps.option.name }}
                  <span style="color: #64748b; font-size: 12px"
                    >({{ slotProps.option.isoA3 }})</span
                  >
                </template>
              </Select>
              <InputText
                v-else
                v-model="editForm.country"
                class="w-full"
                required
                placeholder="ISO A3 code (e.g. ZAF)"
              />
            </div>
          </div>
          <div style="display: flex; gap: 8px; justify-content: flex-end; margin-top: 16px">
            <Button label="Cancel" severity="secondary" @click="editing = false" />
            <Button
              label="Save & Reset to Pending"
              type="submit"
              icon="pi pi-save"
              :loading="saving"
            />
          </div>
        </form>
      </div>

      <!-- Reverse geocode result panel -->
      <div v-if="reverseResult" class="fc-card review-panel" style="margin-bottom: 16px">
        <div
          style="
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 16px;
          "
        >
          <h3 style="margin: 0; font-size: 16px; color: #243b53">
            <i class="pi pi-map-marker" style="margin-right: 8px"></i>
            Reverse Geocode Result
          </h3>
          <Tag
            :value="`${(reverseResult.confidence * 100).toFixed(0)}% confidence`"
            severity="info"
          />
        </div>

        <p class="formatted-address">{{ reverseResult.formattedAddress }}</p>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 16px">
          <div>
            <label style="display: block; margin-bottom: 4px; font-weight: 500; font-size: 13px"
              >House Number</label
            >
            <InputText v-model="reverseResult.houseNumber" class="w-full" placeholder="e.g. 123" />
          </div>
          <div>
            <label style="display: block; margin-bottom: 4px; font-weight: 500; font-size: 13px"
              >Road</label
            >
            <InputText v-model="reverseResult.road" class="w-full" placeholder="e.g. Main Street" />
          </div>
          <div>
            <label style="display: block; margin-bottom: 4px; font-weight: 500; font-size: 13px"
              >City</label
            >
            <InputText v-model="reverseResult.city" class="w-full" />
          </div>
          <div>
            <label style="display: block; margin-bottom: 4px; font-weight: 500; font-size: 13px"
              >State / Province</label
            >
            <InputText v-model="reverseResult.state" class="w-full" />
          </div>
          <div>
            <label style="display: block; margin-bottom: 4px; font-weight: 500; font-size: 13px"
              >Postal Code</label
            >
            <InputText v-model="reverseResult.postalCode" class="w-full" />
          </div>
          <div>
            <label style="display: block; margin-bottom: 4px; font-weight: 500; font-size: 13px"
              >Country</label
            >
            <Select
              v-if="countries.length > 0"
              v-model="reverseResult.country"
              :options="countries"
              option-label="name"
              option-value="isoA3"
              filter
              filter-placeholder="Search..."
              class="w-full"
            />
            <InputText v-else v-model="reverseResult.country" class="w-full" />
          </div>
        </div>

        <div style="display: flex; gap: 8px; justify-content: flex-end">
          <Button label="Dismiss" severity="secondary" @click="dismissResult" />
          <Button
            v-if="authStore.can('pinpoint:locations:master_location:confirm')"
            label="Confirm & Validate"
            icon="pi pi-check"
            :loading="confirming"
            @click="handleConfirm"
          />
        </div>
      </div>

      <!-- Matched features -->
      <div v-if="masterLocation.features.length > 0" class="fc-card" style="margin-bottom: 16px">
        <h3 style="margin: 0 0 12px; font-size: 16px; color: #243b53">
          <i class="pi pi-sitemap" style="margin-right: 8px"></i>
          Matched Features
          <Tag
            :value="String(masterLocation.features.length)"
            severity="info"
            style="margin-left: 8px"
          />
        </h3>
        <DataTable :value="masterLocation.features" size="small">
          <Column field="layerName" header="Layer" />
          <Column field="featureLabel" header="Feature" />
          <Column header="Distance">
            <template #body="{ data }">
              <span v-if="(data as FeatureAssociation).distanceMeters != null">
                {{ Math.round((data as FeatureAssociation).distanceMeters!) }} m
              </span>
              <span v-else style="color: #94a3b8">Contains</span>
            </template>
          </Column>
          <Column header="">
            <template #body="{ data }">
              <RouterLink
                :to="`/layers/${(data as FeatureAssociation).layerId}`"
                class="detail-link"
              >
                View Layer
              </RouterLink>
            </template>
          </Column>
        </DataTable>
      </div>

      <!-- Detail card -->
      <div class="fc-card" style="margin-bottom: 16px">
        <div class="detail-grid">
          <div class="detail-item">
            <span class="detail-label">ID</span>
            <span class="detail-value">{{ masterLocation.id }}</span>
          </div>
          <div class="detail-item">
            <span class="detail-label">Address</span>
            <span class="detail-value">{{ masterLocation.address }}</span>
          </div>
          <div class="detail-item">
            <span class="detail-label">Suburb</span>
            <span class="detail-value">{{ masterLocation.suburb ?? '—' }}</span>
          </div>
          <div class="detail-item">
            <span class="detail-label">City</span>
            <span class="detail-value">{{ masterLocation.city }}</span>
          </div>
          <div class="detail-item">
            <span class="detail-label">Country</span>
            <span class="detail-value">{{ countryDisplay(masterLocation.country) }}</span>
          </div>
          <div class="detail-item">
            <span class="detail-label">Coordinates</span>
            <span class="detail-value">
              {{
                masterLocation.latitude != null
                  ? `${masterLocation.latitude}, ${masterLocation.longitude}`
                  : 'Not geocoded'
              }}
            </span>
          </div>
          <div class="detail-item">
            <span class="detail-label">Address Hash</span>
            <span
              class="detail-value"
              style="font-family: monospace; font-size: 13px; word-break: break-all"
            >
              {{ masterLocation.addressHash }}
            </span>
          </div>
          <div class="detail-item">
            <span class="detail-label">Created</span>
            <span class="detail-value">{{ masterLocation.createdAt }}</span>
          </div>
        </div>
      </div>

      <!-- Map -->
      <div
        v-if="masterLocation.latitude != null && masterLocation.longitude != null"
        class="fc-card"
        style="margin-bottom: 16px"
      >
        <h3 style="margin-bottom: 12px; font-size: 16px; color: #243b53">Map</h3>
        <PpMapView
          :latitude="masterLocation.latitude"
          :longitude="masterLocation.longitude"
          :zoom="15"
        />
      </div>

      <!-- Processing Log -->
      <div class="fc-card">
        <div
          style="
            display: flex;
            justify-content: space-between;
            align-items: center;
            cursor: pointer;
          "
          @click="toggleProcessingLog"
        >
          <h3 style="margin: 0; font-size: 16px; color: #243b53">
            <i class="pi pi-history" style="margin-right: 8px"></i>
            Processing Log
          </h3>
          <i
            :class="showLog ? 'pi pi-chevron-up' : 'pi pi-chevron-down'"
            style="color: #64748b"
          ></i>
        </div>

        <div v-if="showLog" style="margin-top: 16px">
          <ProgressSpinner
            v-if="loadingLog"
            style="display: flex; justify-content: center; padding: 24px"
          />

          <div
            v-else-if="processingLog.length === 0"
            style="text-align: center; padding: 24px; color: #94a3b8"
          >
            No processing log entries
          </div>

          <div v-else class="log-timeline">
            <div v-for="entry in processingLog" :key="entry.id" class="log-entry">
              <div class="log-marker">
                <i :class="stepIcon(entry.step)" style="font-size: 14px"></i>
              </div>
              <div class="log-content">
                <div class="log-header">
                  <span class="log-step">{{ stepLabel(entry.step) }}</span>
                  <span class="log-time">{{ entry.createdAt }}</span>
                </div>
                <pre class="log-data">{{ JSON.stringify(entry.data, null, 2) }}</pre>
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.detail-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
  gap: 20px;
}

.detail-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.detail-label {
  font-size: 13px;
  font-weight: 500;
  color: #64748b;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.detail-value {
  font-size: 15px;
  color: #1e293b;
}

.detail-link {
  color: #0967d2;
  text-decoration: none;
  font-weight: 500;
}
.detail-link:hover {
  text-decoration: underline;
}

.review-panel {
  border: 2px solid #47a3f3;
  background: #f0f9ff;
}

.formatted-address {
  font-size: 16px;
  font-weight: 500;
  color: #102a43;
  margin: 0 0 16px;
  padding: 12px;
  background: white;
  border-radius: 6px;
  border: 1px solid #e2e8f0;
}

.log-timeline {
  display: flex;
  flex-direction: column;
  gap: 0;
}

.log-entry {
  display: flex;
  gap: 12px;
  padding: 12px 0;
  border-bottom: 1px solid #f1f5f9;
}
.log-entry:last-child {
  border-bottom: none;
}

.log-marker {
  display: flex;
  align-items: flex-start;
  justify-content: center;
  width: 32px;
  min-width: 32px;
  height: 32px;
  background: #f0f9ff;
  border-radius: 50%;
  color: #0967d2;
  padding-top: 8px;
}

.log-content {
  flex: 1;
  min-width: 0;
}

.log-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 4px;
}

.log-step {
  font-weight: 600;
  font-size: 14px;
  color: #243b53;
}

.log-time {
  font-size: 12px;
  color: #94a3b8;
}

.log-data {
  font-size: 12px;
  font-family: monospace;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 4px;
  padding: 8px;
  margin: 0;
  overflow-x: auto;
  color: #334e68;
  white-space: pre-wrap;
  word-break: break-all;
}
</style>
