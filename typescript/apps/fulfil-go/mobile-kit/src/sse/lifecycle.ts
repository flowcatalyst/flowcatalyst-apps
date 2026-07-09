import { App } from '@capacitor/app';
import { Network } from '@capacitor/network';
import type { SseClient } from './sse-client.js';

export interface LifecycleHooks {
  /** Also fired for the offline queue — flush on the same signals. */
  readonly onWake?: () => void;
}

/**
 * Reconnect the SSE stream when the app resumes or the network comes back —
 * the two moments the OS is likely to have silently killed the socket.
 * Returns a cleanup function.
 */
export function bindLifecycle(client: SseClient, hooks: LifecycleHooks = {}): () => void {
  const listeners = [
    App.addListener('appStateChange', ({ isActive }) => {
      if (!isActive) return;
      client.reconnectNow();
      hooks.onWake?.();
    }),
    Network.addListener('networkStatusChange', ({ connected }) => {
      if (!connected) return;
      client.reconnectNow();
      hooks.onWake?.();
    }),
  ];

  return () => {
    for (const listener of listeners) void listener.then((l) => l.remove());
  };
}
