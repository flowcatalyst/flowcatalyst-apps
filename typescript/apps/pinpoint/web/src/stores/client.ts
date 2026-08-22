import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { api, ok, type ApiResponse } from '@/api/client';
import { useLocalState } from '@flowcatalyst-apps/web-kit';

export type Client = ApiResponse<'/bff/clients', 'get'>['items'][number];

export const useClientStore = defineStore('client', () => {
  const clients = ref<Client[]>([]);
  const selectedClientId = useLocalState<string | null>('pp:selected-client', null);
  const loading = ref(false);

  const selectedClient = computed(() => {
    if (!selectedClientId.value) return null;
    return clients.value.find((c) => c.id === selectedClientId.value) ?? null;
  });

  async function loadClients(): Promise<void> {
    loading.value = true;
    try {
      const response = await ok(api.GET('/bff/clients'));
      clients.value = response.items;

      // Auto-select first client if none selected
      if (!selectedClientId.value && clients.value.length > 0) {
        selectedClientId.value = clients.value[0]!.id;
      }
    } catch {
      clients.value = [];
    } finally {
      loading.value = false;
    }
  }

  function selectClient(clientId: string): void {
    selectedClientId.value = clientId;
  }

  return {
    clients,
    selectedClientId,
    selectedClient,
    loading,
    loadClients,
    selectClient,
  };
});
