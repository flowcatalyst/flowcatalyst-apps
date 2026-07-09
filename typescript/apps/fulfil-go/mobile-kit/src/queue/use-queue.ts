import { onScopeDispose, ref, type Ref } from 'vue';
import type { OfflineQueue } from './offline-queue.js';

export interface QueueState {
  readonly pending: Ref<number>;
  readonly dead: Ref<number>;
}

/** Reactive pending/dead counts for UI badges (ConnectionBadge, settings). */
export function useQueue(queue: OfflineQueue): QueueState {
  const pending = ref(0);
  const dead = ref(0);

  async function refresh(): Promise<void> {
    const counts = await queue.counts();
    pending.value = counts.pending;
    dead.value = counts.dead;
  }

  void refresh();
  const unsubscribe = queue.onChange(() => void refresh());
  onScopeDispose(unsubscribe);

  return { pending, dead };
}
