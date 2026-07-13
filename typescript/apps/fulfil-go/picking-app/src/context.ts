import { inject, ref, watch, type InjectionKey, type Ref } from 'vue';
import { Capacitor } from '@capacitor/core';
import {
  bindLifecycle,
  createApiClient,
  createMemoryQueueStorage,
  createOfflineQueue,
  createPickerSession,
  createPreferencesTokenStore,
  createSqliteQueueStorage,
  createSseClient,
  type ApiClient,
  type OfflineQueue,
  type PickerSession,
  type SseClient,
} from '@fulfil-go/mobile-kit';
import { createPicksStore, type PicksStore } from './stores/picks.js';

/**
 * Picking-app context — the pick context's LOCAL auth plane (staff-code+PIN
 * picker sessions), NOT platform OIDC and NOT the x-user-id dev fallback:
 * pick endpoints authorize on the session token's storeRef attribute, which
 * only a real picker login carries. Identical in browser dev and native.
 *
 * Station binding: clientId + storeRef persisted on the device — the manual
 * placeholder for device enrollment (an admin configures the station once;
 * pickers come and go per shift). Set on the Settings page.
 *
 * Realtime: one SSE stream per station on the STORE channel — /sse/channel
 * routes picker sessions to `store:<clientId>:<storeRef>` server-side. The
 * stream is person-session-gated (connect after login, disconnect on Exit).
 */
interface StationConfig {
  readonly clientId: Ref<string>;
  readonly storeRef: Ref<string>;
  /** Bound label printer (prt_…) from the store's registry — like the store
   * binding, device-local; host/port are fetched at print time so equipment
   * edits take effect without re-binding (docs/bag-label-printing.md). */
  readonly printerId: Ref<string>;
  readonly printerName: Ref<string>;
  readonly configured: () => boolean;
}

function createStationConfig(): StationConfig {
  const clientId = ref(localStorage.getItem('fulfilgo.pick.station.clientId') ?? '');
  const storeRef = ref(localStorage.getItem('fulfilgo.pick.station.storeRef') ?? '');
  const printerId = ref(localStorage.getItem('fulfilgo.pick.station.printerId') ?? '');
  const printerName = ref(localStorage.getItem('fulfilgo.pick.station.printerName') ?? '');
  watch(clientId, (v) => localStorage.setItem('fulfilgo.pick.station.clientId', v));
  watch(storeRef, (v) => localStorage.setItem('fulfilgo.pick.station.storeRef', v));
  watch(printerId, (v) => localStorage.setItem('fulfilgo.pick.station.printerId', v));
  watch(printerName, (v) => localStorage.setItem('fulfilgo.pick.station.printerName', v));
  return {
    clientId,
    storeRef,
    printerId,
    printerName,
    configured: () => clientId.value.length > 0 && storeRef.value.length > 0,
  };
}

export interface AppCtx {
  readonly station: StationConfig;
  readonly session: PickerSession;
  readonly api: ApiClient;
  readonly picks: PicksStore;
  readonly sse: SseClient;
  /**
   * Offline outbox for pick outcomes (complete/fail): fast recovery backoff
   * (2.5s → 10s cap), patient while offline (network errors never dead-
   * letter), Idempotency-Key replay server-side. Claiming stays ONLINE-ONLY
   * on purpose — it's store-wide contention and must be authoritative.
   */
  readonly queue: OfflineQueue;
  /** Reactive person-session state — drives the header Exit button + guard. */
  readonly signedIn: Ref<boolean>;
  /** Signed-in picker id (pkr_…) from /pick-auth/me; null between shifts. */
  readonly pickerId: Ref<string | null>;
  /** After login (or on app start with a live session): me + snapshot + stream. */
  startShift(): Promise<void>;
  /** Person sign-out (Exit) — station binding survives; stream stops. */
  exit(): Promise<void>;
}

export const APP_CTX: InjectionKey<AppCtx> = Symbol('app-ctx');

export async function createAppCtx(): Promise<AppCtx> {
  const baseUrl = import.meta.env.VITE_API_BASE_URL ?? '';
  const isNative = Capacitor.isNativePlatform();
  const station = createStationConfig();
  const signedIn = ref(false);
  const pickerId = ref<string | null>(null);

  const session = createPickerSession({
    store: createPreferencesTokenStore('fulfilgo.picker.tokens'),
    baseUrl,
    getClientId: () => (station.clientId.value.length > 0 ? station.clientId.value : null),
    onSignedOut: () => {
      signedIn.value = false;
      pickerId.value = null;
      sse.disconnect();
    },
  });
  const api = createApiClient({ baseUrl, tokens: session });
  const picks = createPicksStore(api, station.clientId, pickerId);

  const queue = createOfflineQueue({
    storage: isNative
      ? await createSqliteQueueStorage()
      : createMemoryQueueStorage('fulfilgo.pick.queue'),
    api,
    baseRetryMs: 2_500,
    maxRetryMs: 10_000, // Andrew's spec: never wait longer than 10s to retry
  });
  // Drain triggers: connectivity regain, a steady tick (cheap no-op when
  // empty), stream reopen, and app resume (bindLifecycle below).
  if (typeof window !== 'undefined') {
    window.addEventListener('online', () => void queue.flush());
    setInterval(() => void queue.flush(), 5_000);
  }

  const sse = createSseClient({
    url: `${baseUrl}/sse/channel`,
    getHeaders: () => api.authHeaders(),
    onEvent: (event) => picks.applySse(event),
    onStateChange: (state) => {
      picks.sseState.value = state;
      // Replay covers short gaps; a fresh 'open' after a long gap still
      // needs the snapshot — hydrate is cheap, do it on every open. A
      // reopened stream also means the network is back: drain the outbox.
      if (state === 'open') {
        void picks.hydrate();
        void queue.flush();
      }
    },
    initialLastEventId: picks.lastEventId.value,
  });
  bindLifecycle(sse, { onWake: () => void queue.flush() });

  return {
    station,
    session,
    api,
    picks,
    sse,
    queue,
    signedIn,
    pickerId,
    async startShift(): Promise<void> {
      const me = await api.json<{ pickerId: string }>(
        `/clients/${station.clientId.value}/pick-auth/me`,
      );
      pickerId.value = me.pickerId;
      signedIn.value = true;
      await picks.hydrate().catch(() => {
        // Offline start — SSE reconnect recovers.
      });
      sse.connect();
    },
    async exit(): Promise<void> {
      sse.disconnect();
      await session.signOut();
      picks.reset();
    },
  };
}

export function useAppCtx(): AppCtx {
  const ctx = inject(APP_CTX);
  if (!ctx) throw new Error('AppCtx not provided');
  return ctx;
}
