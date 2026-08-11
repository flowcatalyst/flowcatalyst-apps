import type { TransactionContext } from '@flowcatalyst-apps/app-framework';
import type { Pick, PickStatus } from './pick.js';
import type { PickId } from './ids.js';

export interface PickRepository {
  persist(aggregate: Pick, tx?: TransactionContext): Promise<Pick>;
  delete(aggregate: Pick, tx?: TransactionContext): Promise<boolean>;

  findById(clientId: string, id: PickId): Promise<Pick | null>;
  /** All picks spawned by one fulfilment (one per part, at most). */
  listByFulfilment(clientId: string, fulfilmentId: string): Promise<readonly Pick[]>;
  /** The create-pick idempotency lookup: (clientId, partId) is unique. */
  findByPartId(clientId: string, partId: string): Promise<Pick | null>;
  /** Store-scoped listing for pickers — oldest slot first. */
  listByStore(
    clientId: string,
    storeRef: string,
    status?: PickStatus,
    /** slotStart window — the station snapshot is bounded to ~the day. */
    window?: { from: Date; to: Date },
  ): Promise<readonly Pick[]>;

  /** Admin listing across stores — slot order (default oldest first); optional narrowing. */
  listByClient(
    clientId: string,
    options?: {
      status?: PickStatus;
      /** Any-of store filter. */
      storeRefs?: readonly string[];
      /** shortId prefix search. */
      q?: string;
      /** Inclusive slotStart window bounds. */
      slotFrom?: Date;
      slotTo?: Date;
      slotOrder?: 'asc' | 'desc';
      limit?: number;
    },
  ): Promise<readonly Pick[]>;
}
