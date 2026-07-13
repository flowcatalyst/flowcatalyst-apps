import { computed, ref, watch } from 'vue';
import { createApiClient } from '@fulfil-go/mobile-kit/api';
import { session } from './auth/session.js';

/**
 * Management-app context. Signed in → real OIDC bearer via the 'management'
 * OAuth client (src/auth/session.ts); signed out → the server's x-user-id
 * dev fallback keeps browser dev working without a login.
 */
export const api = createApiClient({
  baseUrl: import.meta.env.VITE_API_BASE_URL ?? '',
  tokens: session,
  devUserId: import.meta.env.VITE_DEV_USER_ID ?? 'prn_manager',
  devUserName: import.meta.env.VITE_DEV_USER_NAME ?? 'Manager',
});

/**
 * Active tenant — most operations are client-scoped. Defaults to the
 * platform's Inhance client (set up for the generator + dev operations).
 * The registry (GET /auth/clients → the platform's client list) backs the
 * profile popover's switcher and resolves the display NAME.
 */
export const clientId = ref(
  localStorage.getItem('fulfilgo.mgmt.clientId.v2') ?? 'clt_6F9GM54BB5G2Y',
);
watch(clientId, (value) => localStorage.setItem('fulfilgo.mgmt.clientId.v2', value));

export interface ClientEntry {
  id: string;
  name: string;
  identifier: string;
}

export const availableClients = ref<ClientEntry[]>([]);

export async function loadClients(): Promise<void> {
  try {
    const res = await api.json<{ clients: ClientEntry[] }>('/auth/clients');
    availableClients.value = res.clients;
  } catch {
    // Platform unreachable/unconfigured — the switcher degrades to the raw id.
    availableClients.value = [];
  }
}

/** Display name of the active client; the raw id until the registry loads. */
export const clientName = computed(
  () => availableClients.value.find((c) => c.id === clientId.value)?.name ?? clientId.value,
);
