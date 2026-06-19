<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { apiFetch } from '@/api/client';
import { useClientStore } from '@/stores/client';

interface FeatureAssociation {
  layerFeatureId: string;
  layerId: string;
  layerName: string;
  featureLabel: string;
  distanceMeters: number | null;
}

interface LocationDetail {
  id: string;
  name: string | null;
  address: string;
  city: string;
  country: string;
  status: string;
  masterLocationId: string | null;
  matchConfidence: number | null;
  createdAt: string;
  features: FeatureAssociation[];
}

const route = useRoute();
const router = useRouter();
const clientStore = useClientStore();
const location = ref<LocationDetail | null>(null);
const loading = ref(true);

const clientId = clientStore.selectedClientId;

onMounted(async () => {
  if (!clientId) {
    loading.value = false;
    return;
  }
  try {
    location.value = await apiFetch<LocationDetail>(
      `/clients/${clientId}/locations/${route.params['id'] as string}`,
    );
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
        <Tag :value="location.status" :severity="statusSeverity(location.status)" />
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
