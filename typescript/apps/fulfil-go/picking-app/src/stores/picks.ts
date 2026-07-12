import { computed, ref, type ComputedRef, type Ref } from 'vue';
import type { ApiClient, SseEvent, SseState } from '@fulfil-go/mobile-kit';
import type { PickDeltaSyncResponse, PickDto, PickSyncEventPayload } from '@fulfil-go/shared';

const LAST_EVENT_KEY = 'fulfilgo.pick.lastEventId';

/**
 * The station's pick working set, SSE-driven: hydrate a snapshot from
 * /sync/picks (which carries the STORE channel's high water), then apply
 * pick.* deltas as they stream in. `lastEventId` persists so a reload
 * resumes via Last-Event-ID replay instead of a cold snapshot.
 */
export interface PicksStore {
  readonly available: ComputedRef<readonly PickDto[]>;
  readonly mine: ComputedRef<readonly PickDto[]>;
  readonly loading: Ref<boolean>;
  readonly error: Ref<string | null>;
  readonly sseState: Ref<SseState>;
  readonly lastEventId: Ref<string | null>;
  hydrate(): Promise<void>;
  applySse(event: SseEvent): void;
  claim(pickId: string): Promise<void>;
  byId(id: string): PickDto | undefined;
  /**
   * Optimistic local terminal state for an outcome that was QUEUED offline —
   * drops the pick from Mine immediately; SSE/hydrate reconcile once the
   * queued request lands.
   */
  markLocallyTerminal(pickId: string, status: 'picked' | 'failed'): void;
  reset(): void;
}

export function createPicksStore(
  api: ApiClient,
  clientId: Ref<string>,
  pickerId: Ref<string | null>,
): PicksStore {
  const picks = ref<PickDto[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);
  const sseState = ref<SseState>('closed');
  const lastEventId = ref<string | null>(
    typeof localStorage !== 'undefined' ? localStorage.getItem(LAST_EVENT_KEY) : null,
  );

  function setLastEventId(id: string): void {
    lastEventId.value = id;
    if (typeof localStorage !== 'undefined') localStorage.setItem(LAST_EVENT_KEY, id);
  }

  function upsert(pick: PickDto): void {
    const index = picks.value.findIndex((p) => p.id === pick.id);
    if (index === -1) picks.value.push(pick);
    else picks.value[index] = pick;
  }

  const available = computed(() =>
    [...picks.value]
      .filter((p) => p.status === 'requested')
      .sort((a, b) => a.slotStart.localeCompare(b.slotStart)),
  );
  const mine = computed(() =>
    picks.value.filter(
      (p) => p.status === 'claimed' && pickerId.value !== null && p.claimedBy === pickerId.value,
    ),
  );

  return {
    available,
    mine,
    loading,
    error,
    sseState,
    lastEventId,

    async hydrate(): Promise<void> {
      loading.value = true;
      error.value = null;
      try {
        const res = await api.json<PickDeltaSyncResponse>(`/clients/${clientId.value}/sync/picks`);
        picks.value = [...res.picks];
        if (res.latestEventId !== '0') setLastEventId(res.latestEventId);
      } catch (err) {
        error.value = err instanceof Error ? err.message : String(err);
      } finally {
        loading.value = false;
      }
    },

    applySse(event: SseEvent): void {
      try {
        const payload = JSON.parse(event.data) as PickSyncEventPayload;
        upsert(payload.pick);
      } catch {
        return; // unknown payload — the next hydrate reconciles
      }
      if (event.id !== null) setLastEventId(event.id);
    },

    async claim(pickId: string): Promise<void> {
      error.value = null;
      // Optimistic: flip locally now; the pick.claimed event confirms (or a
      // hydrate reconciles if the server said no).
      const prior = picks.value.find((p) => p.id === pickId);
      if (prior && pickerId.value) {
        upsert({ ...prior, status: 'claimed', claimedBy: pickerId.value });
      }
      try {
        await api.json(`/clients/${clientId.value}/picks/${pickId}/claim`, { method: 'POST' });
      } catch (err) {
        // Typical race: someone else got it first (409) — reconcile.
        error.value = err instanceof Error ? err.message : String(err);
        await this.hydrate();
      }
    },

    byId: (id) => picks.value.find((p) => p.id === id),

    markLocallyTerminal(pickId, status): void {
      const prior = picks.value.find((p) => p.id === pickId);
      if (prior) upsert({ ...prior, status });
    },

    reset(): void {
      picks.value = [];
      error.value = null;
    },
  };
}
