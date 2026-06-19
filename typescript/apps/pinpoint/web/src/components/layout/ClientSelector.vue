<script setup lang="ts">
import { computed } from 'vue';
import { useClientStore } from '@/stores/client';

defineProps<{
  collapsed: boolean;
}>();

const clientStore = useClientStore();

const clientOptions = computed(() =>
  clientStore.clients.map((c) => ({ label: c.name, value: c.id })),
);

const selectedClientId = computed({
  get: () => clientStore.selectedClientId,
  set: (val: string | null) => {
    if (val) clientStore.selectClient(val);
  },
});
</script>

<template>
  <div v-if="!collapsed && clientOptions.length > 0" class="client-selector">
    <span class="client-selector-label">Client</span>
    <Select
      v-model="selectedClientId"
      :options="clientOptions"
      option-label="label"
      option-value="value"
      placeholder="Select client..."
      class="client-select"
    />
  </div>
  <div
    v-else-if="collapsed && clientStore.selectedClient"
    class="client-selector-collapsed"
    :title="clientStore.selectedClient.name"
  >
    <i class="pi pi-building"></i>
  </div>
</template>

<style scoped>
.client-selector {
  padding: 12px 16px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.client-selector-label {
  display: block;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: rgba(255, 255, 255, 0.4);
  margin-bottom: 6px;
}

.client-select {
  width: 100%;
}

.client-selector-collapsed {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 12px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  color: #47a3f3;
  font-size: 18px;
}
</style>
