<script setup lang="ts">
import { ref, onMounted, watch, computed } from 'vue';
import { apiFetch } from '@/api/client';
import { useClientStore } from '@/stores/client';
import { useAuthStore } from '@/stores/auth';
import { useListState } from '@flowcatalyst-apps/web-kit';
import { toast } from '@flowcatalyst-apps/web-kit';
import { getErrorMessage } from '@flowcatalyst-apps/web-kit';

interface MasterLocation {
  id: string;
  address: string;
  city: string;
  status: string;
  latitude: number | null;
  longitude: number | null;
  createdAt: string;
}

interface MasterLocationListResponse {
  items: MasterLocation[];
  total: number;
}

interface Partition {
  id: string;
  code: string;
  name: string;
}

const statusOptions = [
  { label: 'All Statuses', value: '' },
  { label: 'Pending', value: 'PENDING' },
  { label: 'Geocoded', value: 'GEOCODED' },
  { label: 'Validated', value: 'VALIDATED' },
  { label: 'Rejected', value: 'REJECTED' },
];

const clientStore = useClientStore();
const authStore = useAuthStore();

const { page, pageSize, first, searchQuery, onPage } = useListState({
  search: { queryKey: 'q' },
});

const masterLocations = ref<MasterLocation[]>([]);
const totalRecords = ref(0);
const loading = ref(true);
const statusFilter = ref('');
const partitions = ref<Partition[]>([]);
const selectedPartitionId = ref<string | null>(null);

const clientId = computed(() => clientStore.selectedClientId);

async function loadMasterLocations() {
  if (!clientId.value) {
    masterLocations.value = [];
    loading.value = false;
    return;
  }
  loading.value = true;
  try {
    const params = new URLSearchParams();
    params.set('page', String(page.value));
    params.set('pageSize', String(pageSize.value));
    if (searchQuery.value) params.set('q', searchQuery.value);
    if (statusFilter.value) params.set('status', statusFilter.value);

    const response = await apiFetch<MasterLocationListResponse>(
      `/clients/${clientId.value}/master-locations?${params.toString()}`,
    );
    masterLocations.value = response.items;
    totalRecords.value = response.total;
  } catch {
    masterLocations.value = [];
  } finally {
    loading.value = false;
  }
}

function onStatusChange() {
  page.value = 0;
  loadMasterLocations();
}

async function loadPartitions() {
  if (!clientId.value) return;
  try {
    const resp = await apiFetch<{ items: Partition[] }>(`/clients/${clientId.value}/partitions`);
    partitions.value = resp.items;
  } catch {
    /* optional */
  }
}

onMounted(() => {
  loadPartitions();
  loadMasterLocations();
});
watch([page, pageSize, searchQuery, clientId], loadMasterLocations);
watch(clientId, loadPartitions);

function statusSeverity(status: string) {
  switch (status) {
    case 'VALIDATED':
      return 'success';
    case 'GEOCODED':
      return 'info';
    case 'PENDING':
      return 'warn';
    case 'REJECTED':
      return 'danger';
    default:
      return 'info';
  }
}

const bulkMatching = ref(false);

async function handleBulkMatch() {
  if (!clientId.value) return;
  bulkMatching.value = true;
  try {
    const result = await apiFetch<{ mastersProcessed: number; totalAssociations: number }>(
      `/clients/${clientId.value}/master-locations/match-features`,
      { method: 'POST' },
    );
    toast.success(
      'Spatial Matching Complete',
      `${result.mastersProcessed} master locations processed, ${result.totalAssociations} feature associations created.`,
    );
  } catch (e) {
    toast.error('Bulk matching failed', getErrorMessage(e, 'Unknown error'));
  } finally {
    bulkMatching.value = false;
  }
}
</script>

<template>
  <div class="page-container">
    <div class="page-header">
      <div>
        <h1 class="page-title">Master Locations</h1>
        <p class="page-subtitle">
          {{ clientStore.selectedClient?.name ?? 'Select a client' }}
        </p>
      </div>
      <Button
        v-if="clientId && authStore.can('pinpoint:matching:spatial:lookup')"
        label="Re-match All Features"
        icon="pi pi-sitemap"
        severity="secondary"
        :loading="bulkMatching"
        @click="handleBulkMatch"
      />
    </div>

    <div v-if="!clientId" class="fc-card" style="text-align: center; padding: 48px">
      <i class="pi pi-building" style="font-size: 48px; color: #bcccdc"></i>
      <p style="color: #64748b; margin-top: 16px">Select a client first</p>
      <RouterLink to="/clients" style="color: #0967d2">Go to Clients</RouterLink>
    </div>

    <div v-else class="fc-card">
      <div style="display: flex; gap: 12px; margin-bottom: 16px">
        <InputText v-model="searchQuery" placeholder="Search master locations..." style="flex: 1" />
        <Select
          v-if="partitions.length > 0"
          v-model="selectedPartitionId"
          :options="[{ id: null, name: 'All Partitions' }, ...partitions]"
          option-label="name"
          option-value="id"
          style="width: 200px"
        />
        <Select
          v-model="statusFilter"
          :options="statusOptions"
          option-label="label"
          option-value="value"
          style="width: 200px"
          @change="onStatusChange"
        />
      </div>

      <DataTable
        :value="masterLocations"
        :loading="loading"
        :paginator="true"
        :rows="pageSize"
        :total-records="totalRecords"
        :first="first"
        lazy
        @page="onPage"
      >
        <Column field="address" header="Address">
          <template #body="{ data }">
            <RouterLink :to="`/master-locations/${(data as MasterLocation).id}`" class="link">
              {{ (data as MasterLocation).address }}
            </RouterLink>
          </template>
        </Column>
        <Column field="city" header="City" />
        <Column field="status" header="Status">
          <template #body="{ data }">
            <Tag
              :value="(data as MasterLocation).status"
              :severity="statusSeverity((data as MasterLocation).status)"
            />
          </template>
        </Column>
        <Column header="Coordinates">
          <template #body="{ data }">
            <span v-if="(data as MasterLocation).latitude != null">
              {{ (data as MasterLocation).latitude?.toFixed(4) }},
              {{ (data as MasterLocation).longitude?.toFixed(4) }}
            </span>
            <span v-else style="color: #94a3b8">Pending</span>
          </template>
        </Column>
        <Column field="createdAt" header="Created" />

        <template #empty>
          <div style="text-align: center; padding: 48px">
            <i class="pi pi-database" style="font-size: 48px; color: #bcccdc"></i>
            <p style="color: #64748b; margin-top: 16px">No master locations found</p>
          </div>
        </template>
      </DataTable>
    </div>
  </div>
</template>

<style scoped>
.link {
  color: #0967d2;
  text-decoration: none;
  font-weight: 500;
}
.link:hover {
  text-decoration: underline;
}
</style>
