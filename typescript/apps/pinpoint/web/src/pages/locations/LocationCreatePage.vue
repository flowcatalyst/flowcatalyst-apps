<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { apiFetch } from '@/api/client';
import { useClientStore } from '@/stores/client';
import { toast } from '@flowcatalyst-apps/web-kit';
import { getErrorMessage } from '@flowcatalyst-apps/web-kit';

interface Partition {
  id: string;
  code: string;
  name: string;
}

interface PartitionListResponse {
  items: Partition[];
  total: number;
}

const router = useRouter();
const clientStore = useClientStore();
const saving = ref(false);
const clientId = computed(() => clientStore.selectedClientId);
const partitions = ref<Partition[]>([]);

const form = ref({
  address: '',
  name: '',
  externalId: '',
  partitionId: null as string | null,
});

onMounted(async () => {
  if (!clientId.value) return;
  try {
    const response = await apiFetch<PartitionListResponse>(`/clients/${clientId.value}/partitions`);
    partitions.value = response.items;
  } catch {
    // partition list is optional
  }
});

async function handleSubmit() {
  if (!clientId.value || !form.value.address.trim()) return;
  saving.value = true;
  try {
    const body: Record<string, unknown> = {
      address: form.value.address.trim(),
    };
    if (form.value.name.trim()) body['name'] = form.value.name.trim();
    if (form.value.externalId.trim()) body['externalId'] = form.value.externalId.trim();
    if (form.value.partitionId) body['partitionId'] = form.value.partitionId;

    const result = await apiFetch<{ id: string }>(`/clients/${clientId.value}/locations`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    toast.success('Location Created', 'The location has been created and is being processed.');
    await router.push(`/locations/${result.id}`);
  } catch (e) {
    toast.error('Failed to create location', getErrorMessage(e, 'Unknown error'));
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="page-container" style="max-width: 800px">
    <div style="margin-bottom: 12px">
      <Button
        label="Back to Locations"
        icon="pi pi-arrow-left"
        severity="secondary"
        text
        @click="router.push('/locations')"
      />
    </div>

    <div class="page-header">
      <div>
        <h1 class="page-title">New Location</h1>
        <p class="page-subtitle">
          {{ clientStore.selectedClient?.name ?? 'Select a client' }}
        </p>
      </div>
    </div>

    <div v-if="!clientId" class="fc-card" style="text-align: center; padding: 48px">
      <i class="pi pi-building" style="font-size: 48px; color: #bcccdc"></i>
      <p style="color: #64748b; margin-top: 16px">Select a client first</p>
      <RouterLink to="/clients" style="color: #0967d2">Go to Clients</RouterLink>
    </div>

    <div v-else class="fc-card">
      <form @submit.prevent="handleSubmit">
        <div style="display: flex; flex-direction: column; gap: 16px">
          <div>
            <label for="address" style="display: block; margin-bottom: 6px; font-weight: 500"
              >Address</label
            >
            <InputText
              id="address"
              v-model="form.address"
              placeholder="e.g. 123 Main Street, Cape Town, South Africa"
              class="w-full"
              required
            />
            <small style="color: #64748b">
              Enter the full address as a single line. It will be automatically parsed and
              normalized.
            </small>
          </div>

          <div>
            <label for="name" style="display: block; margin-bottom: 6px; font-weight: 500"
              >Name</label
            >
            <InputText
              id="name"
              v-model="form.name"
              placeholder="Optional display name"
              class="w-full"
            />
          </div>

          <div>
            <label for="externalId" style="display: block; margin-bottom: 6px; font-weight: 500"
              >External ID</label
            >
            <InputText
              id="externalId"
              v-model="form.externalId"
              placeholder="Optional external system reference"
              class="w-full"
            />
            <small style="color: #64748b"
              >Used for deduplication when importing from external systems.</small
            >
          </div>

          <div>
            <label for="partition" style="display: block; margin-bottom: 6px; font-weight: 500"
              >Partition</label
            >
            <Select
              id="partition"
              v-model="form.partitionId"
              :options="partitions"
              option-label="name"
              option-value="id"
              placeholder="Default partition"
              class="w-full"
              show-clear
            />
            <small style="color: #64748b">Leave empty to use the default partition.</small>
          </div>

          <div style="display: flex; gap: 8px; justify-content: flex-end">
            <Button label="Cancel" severity="secondary" @click="router.push('/locations')" />
            <Button
              label="Create Location"
              type="submit"
              icon="pi pi-plus"
              :loading="saving"
              :disabled="!form.address.trim()"
            />
          </div>
        </div>
      </form>
    </div>
  </div>
</template>
