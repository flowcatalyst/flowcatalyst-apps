<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useConfirm } from 'primevue/useconfirm';
import { api, ok, suppressErrorToast, type ApiResponse } from '@/api/client';
import { useClientStore } from '@/stores/client';
import { useAuthStore } from '@/stores/auth';
import { toast, getErrorMessage } from '@flowcatalyst-apps/web-kit';

type LocationDetail = ApiResponse<'/bff/clients/{clientId}/locations/{locationId}', 'get'>;
type FeatureAssociation = LocationDetail['features'][number];

const route = useRoute();
const router = useRouter();
const confirm = useConfirm();
const clientStore = useClientStore();
const authStore = useAuthStore();
const location = ref<LocationDetail | null>(null);
const loading = ref(true);
const deleting = ref(false);
const matchAddressInput = ref('');
const rematching = ref(false);

const clientId = clientStore.selectedClientId;

function matchMethodLabel(method: string | null): string {
  switch (method) {
    case 'EXACT_HASH':
      return 'Exact (address hash)';
    case 'FUZZY':
      return 'Fuzzy (similarity match)';
    default:
      return '—';
  }
}

async function handleRematch() {
  const loc = location.value;
  if (!loc || !clientId) return;
  const value = matchAddressInput.value.trim();
  if (value.length === 0) return;
  rematching.value = true;
  try {
    const res = await ok(
      api.POST('/bff/clients/{clientId}/locations/{locationId}/rematch', {
        params: { path: { clientId, locationId: loc.id } },
        body: { matchAddress: value },
        ...suppressErrorToast,
      }),
    );
    // Refresh so the new master link + status + associations render.
    location.value = await ok(
      api.GET('/bff/clients/{clientId}/locations/{locationId}', {
        params: { path: { clientId, locationId: loc.id } },
      }),
    );
    matchAddressInput.value = location.value.matchAddress;
    toast.success(
      'Rematched',
      res.previousMasterDeleted
        ? `Re-matched (status ${res.status}); the previous unused master location was removed.`
        : `Re-matched (status ${res.status}).`,
    );
  } catch (e) {
    toast.error('Rematch failed', getErrorMessage(e, 'Unknown error'));
  } finally {
    rematching.value = false;
  }
}

function handleDelete() {
  const loc = location.value;
  if (!loc || !clientId) return;
  confirm.require({
    message:
      `Delete location "${loc.name ?? loc.address}"? This is a CASCADE — it also removes ` +
      `this location's feature, attribute, and layer association rows. This cannot be undone.`,
    header: 'Delete Location',
    icon: 'pi pi-exclamation-triangle',
    acceptClass: 'p-button-danger',
    acceptLabel: 'Delete',
    accept: async () => {
      deleting.value = true;
      try {
        await api.DELETE('/bff/clients/{clientId}/locations/{locationId}', {
          params: { path: { clientId, locationId: loc.id } },
          ...suppressErrorToast,
        });
        toast.success('Deleted', 'Location deleted.');
        await router.push('/locations');
      } catch (e) {
        toast.error('Failed to delete', getErrorMessage(e, 'Unknown error'));
      } finally {
        deleting.value = false;
      }
    },
  });
}

onMounted(async () => {
  if (!clientId) {
    loading.value = false;
    return;
  }
  try {
    location.value = await ok(
      api.GET('/bff/clients/{clientId}/locations/{locationId}', {
        params: { path: { clientId, locationId: route.params['id'] as string } },
      }),
    );
    matchAddressInput.value = location.value.matchAddress;
  } catch {
    // handled by global error toast
  } finally {
    loading.value = false;
  }
});

function statusSeverity(status: string) {
  switch (status) {
    case 'MATCHED':
      return 'success';
    case 'VALIDATED':
      return 'success';
    case 'PENDING':
      return 'warn';
    default:
      return 'info';
  }
}
</script>

