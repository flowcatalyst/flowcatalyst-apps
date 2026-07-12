// @fulfil-go/mobile-kit — shared mobile plumbing for the fulfil-go apps.
// NOTE: telemetry is NOT exported here — import '@fulfil-go/mobile-kit/telemetry'
// (the Transistorsoft plugin is an optional peer only the execution app installs).

export { createApiClient } from './http/api-client.js';
export type {
  ApiClient,
  ApiClientOptions,
  ApiRequestInit,
  TokenProvider,
} from './http/api-client.js';

export { createPkcePair, randomState } from './auth/pkce.js';
export type { PkcePair } from './auth/pkce.js';
export { createPreferencesTokenStore } from './auth/token-store.js';
export type { StoredTokens, TokenStore } from './auth/token-store.js';
export { createSession } from './auth/session.js';
export type { Session, SessionOptions } from './auth/session.js';
export { createAuthClient } from './auth/auth-client.js';
export type { AuthClient, AuthClientOptions } from './auth/auth-client.js';
export { createPickerSession, pickerPinLogin, PickerLoginError } from './auth/picker-session.js';
export type { PickerSession, PickerSessionOptions, PinLoginInput } from './auth/picker-session.js';

export { createSseParser } from './sse/parser.js';
export type { SseEvent, SseParser } from './sse/parser.js';
export { createBackoff } from './sse/reconnect.js';
export type { Backoff } from './sse/reconnect.js';
export { createSseClient } from './sse/sse-client.js';
export type { SseClient, SseClientOptions, SseState } from './sse/sse-client.js';
export { bindLifecycle } from './sse/lifecycle.js';
export type { LifecycleHooks } from './sse/lifecycle.js';

export type {
  QueueCounts,
  QueueItem,
  QueueItemStatus,
  QueueStorage,
} from './queue/queue-storage.js';
export { createMemoryQueueStorage } from './queue/storage-memory.js';
export { createSqliteQueueStorage } from './queue/storage-sqlite.js';
export { createOfflineQueue } from './queue/offline-queue.js';
export type { EnqueueInput, OfflineQueue, OfflineQueueOptions } from './queue/offline-queue.js';
export { useQueue } from './queue/use-queue.js';
export type { QueueState } from './queue/use-queue.js';

export { default as MobileShell } from './shell/MobileShell.vue';
export { default as MobileHeader } from './shell/MobileHeader.vue';
export { default as BottomTabBar } from './shell/BottomTabBar.vue';
export { default as ConnectionBadge } from './shell/ConnectionBadge.vue';
export type { TabItem } from './shell/types.js';
