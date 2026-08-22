<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { api, ok, type ApiResponse } from '@/api/client';

type Client = ApiResponse<'/bff/clients/{clientId}', 'get'>;

const route = useRoute();
const client = ref<Client | null>(null);
const loading = ref(true);

onMounted(async () => {
  try {
    client.value = await ok(
      api.GET('/bff/clients/{clientId}', {
        params: { path: { clientId: route.params['id'] as string } },
      }),
    );
  } catch {
    // handled by global error toast
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <div class="page-container" style="max-width: 800px">
    <ProgressSpinner v-if="loading" style="display: flex; justify-content: center; padding: 48px" />

    <template v-else-if="client">
      <div class="page-header">
        <div>
          <h1 class="page-title">{{ client.name }}</h1>
          <p class="page-subtitle">Client details</p>
        </div>
        <Tag :value="client.status" :severity="client.status === 'ACTIVE' ? 'success' : 'warn'" />
      </div>

      <div class="fc-card">
        <div class="detail-grid">
          <div class="detail-item">
            <span class="detail-label">ID</span>
            <span class="detail-value">{{ client.id }}</span>
          </div>
          <div class="detail-item">
            <span class="detail-label">Name</span>
            <span class="detail-value">{{ client.name }}</span>
          </div>
          <div class="detail-item">
            <span class="detail-label">Status</span>
            <span class="detail-value">{{ client.status }}</span>
          </div>
          <div class="detail-item">
            <span class="detail-label">Created</span>
            <span class="detail-value">{{ client.createdAt }}</span>
          </div>
          <div class="detail-item">
            <span class="detail-label">Updated</span>
            <span class="detail-value">{{ client.updatedAt }}</span>
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
