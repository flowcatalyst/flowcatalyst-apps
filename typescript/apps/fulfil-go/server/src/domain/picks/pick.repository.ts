import type { TransactionContext } from '@flowcatalyst-apps/app-framework';
import type { Pick, PickStatus } from './pick.js';
import type { PickId } from './ids.js';

export interface PickRepository {
  persist(aggregate: Pick, tx?: TransactionContext): Promise<Pick>;
  delete(aggregate: Pick, tx?: TransactionContext): Promise<boolean>;

  findById(clientId: string, id: PickId): Promise<Pick | null>;
  /** The create-pick idempotency lookup: (clientId, partId) is unique. */
  findByPartId(clientId: string, partId: string): Promise<Pick | null>;
  /** Store-scoped listing for pickers — oldest slot first. */
  listByStore(clientId: string, storeRef: string, status?: PickStatus): Promise<readonly Pick[]>;
}
