<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useConfirm } from 'primevue/useconfirm';
import { apiFetch } from '@/api/client';
import { useClientStore } from '@/stores/client';
import { toast } from '@flowcatalyst-apps/web-kit';
import { getErrorMessage } from '@flowcatalyst-apps/web-kit';

interface PartitionDetail {
  id: string;
  code: string;
  name: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

const route = useRoute();
const router = useRouter();
const confirm = useConfirm();
const clientStore = useClientStore();
const partition = ref<PartitionDetail | null>(null);
const loading = ref(true);
const editing = ref(false);
const saving = ref(false);

const editForm = ref({
  name: '',
  description: '',
});

onMounted(async () => {
  const clientId = clientStore.selectedClientId;
  if (!clientId) {
    loading.value = false;
    return;
  }
  try {
    partition.value = await apiFetch<PartitionDetail>(
      `/clients/${clientId}/partitions/${route.params['id'] as string}`,
    );
  } catch {
    // handled by global error toast
  } finally {
    loading.value = false;
  }
});

function startEdit() {
  if (!partition.value) return;
  editForm.value = {
    name: partition.value.name,
    description: partition.value.description ?? '',
  };
  editing.value = true;
}

function cancelEdit() {
  editing.value = false;
}

async function handleSave() {
  const clientId = clientStore.selectedClientId;
  if (!partition.value || !clientId) return;
  saving.value = true;
  try {
    partition.value = await apiFetch<PartitionDetail>(
      `/clients/${clientId}/partitions/${partition.value.id}`,
      {
        method: 'PUT',
        body: JSON.stringify({
          name: editForm.value.name,
          description: editForm.value.description || null,
        }),
      },
    );
    toast.success('Saved', 'Partition updated.');
    editing.value = false;
  } catch (e) {
    toast.error('Failed to save', getErrorMessage(e, 'Unknown error'));
  } finally {
    saving.value = false;
  }
}

function confirmDelete() {
  confirm.require({
    message: `Are you sure you want to delete partition "${partition.value?.name}"? This will also remove all associated data.`,
    header: 'Delete Partition',
    icon: 'pi pi-exclamation-triangle',
    acceptClass: 'p-button-danger',
    accept: handleDelete,
  });
}

async function handleDelete() {
  const clientId = clientStore.selectedClientId;
  if (!partition.value || !clientId) return;
  try {
    await apiFetch(`/clients/${clientId}/partitions/${partition.value.id}`, { method: 'DELETE' });
    toast.success('Deleted', `Partition "${partition.value.name}" has been deleted.`);
    await router.push('/partitions');
  } catch (e) {
    toast.error('Failed to delete', getErrorMessage(e, 'Unknown error'));
  }
}
</script>

<template>
  <div class="page-container" style="max-width: 800px">
    <ProgressSpinner v-if="loading" style="display: flex; justify-content: center; padding: 48px" />

    <template v-else-if="partition">
      <div style="margin-bottom: 12px">
        <Button
          label="Back to Partitions"
          icon="pi pi-arrow-left"
          severity="secondary"
          text
          @click="router.push('/partitions')"
        />
      </div>

      <div class="page-header">
        <div>
          <h1 class="page-title">{{ partition.name }}</h1>
          <p class="page-subtitle">{{ partition.code }}</p>
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
            @click="confirmDelete"
          />
        </div>
      </div>

      <!-- Edit form -->
      <div v-if="editing" class="fc-card">
        <form @submit.prevent="handleSave">
          <div style="display: flex; flex-direction: column; gap: 16px">
            <div>
              <label style="display: block; margin-bottom: 6px; font-weight: 500">Code</label>
              <InputText :model-value="partition.code" class="w-full" disabled />
              <small style="color: #94a3b8">Code cannot be changed</small>
            </div>
            <div>
              <label for="edit-name" style="display: block; margin-bottom: 6px; font-weight: 500"
                >Name</label
              >
              <InputText id="edit-name" v-model="editForm.name" class="w-full" required />
            </div>
            <div>
              <label for="edit-desc" style="display: block; margin-bottom: 6px; font-weight: 500"
                >Description</label
              >
              <InputText id="edit-desc" v-model="editForm.description" class="w-full" />
            </div>
            <div style="display: flex; gap: 8px; justify-content: flex-end">
              <Button label="Cancel" severity="secondary" @click="cancelEdit" />
              <Button label="Save" type="submit" :loading="saving" />
            </div>
          </div>
        </form>
      </div>

      <!-- Detail view -->
      <div v-else class="fc-card">
        <div class="detail-grid">
          <div class="detail-item">
            <span class="detail-label">ID</span>
            <span class="detail-value">{{ partition.id }}</span>
          </div>
          <div class="detail-item">
            <span class="detail-label">Code</span>
            <span class="detail-value">{{ partition.code }}</span>
          </div>
          <div class="detail-item">
            <span class="detail-label">Name</span>
            <span class="detail-value">{{ partition.name }}</span>
          </div>
          <div class="detail-item">
            <span class="detail-label">Description</span>
            <span class="detail-value">{{ partition.description ?? '—' }}</span>
          </div>
          <div class="detail-item">
            <span class="detail-label">Created</span>
            <span class="detail-value">{{ partition.createdAt }}</span>
          </div>
          <div class="detail-item">
            <span class="detail-label">Updated</span>
            <span class="detail-value">{{ partition.updatedAt }}</span>
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
</style>
