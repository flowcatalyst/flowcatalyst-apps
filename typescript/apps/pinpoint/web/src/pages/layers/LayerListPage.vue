<script setup lang="ts">
import { ref, onMounted, watch, computed } from 'vue';
import { useRouter } from 'vue-router';
import { apiFetch } from '@/api/client';
import { useClientStore } from '@/stores/client';
import { useAuthStore } from '@/stores/auth';
import { useListState } from '@flowcatalyst-apps/web-kit';

interface Layer {
  id: string;
  code: string;
  name: string;
  layerType: string;
  status: string;
  propertySetCount: number;
  createdAt: string;
}

interface LayerListResponse {
  items: Layer[];
  total: number;
}

const router = useRouter();
const clientStore = useClientStore();
const authStore = useAuthStore();

const { page, pageSize, first, searchQuery, onPage } = useListState({
  search: { queryKey: 'q' },
});

const layers = ref<Layer[]>([]);
const totalRecords = ref(0);
const loading = ref(true);

const clientId = computed(() => clientStore.selectedClientId);

async function loadLayers() {
  if (!clientId.value) {
    layers.value = [];
    loading.value = false;
    return;
  }
  loading.value = true;
  try {
    const params = new URLSearchParams();
    params.set('page', String(page.value));
    params.set('page_size', String(pageSize.value));
    if (searchQuery.value) params.set('q', searchQuery.value);

    const response = await apiFetch<LayerListResponse>(
      `/clients/${clientId.value}/layers?${params.toString()}`,
    );
    layers.value = response.items;
    totalRecords.value = response.total;
  } catch {
    layers.value = [];
  } finally {
    loading.value = false;
  }
}

onMounted(loadLayers);
watch([page, pageSize, searchQuery, clientId], loadLayers);
</script>

<template>
  <div class="page-container">
    <div class="page-header">
      <div>
        <h1 class="page-title">Layers</h1>
        <p class="page-subtitle">
          {{ clientStore.selectedClient?.name ?? 'Select a client' }}
        </p>
      </div>
      <div v-if="clientId" style="display: flex; gap: 8px">
        <Button
          label="Map View"
          icon="pi pi-map"
          severity="secondary"
          @click="router.push('/layers/map')"
        />
        <Button
          v-if="authStore.can('pinpoint:layers:layer:create')"
          label="New Layer"
          icon="pi pi-plus"
          @click="router.push('/layers/new')"
        />
      </div>
    </div>

    <div v-if="!clientId" class="fc-card" style="text-align: center; padding: 48px">
      <i class="pi pi-building" style="font-size: 48px; color: #bcccdc"></i>
      <p style="color: #64748b; margin-top: 16px">Select a client first</p>
      <RouterLink to="/clients" style="color: #0967d2">Go to Clients</RouterLink>
    </div>

    <div v-else class="fc-card">
      <div style="margin-bottom: 16px">
        <InputText v-model="searchQuery" placeholder="Search layers..." class="w-full" />
      </div>

      <DataTable
        :value="layers"
        :loading="loading"
        :paginator="true"
        :rows="pageSize"
        :total-records="totalRecords"
        :first="first"
        lazy
        @page="onPage"
      >
        <Column field="code" header="Code" />
        <Column field="name" header="Name">
          <template #body="{ data }">
            <RouterLink :to="`/layers/${(data as Layer).id}`" class="link">
              {{ (data as Layer).name }}
            </RouterLink>
          </template>
        </Column>
        <Column field="layerType" header="Type">
          <template #body="{ data }">
            <Tag :value="(data as Layer).layerType" severity="info" />
          </template>
        </Column>
        <Column field="propertySetCount" header="Properties" />
        <Column field="createdAt" header="Created" />

        <template #empty>
          <div style="text-align: center; padding: 48px">
            <i class="pi pi-clone" style="font-size: 48px; color: #bcccdc"></i>
            <p style="color: #64748b; margin-top: 16px">No layers found</p>
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
