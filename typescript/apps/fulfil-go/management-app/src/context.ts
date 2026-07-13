import { ref, watch } from 'vue';
import { createApiClient } from '@fulfil-go/mobile-kit/api';

/**
 * Management-app context. Browser dev authenticates via the server's
 * x-user-id dev fallback; real OIDC uses the 'management' OAuth client
 * (FULFILGO_OIDC_MANAGEMENT_CLIENT_ID) once the platform is provisioned —
 * the auth broker + PKCE flow are already server-side.
 */
export const api = createApiClient({
  baseUrl: import.meta.env.VITE_API_BASE_URL ?? '',
  devUserId: import.meta.env.VITE_DEV_USER_ID ?? 'prn_manager',
  devUserName: import.meta.env.VITE_DEV_USER_NAME ?? 'Manager',
});

/**
 * Active tenant — most operations are client-scoped. Defaults to the
 * platform's Inhance client (set up for the generator + dev operations);
 * no client registry endpoint yet, so a persisted input. (v2 key: the
 * default changed from the made-up cli_TESTCLIENT01.)
 */
export const clientId = ref(
  localStorage.getItem('fulfilgo.mgmt.clientId.v2') ?? 'clt_6F9GM54BB5G2Y',
);
watch(clientId, (value) => localStorage.setItem('fulfilgo.mgmt.clientId.v2', value));
