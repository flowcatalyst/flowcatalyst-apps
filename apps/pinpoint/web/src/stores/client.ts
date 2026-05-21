import { defineStore } from "pinia";
import { ref, computed } from "vue";
import { apiFetch } from "@/api/client";
import { useLocalState } from "@/composables/useLocalState";

export interface Client {
	id: string;
	name: string;
	code: string;
	status: string;
	createdAt: string;
	updatedAt: string;
}

interface ClientListResponse {
	items: Client[];
	total: number;
}

export const useClientStore = defineStore("client", () => {
	const clients = ref<Client[]>([]);
	const selectedClientId = useLocalState<string | null>("pp:selected-client", null);
	const loading = ref(false);

	const selectedClient = computed(() => {
		if (!selectedClientId.value) return null;
		return clients.value.find((c) => c.id === selectedClientId.value) ?? null;
	});

	async function loadClients(): Promise<void> {
		loading.value = true;
		try {
			const response = await apiFetch<ClientListResponse>("/clients");
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
