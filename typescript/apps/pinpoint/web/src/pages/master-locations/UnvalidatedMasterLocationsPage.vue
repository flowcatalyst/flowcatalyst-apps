<script setup lang="ts">
import { ref, onMounted, watch, computed } from 'vue';
import { apiFetch } from '@/api/client';
import { useClientStore } from '@/stores/client';

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

const clientStore = useClientStore();
const clients = computed(() => clientStore.clients ?? []);

const masterLocations = ref<MasterLocation[]>([]);
const totalRecords = ref(0);
const loading = ref(true);
const selectedClientId = ref<string | null>(null);
const partitions = ref<Partition[]>([]);
const selectedPartitionId = ref<string | null>(null);

async function loadPartitions() {
  partitions.value = [];
  selectedPartitionId.value = null;
  if (!selectedClientId.value) return;
  try {
    const resp = await apiFetch<{ items: Partition[] }>(
      `/clients/${selectedClientId.value}/partitions`,
    );
    partitions.value = resp.items;
  } catch {
    /* optional */
  }
}

async function loadUnvalidated() {
  loading.value = true;
  masterLocations.value = [];
  totalRecords.value = 0;

  const clientsToLoad = selectedClientId.value ? [{ id: selectedClientId.value }] : clients.value;

  try {
    for (const client of clientsToLoad) {
      for (const status of ['PENDING', 'GEOCODED']) {
        const params = new URLSearchParams();
        params.set('page', '0');
        params.set('pageSize', '200');
        params.set('status', status);
        const resp = await apiFetch<MasterLocationListResponse>(
          `/clients/${client.id}/master-locations?${params.toString()}`,
        );
        masterLocations.value.push(...resp.items);
        totalRecords.value += resp.total;
      }
    }
  } catch {
    // skip failed
  } finally {
    loading.value = false;
  }
}

onMounted(loadUnvalidated);
watch(selectedClientId, () => {
  loadPartitions();
  loadUnvalidated();
});
watch(selectedPartitionId, loadUnvalidated);

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
</script>

<template>
  <div class="page-container">
    <div class="page-header">
      <div>
        <h1 class="page-title">Unvalidated Master Locations</h1>
        <p class="page-subtitle">Master locations pending validation</p>
      </div>
      <div style="display: flex; gap: 8px">
        <Select
          v-model="selectedClientId"
          :options="[{ id: null, name: 'All Clients' }, ...clients]"
          option-label="name"
          option-value="id"
          placeholder="All Clients"
          style="width: 220px"
        />
        <Select
          v-if="selectedClientId && partitions.length > 0"
          v-model="selectedPartitionId"
          :options="[{ id: null, name: 'All Partitions' }, ...partitions]"
          option-label="name"
          option-value="id"
          placeholder="All Partitions"
          style="width: 200px"
        />
      </div>
    </div>

    <div class="fc-card">
      <DataTable
        :value="masterLocations"
        :loading="loading"
        :paginator="masterLocations.length > 20"
        :rows="20"
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
            <i class="pi pi-check-circle" style="font-size: 48px; color: #10b981"></i>
            <p style="color: #64748b; margin-top: 16px">All master locations are validated</p>
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
