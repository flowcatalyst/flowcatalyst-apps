import { inject, ref, watch, type InjectionKey, type Ref } from 'vue';
import { Capacitor } from '@capacitor/core';
import {
  bindLifecycle,
  createApiClient,
  createAuthClient,
  createMemoryQueueStorage,
  createOfflineQueue,
  createPickerSession,
  createPreferencesTokenStore,
  createSession,
  createSqliteQueueStorage,
  createSseClient,
  type ApiClient,
  type AuthClient,
  type OfflineQueue,
  type PickerSession,
  type Session,
  type SseClient,
  type TokenProvider,
} from '@fulfil-go/mobile-kit';
import { createJobsStore, type JobsStore } from './stores/jobs.js';

export const REDIRECT_URI = 'fulfilgo-exec://auth/callback';

/**
 * Driver station binding — the execution app's mirror of the picking app's
 * station config (the manual placeholder for device enrollment): the device
 * is bound once to clientId + HOME DEPOT (depots registry — a depot serves
 * many stores); drivers come and go per shift with staff code + PIN.
 * Set on the Settings page.
 */
interface DriverStationConfig {
  readonly clientId: Ref<string>;
  readonly depotRef: Ref<string>;
  readonly configured: () => boolean;
}

function createDriverStationConfig(): DriverStationConfig {
  const clientId = ref(localStorage.getItem('fulfilgo.exec.station.clientId') ?? '');
  const depotRef = ref(localStorage.getItem('fulfilgo.exec.station.depotRef') ?? '');
  watch(clientId, (v) => localStorage.setItem('fulfilgo.exec.station.clientId', v));
  watch(depotRef, (v) => localStorage.setItem('fulfilgo.exec.station.depotRef', v));
  return {
    clientId,
    depotRef,
    configured: () => clientId.value.length > 0 && depotRef.value.length > 0,
  };
}

/** /driver-auth/me — the signed-in driver's identity + defaults. */
export interface DriverMe {
  readonly driverId: string;
  readonly depotRef: string;
  readonly displayName: string | null;
  readonly defaultVehicleReg: string | null;
  readonly defaultVehicleClass: string | null;
}

export interface AppCtx {
  readonly isNative: boolean;
  readonly session: Session;
  readonly api: ApiClient;
  readonly auth: AuthClient;
  readonly queue: OfflineQueue;
  readonly sse: SseClient;
  readonly jobs: JobsStore;
  /** Driver plane (staff code + PIN at the bound depot — the picker pattern). */
  readonly station: DriverStationConfig;
  readonly driverSession: PickerSession;
  readonly driverSignedIn: Ref<boolean>;
  readonly driver: Ref<DriverMe | null>;
  /** After driver login (or app start with a live session): load identity. */
  startDriverShift(): Promise<void>;
  /** Driver sign-out (Exit) — the station binding survives. */
  exitDriver(): Promise<void>;
  /** Start hydrate + SSE + lifecycle wiring (idempotent). */
  startSync(): Promise<void>;
}

export const APP_CTX: InjectionKey<AppCtx> = Symbol('app-ctx');

export async function createAppCtx(): Promise<AppCtx> {
  const isNative = Capacitor.isNativePlatform();
  const baseUrl = import.meta.env.VITE_API_BASE_URL ?? '';

  const station = createDriverStationConfig();
  const driverSignedIn = ref(false);
  const driver = ref<DriverMe | null>(null);

  const session = createSession({
    app: 'execution',
    store: createPreferencesTokenStore(),
    baseUrl,
  });
  const driverSession = createPickerSession({
    store: createPreferencesTokenStore('fulfilgo.driver.tokens'),
    baseUrl,
    authBasePath: 'driver-auth',
    getClientId: () => (station.clientId.value.length > 0 ? station.clientId.value : null),
    onSignedOut: () => {
      driverSignedIn.value = false;
      driver.value = null;
    },
  });

  // Auth priority: a signed-in DRIVER wins (transport endpoints authorize on
  // the driver session's depot attributes); otherwise platform OIDC (native)
  // or — via the api client's signed-out fallback — the browser dev header.
  const tokens: TokenProvider = {
    async getAccessToken() {
      return (await driverSession.getAccessToken()) ?? (await session.getAccessToken());
    },
    async refresh() {
      if (await driverSession.isAuthenticated()) return driverSession.refresh();
      return session.refresh();
    },
  };
  const api = createApiClient({
    baseUrl,
    tokens,
    ...(isNative ? {} : { devUserId: import.meta.env.VITE_DEV_USER_ID ?? 'prn_driver1' }),
  });
  const auth = createAuthClient({ app: 'execution', baseUrl, redirectUri: REDIRECT_URI, session });
  const queue = createOfflineQueue({
    storage: isNative
      ? await createSqliteQueueStorage()
      : createMemoryQueueStorage('fulfilgo.exec.queue'),
    api,
  });
  const jobs = createJobsStore(api, queue);

  const sse = createSseClient({
    url: `${baseUrl}/sse/channel`,
    getHeaders: () => api.authHeaders(),
    onEvent: (event) => jobs.applySse(event),
    onStateChange: (state) => {
      jobs.sseState.value = state;
      // Replay covers short gaps; a fresh 'open' after a long gap still
      // needs the snapshot — hydrate is cheap, do it on every open.
      if (state === 'open') void jobs.hydrate();
    },
    initialLastEventId: jobs.lastEventId.value,
  });

  let started = false;
  return {
    isNative,
    session,
    api,
    auth,
    queue,
    sse,
    jobs,
    station,
    driverSession,
    driverSignedIn,
    driver,
    async startDriverShift(): Promise<void> {
      const me = await api.json<DriverMe>(`/clients/${station.clientId.value}/driver-auth/me`);
      driver.value = me;
      driverSignedIn.value = true;
    },
    async exitDriver(): Promise<void> {
      await driverSession.signOut();
    },
    async startSync(): Promise<void> {
      if (started) return;
      started = true;
      await jobs.hydrate().catch(() => {
        // Offline start — SSE reconnect + queue flush recover later.
      });
      sse.connect();
      bindLifecycle(sse, { onWake: () => void queue.flush() });
    },
  };
}

export function useAppCtx(): AppCtx {
  const ctx = inject(APP_CTX);
  if (!ctx) throw new Error('AppCtx not provided');
  return ctx;
}
