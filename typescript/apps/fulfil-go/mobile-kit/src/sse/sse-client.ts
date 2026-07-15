import { createBackoff } from './reconnect.js';
import { createSseParser, type SseEvent } from './parser.js';

export type SseState = 'closed' | 'connecting' | 'open' | 'reconnecting';

export interface SseClientOptions {
  /** Full stream URL, e.g. `${baseUrl}/sse/channel`. */
  readonly url: string;
  /** Auth headers per (re)connect — ApiClient.authHeaders. */
  readonly getHeaders: () => Promise<Record<string, string>>;
  readonly onEvent: (event: SseEvent) => void;
  readonly onStateChange?: (state: SseState) => void;
  readonly fetchImpl?: typeof fetch;
  /**
   * Resume point restored from app state (e.g. a persisted store's
   * high-water mark) so a cold start doesn't replay the whole channel.
   */
  readonly initialLastEventId?: string | null;
}

export interface SseClient {
  connect(): void;
  disconnect(): void;
  /** Skip the backoff and reconnect now (app resume / network regain). */
  reconnectNow(): void;
  readonly lastEventId: string | null;
  readonly state: SseState;
}

/**
 * Foreground-persistent SSE over fetch streams with auto-reconnect and
 * Last-Event-ID resume. Backgrounding kills the socket eventually (OS
 * behaviour on both platforms — by design, see plan): lifecycle.ts
 * reconnects on resume, and the delta-sync endpoint covers longer gaps.
 */
export function createSseClient(options: SseClientOptions): SseClient {
  const fetchImpl = options.fetchImpl ?? fetch;
  const backoff = createBackoff();
  let state: SseState = 'closed';
  let lastEventId: string | null = options.initialLastEventId ?? null;
  let abort: AbortController | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let retryResolve: (() => void) | null = null;
  let generation = 0;

  function cancelRetryWait(): void {
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = null;
    // Release the run() loop awaiting the backoff so it can observe the
    // generation bump and exit instead of hanging forever.
    retryResolve?.();
    retryResolve = null;
  }

  function setState(next: SseState): void {
    if (state === next) return;
    state = next;
    options.onStateChange?.(next);
  }

  async function run(myGeneration: number): Promise<void> {
    for (;;) {
      if (myGeneration !== generation) return;
      abort = new AbortController();
      try {
        const headers: Record<string, string> = {
          accept: 'text/event-stream',
          ...(await options.getHeaders()),
          ...(lastEventId !== null ? { 'last-event-id': lastEventId } : {}),
        };
        const res = await fetchImpl(options.url, { headers, signal: abort.signal });
        if (!res.ok || !res.body) {
          throw new Error(`SSE connect failed: ${res.status}`);
        }
        setState('open');
        backoff.reset();

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        const parser = createSseParser();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          for (const event of parser.feed(decoder.decode(value, { stream: true }))) {
            if (event.id !== null) lastEventId = event.id;
            options.onEvent(event);
          }
        }
        // Server closed the stream — fall through to reconnect.
        throw new Error('SSE stream ended');
      } catch (err) {
        if (myGeneration !== generation) return; // disconnected on purpose
        setState('reconnecting');
        const delay = backoff.next();
        await new Promise<void>((resolve) => {
          retryResolve = resolve;
          retryTimer = setTimeout(resolve, delay);
        });
        retryTimer = null;
        retryResolve = null;
        void err;
      }
    }
  }

  return {
    connect(): void {
      if (state !== 'closed') return;
      generation += 1;
      setState('connecting');
      void run(generation);
    },

    disconnect(): void {
      generation += 1;
      cancelRetryWait();
      abort?.abort();
      abort = null;
      setState('closed');
    },

    reconnectNow(): void {
      if (state === 'closed') return;
      // Kill the current attempt/wait; a fresh run() takes over.
      const myGeneration = ++generation;
      cancelRetryWait();
      abort?.abort();
      setState('connecting');
      void run(myGeneration);
    },

    get lastEventId(): string | null {
      return lastEventId;
    },
    get state(): SseState {
      return state;
    },
  };
}
