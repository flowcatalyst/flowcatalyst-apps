export type QueueItemStatus = 'pending' | 'dead';

export interface QueueItem {
  readonly id: string;
  readonly endpoint: string;
  readonly method: string;
  /** JSON-encoded body, or null for body-less commands. */
  readonly body: string | null;
  /** Sent as the Idempotency-Key header — server-side replay dedupe. */
  readonly idempotencyKey: string;
  readonly attempts: number;
  /** Epoch ms — the item is due when now >= nextAttemptAt. */
  readonly nextAttemptAt: number;
  readonly status: QueueItemStatus;
  readonly lastError: string | null;
  readonly createdAt: number;
}

export interface QueueCounts {
  readonly pending: number;
  readonly dead: number;
}

export interface QueueStorage {
  insert(item: QueueItem): Promise<void>;
  update(item: QueueItem): Promise<void>;
  remove(id: string): Promise<void>;
  /** Pending items due at `now`, oldest first. */
  listDue(now: number, limit: number): Promise<readonly QueueItem[]>;
  listDead(): Promise<readonly QueueItem[]>;
  counts(): Promise<QueueCounts>;
}
