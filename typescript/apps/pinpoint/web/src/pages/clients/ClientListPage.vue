<script setup lang="ts">
import { onMounted, watch } from 'vue';
import { useRouter } from 'vue-router';
import { useClientStore, type Client } from '@/stores/client';
import { useAuthStore } from '@/stores/auth';
import { useListState } from '@flowcatalyst-apps/web-kit';

const router = useRouter();
const clientStore = useClientStore();
const authStore = useAuthStore();

const { searchQuery } = useListState({
  search: { queryKey: 'q' },
  pagination: false,
  sort: false,
});

function onRowSelect(event: { data: Client }) {
  clientStore.selectClient(event.data.id);
  void router.push(`/clients/${event.data.id}`);
}

onMounted(() => clientStore.loadClients());
watch(searchQuery, () => clientStore.loadClients());
</script>

<template>
  <div class="page-container">
    <div class="page-header">
      <div>
        <h1 class="page-title">Clients</h1>
        <p class="page-subtitle">Manage client accounts</p>
      </div>
      <Button
        v-if="authStore.can('pinpoint:tenancy:client:create')"
        label="New Client"
        icon="pi pi-plus"
        @click="router.push('/clients/new')"
      />
    </div>

    <div class="fc-card">
      <div style="margin-bottom: 16px">
        <InputText v-model="searchQuery" placeholder="Search clients..." class="w-full" />
      </div>

      <DataTable
        :value="clientStore.clients"
        :loading="clientStore.loading"
        selection-mode="single"
        @row-select="onRowSelect"
      >
        <Column field="name" header="Name" />
        <Column field="status" header="Status">
          <template #body="{ data }">
            <Tag
              :value="(data as Client).status"
              :severity="(data as Client).status === 'ACTIVE' ? 'success' : 'warn'"
            />
          </template>
        </Column>
        <Column field="createdAt" header="Created" />

        <template #empty>
          <div style="text-align: center; padding: 48px">
            <p style="color: #64748b">No clients found</p>
          </div>
        </template>
      </DataTable>
    </div>
  </div>
</template>
