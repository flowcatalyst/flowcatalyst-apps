<script setup lang="ts">
import { ref, onMounted, watch, computed } from 'vue';
import { useRouter } from 'vue-router';
import { apiFetch } from '@/api/client';
import { useClientStore } from '@/stores/client';
import { useAuthStore } from '@/stores/auth';
import { toast } from '@flowcatalyst-apps/web-kit';
import { getErrorMessage } from '@flowcatalyst-apps/web-kit';

interface Partition {
  id: string;
  code: string;
  name: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

interface PartitionListResponse {
  items: Partition[];
  total: number;
}

const router = useRouter();
const clientStore = useClientStore();
const authStore = useAuthStore();
const partitions = ref<Partition[]>([]);
const loading = ref(true);
const showCreateDialog = ref(false);
const creating = ref(false);

const createForm = ref({
  code: '',
  name: '',
  description: '',
});

const clientId = computed(() => clientStore.selectedClientId);

async function loadPartitions() {
  if (!clientId.value) {
    partitions.value = [];
    loading.value = false;
    return;
  }
  loading.value = true;
  try {
    const response = await apiFetch<PartitionListResponse>(`/clients/${clientId.value}/partitions`);
    partitions.value = response.items;
  } catch {
    partitions.value = [];
  } finally {
    loading.value = false;
  }
}

function openCreateDialog() {
  createForm.value = { code: '', name: '', description: '' };
  showCreateDialog.value = true;
}

async function handleCreate() {
  if (!clientId.value) return;
  creating.value = true;
  try {
    await apiFetch(`/clients/${clientId.value}/partitions`, {
      method: 'POST',
      body: JSON.stringify({
        code: createForm.value.code,
        name: createForm.value.name,
        description: createForm.value.description || null,
      }),
    }, { suppressErrorToast: true });
    toast.success('Partition Created', `Partition "${createForm.value.name}" has been created.`);
    showCreateDialog.value = false;
    await loadPartitions();
  } catch (e) {
    toast.error('Failed to create partition', getErrorMessage(e, 'Unknown error'));
  } finally {
    creating.value = false;
  }
}

function onRowClick(event: { data: Partition }) {
  void router.push(`/partitions/${event.data.id}`);
}

onMounted(loadPartitions);
watch(clientId, loadPartitions);
</script>

<template>
  <div class="page-container">
    <div class="page-header">
      <div>
        <h1 class="page-title">Partitions</h1>
        <p class="page-subtitle">
          {{ clientStore.selectedClient?.name ?? 'Select a client' }}
        </p>
      </div>
      <Button
        v-if="clientId && authStore.can('pinpoint:tenancy:partition:create')"
        label="New Partition"
        icon="pi pi-plus"
        @click="openCreateDialog"
      />
    </div>

    <div v-if="!clientId" class="fc-card" style="text-align: center; padding: 48px">
      <i class="pi pi-building" style="font-size: 48px; color: #bcccdc"></i>
      <p style="color: #64748b; margin-top: 16px">Select a client first</p>
      <RouterLink to="/clients" style="color: #0967d2">Go to Clients</RouterLink>
    </div>

    <div v-else class="fc-card">
      <DataTable
        :value="partitions"
        :loading="loading"
        @row-click="onRowClick"
        style="cursor: pointer"
      >
        <Column field="code" header="Code" />
        <Column field="name" header="Name" />
        <Column field="description" header="Description" />
        <Column field="createdAt" header="Created" />

        <template #empty>
          <div style="text-align: center; padding: 48px">
            <i class="pi pi-th-large" style="font-size: 48px; color: #bcccdc"></i>
            <p style="color: #64748b; margin-top: 16px">No partitions found</p>
            <Button
              label="Create First Partition"
              icon="pi pi-plus"
              severity="secondary"
              @click="openCreateDialog"
            />
          </div>
        </template>
      </DataTable>
    </div>

    <!-- Create Dialog -->
    <Dialog
      v-model:visible="showCreateDialog"
      header="New Partition"
      :modal="true"
      style="width: 480px"
    >
      <form @submit.prevent="handleCreate">
        <div style="display: flex; flex-direction: column; gap: 16px">
          <div>
            <label for="code" style="display: block; margin-bottom: 6px; font-weight: 500"
              >Code</label
            >
            <InputText
              id="code"
              v-model="createForm.code"
              placeholder="e.g. gauteng, western-cape"
              class="w-full"
              required
            />
            <small style="color: #64748b"
              >Unique identifier. Cannot be changed after creation.</small
            >
          </div>
          <div>
            <label for="name" style="display: block; margin-bottom: 6px; font-weight: 500"
              >Name</label
            >
            <InputText
              id="name"
              v-model="createForm.name"
              placeholder="e.g. Gauteng"
              class="w-full"
              required
            />
          </div>
          <div>
            <label for="description" style="display: block; margin-bottom: 6px; font-weight: 500"
              >Description</label
            >
            <InputText
              id="description"
              v-model="createForm.description"
              placeholder="Optional description"
              class="w-full"
            />
          </div>
        </div>
      </form>
      <template #footer>
        <Button label="Cancel" severity="secondary" @click="showCreateDialog = false" />
        <Button label="Create" :loading="creating" @click="handleCreate" />
      </template>
    </Dialog>
  </div>
</template>