<template>
  <div class="page-container" style="max-width: 900px">
    <ProgressSpinner v-if="loading" style="display: flex; justify-content: center; padding: 48px" />

    <template v-else-if="location">
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
          <h1 class="page-title">{{ location.name ?? location.address }}</h1>
          <p class="page-subtitle">{{ location.address }}, {{ location.city }}</p>
        </div>
        <div style="display: flex; align-items: center; gap: 12px">
          <Tag :value="location.status" :severity="statusSeverity(location.status)" />
          <Button
            v-if="authStore.can('pinpoint:locations:location:delete')"
            label="Delete"
            icon="pi pi-trash"
            severity="danger"
            :loading="deleting"
            @click="handleDelete"
          />
        </div>
      </div>

      <div class="fc-card" style="margin-bottom: 16px">
        <div style="margin-bottom: 16px">
          <label style="display: block; margin-bottom: 6px; font-weight: 500"
            >Received Address</label
          >
          <InputText :model-value="location.receivedAddress" class="w-full" disabled />
          <small style="color: #64748b">The address as received. Immutable.</small>
        </div>
        <div>
          <label for="match_address" style="display: block; margin-bottom: 6px; font-weight: 500"
            >Match Address</label
          >
          <div style="display: flex; gap: 8px; align-items: flex-start">
            <InputText
              id="match_address"
              v-model="matchAddressInput"
              class="w-full"
              :disabled="!authStore.can('pinpoint:locations:location:update')"
            />
            <Button
              v-if="authStore.can('pinpoint:locations:location:update')"
              label="Re-run Matching"
              icon="pi pi-refresh"
              :loading="rematching"
              :disabled="
                matchAddressInput.trim().length === 0 || matchAddressInput === location.matchAddress
              "
              @click="handleRematch"
            />
          </div>
          <small style="color: #64748b">
            Edit and re-run to re-match this location. All matching/processing runs against this
            value. Resolving to a different master re-links it; an unused PENDING master is removed.
          </small>
        </div>
      </div>

      <div class="fc-card" style="margin-bottom: 16px">
        <div class="detail-grid">
          <div class="detail-item">
            <span class="detail-label">ID</span>
            <span class="detail-value">{{ location.id }}</span>
          </div>
          <div class="detail-item">
            <span class="detail-label">Name</span>
            <span class="detail-value">{{ location.name ?? '—' }}</span>
          </div>
          <div class="detail-item">
            <span class="detail-label">Address</span>
            <span class="detail-value">{{ location.address }}</span>
          </div>
          <div class="detail-item">
            <span class="detail-label">City</span>
            <span class="detail-value">{{ location.city }}</span>
          </div>
          <div class="detail-item">
            <span class="detail-label">Country</span>
            <span class="detail-value">{{ location.country }}</span>
          </div>
          <div class="detail-item">
            <span class="detail-label">Match Confidence</span>
            <span class="detail-value">
              {{
                location.matchConfidence != null
                  ? `${(location.matchConfidence * 100).toFixed(0)}%`
                  : '—'
              }}
            </span>
          </div>
          <div class="detail-item">
            <span class="detail-label">Match Method</span>
            <span class="detail-value">{{ matchMethodLabel(location.matchMethod) }}</span>
          </div>
          <div class="detail-item">
            <span class="detail-label">Master Location</span>
            <span class="detail-value">
              <RouterLink
                v-if="location.masterLocationId"
                :to="`/master-locations/${location.masterLocationId}`"
                class="detail-link"
              >
                {{ location.masterLocationId }}
              </RouterLink>
              <span v-else style="color: #94a3b8">None</span>
            </span>
          </div>
          <div class="detail-item">
            <span class="detail-label">Created</span>
            <span class="detail-value">{{ location.createdAt }}</span>
          </div>
        </div>
      </div>

      <!-- Matched features -->
      <div
        v-if="location.features && location.features.length > 0"
        class="fc-card"
        style="margin-bottom: 16px"
      >
        <h3 style="margin: 0 0 12px; font-size: 16px; color: #243b53">
          <i class="pi pi-sitemap" style="margin-right: 8px"></i>
          Matched Features
          <Tag :value="String(location.features.length)" severity="info" style="margin-left: 8px" />
        </h3>
        <DataTable :value="location.features" size="small">
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
</style>
