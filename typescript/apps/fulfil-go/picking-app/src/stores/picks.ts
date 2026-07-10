import { computed, ref, type ComputedRef, type Ref } from 'vue';
import type { ApiClient } from '@fulfil-go/mobile-kit';
import type { PickDto } from '@fulfil-go/shared';

/**
 * Store-scoped pick list for the signed-in picker. The server derives the
 * store from the session token, so this store only tracks status + ownership.
 * Refresh is poll-based for now (SSE for picks is a follow-up — sync events
 * are per-principal channels; picks need a store channel first).
 */
export interface PicksStore {
  readonly available: Ref<readonly PickDto[]>;
  readonly mine: ComputedRef<readonly PickDto[]>;
  readonly loading: Ref<boolean>;
  readonly error: Ref<string | null>;
  load(): Promise<void>;
  claim(pickId: string): Promise<void>;
  reset(): void;
}

export function createPicksStore(
  api: ApiClient,
  clientId: Ref<string>,
  pickerId: Ref<string | null>,
): PicksStore {
  const available = ref<readonly PickDto[]>([]);
  const claimed = ref<readonly PickDto[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);

  const mine = computed(() =>
    claimed.value.filter((p) => pickerId.value !== null && p.claimedBy === pickerId.value),
  );

  async function load(): Promise<void> {
    loading.value = true;
    error.value = null;
    try {
      const base = `/clients/${clientId.value}/picks`;
      const [req, cla] = await Promise.all([
        api.json<{ picks: PickDto[] }>(`${base}?status=requested`),
        api.json<{ picks: PickDto[] }>(`${base}?status=claimed`),
      ]);
      available.value = req.picks;
      claimed.value = cla.picks;
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err);
    } finally {
      loading.value = false;
    }
  }

  async function claim(pickId: string): Promise<void> {
    error.value = null;
    try {
      await api.json(`/clients/${clientId.value}/picks/${pickId}/claim`, { method: 'POST' });
    } catch (err) {
      // Typical race: another picker got it first (409) — surface + reload.
      error.value = err instanceof Error ? err.message : String(err);
    }
    await load();
  }

  return {
    available,
    mine,
    loading,
    error,
    load,
    claim,
    reset(): void {
      available.value = [];
      claimed.value = [];
      error.value = null;
    },
  };
}
