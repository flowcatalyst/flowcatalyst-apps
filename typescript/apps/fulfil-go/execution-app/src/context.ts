import { inject, type InjectionKey } from 'vue';
import { Capacitor } from '@capacitor/core';
import {
  bindLifecycle,
  createApiClient,
  createAuthClient,
  createMemoryQueueStorage,
  createOfflineQueue,
  createPreferencesTokenStore,
  createSession,
  createSqliteQueueStorage,
  createSseClient,
  type ApiClient,
  type AuthClient,
  type OfflineQueue,
  type Session,
  type SseClient,
} from '@fulfil-go/mobile-kit';
import { createJobsStore, type JobsStore } from './stores/jobs.js';

export const REDIRECT_URI = 'fulfilgo-exec://auth/callback';

export interface AppCtx {
  readonly isNative: boolean;
  readonly session: Session;
  readonly api: ApiClient;
  readonly auth: AuthClient;
  readonly queue: OfflineQueue;
  readonly sse: SseClient;
  readonly jobs: JobsStore;
  /** Start hydrate + SSE + lifecycle wiring (idempotent). */
  startSync(): Promise<void>;
}

export const APP_CTX: InjectionKey<AppCtx> = Symbol('app-ctx');

export async function createAppCtx(): Promise<AppCtx> {
  const isNative = Capacitor.isNativePlatform();
  const baseUrl = import.meta.env.VITE_API_BASE_URL ?? '';

  const session = createSession({
    app: 'execution',
    store: createPreferencesTokenStore(),
    baseUrl,
  });
  const api = createApiClient(
    isNative
      ? { baseUrl, tokens: session }
      : { baseUrl, devUserId: import.meta.env.VITE_DEV_USER_ID ?? 'prn_driver1' },
  );
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
