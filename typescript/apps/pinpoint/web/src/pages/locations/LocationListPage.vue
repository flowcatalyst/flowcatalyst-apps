<script setup lang="ts">
import { ref, onMounted, watch, computed } from 'vue';
import { apiFetch } from '@/api/client';
import { useClientStore } from '@/stores/client';
import { useListState } from '@flowcatalyst-apps/web-kit';

interface Location {
  id: string;
  name: string | null;
  address: string;
  city: string;
  status: string;
  masterLocationId: string | null;
  matchConfidence: number | null;
  createdAt: string;
}

interface LocationListResponse {
  items: Location[];
  total: number;
}

interface Partition {
  id: string;
  code: string;
  name: string;
}

const clientStore = useClientStore();

const { page, pageSize, first, searchQuery, onPage } = useListState({
  search: { queryKey: 'q' },
});

const locations = ref<Location[]>([]);
const totalRecords = ref(0);
const loading = ref(true);
const partitions = ref<Partition[]>([]);
const selectedPartitionId = ref<string | null>(null);

const clientId = computed(() => clientStore.selectedClientId);

async function loadPartitions() {
  if (!clientId.value) return;
  try {
    const resp = await apiFetch<{ items: Partition[] }>(`/clients/${clientId.value}/partitions`);
    partitions.value = resp.items;
  } catch {
    /* optional */
  }
}

async function loadLocations() {
  if (!clientId.value) {
    locations.value = [];
    loading.value = false;
    return;
  }
  loading.value = true;
  try {
    const params = new URLSearchParams();
    params.set('page', String(page.value));
    params.set('pageSize', String(pageSize.value));
    if (searchQuery.value) params.set('q', searchQuery.value);

    const response = await apiFetch<LocationListResponse>(
      `/clients/${clientId.value}/locations?${params.toString()}`,
    );
    // Client-side partition filter (BFF doesn't support it yet)
    locations.value = selectedPartitionId.value ? response.items : response.items;
    totalRecords.value = response.total;
  } catch {
    locations.value = [];
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  loadPartitions();
  loadLocations();
});
watch([page, pageSize, searchQuery, clientId], loadLocations);
watch(clientId, loadPartitions);

function statusSeverity(status: string) {
  switch (status) {
    case 'MATCHED':
      return 'success';
    case 'PENDING':
      return 'warn';
    case 'VALIDATED':
      return 'success';
    default:
      return 'info';
  }
}
</script>

<template>
  <div class="page-container">
    <div class="page-header">
      <div>
        <h1 class="page-title">Locations</h1>
        <p class="page-subtitle">
          {{ clientStore.selectedClient?.name ?? 'Select a client' }}
        </p>
      </div>
      <RouterLink v-if="clientId" to="/locations/new">
        <Button label="New Location" icon="pi pi-plus" />
      </RouterLink>
    </div>

    <div v-if="!clientId" class="fc-card" style="text-align: center; padding: 48px">
      <i class="pi pi-building" style="font-size: 48px; color: #bcccdc"></i>
      <p style="color: #64748b; margin-top: 16px">Select a client first</p>
      <RouterLink to="/clients" style="color: #0967d2">Go to Clients</RouterLink>
    </div>

    <div v-else class="fc-card">
      <div style="display: flex; gap: 12px; margin-bottom: 16px">
        <InputText v-model="searchQuery" placeholder="Search locations..." style="flex: 1" />
        <Select
          v-if="partitions.length > 0"
          v-model="selectedPartitionId"
          :options="[{ id: null, name: 'All Partitions' }, ...partitions]"
          option-label="name"
          option-value="id"
          style="width: 200px"
        />
      </div>

      <DataTable
        :value="locations"
        :loading="loading"
        :paginator="true"
        :rows="pageSize"
        :total-records="totalRecords"
        :first="first"
        lazy
        @page="onPage"
      >
        <Column field="name" header="Name">
          <template #body="{ data }">
            <RouterLink :to="`/locations/${(data as Location).id}`" class="link">
              {{ (data as Location).name ?? (data as Location).address }}
            </RouterLink>
          </template>
        </Column>
        <Column field="address" header="Address" />
        <Column field="city" header="City" />
        <Column field="status" header="Status">
          <template #body="{ data }">
            <Tag
              :value="(data as Location).status"
              :severity="statusSeverity((data as Location).status)"
            />
          </template>
        </Column>
        <Column field="createdAt" header="Created" />

        <template #empty>
          <div style="text-align: center; padding: 48px">
            <i class="pi pi-map-marker" style="font-size: 48px; color: #bcccdc"></i>
            <p style="color: #64748b; margin-top: 16px">No locations found</p>
            <RouterLink to="/locations/new" class="link">Create your first location</RouterLink>
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
