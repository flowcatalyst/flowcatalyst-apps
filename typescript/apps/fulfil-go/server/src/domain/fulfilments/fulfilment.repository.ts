import type { TransactionContext } from '@flowcatalyst-apps/app-framework';
import type { Fulfilment } from './fulfilment.js';
import type { FulfilmentId, FulfilmentPartId } from './ids.js';

/** A part due for pick release — the sweep's work item. */
export interface DuePartRef {
  readonly clientId: string;
  readonly fulfilmentId: FulfilmentId;
  readonly partId: FulfilmentPartId;
}

export interface FulfilmentRepository {
  persist(aggregate: Fulfilment, tx?: TransactionContext): Promise<Fulfilment>;
  delete(aggregate: Fulfilment, tx?: TransactionContext): Promise<boolean>;

  /** Tenant-scoped read — a fulfilment is never visible across clients. */
  findById(clientId: string, id: FulfilmentId): Promise<Fulfilment | null>;
  /**
   * The OWNERSHIP STAMP alone (docs/process-definitions.md) — the process
   * webhook's registry lookup, cheap enough to run before the write tx.
   * Null when the fulfilment doesn't exist (dispatch to the standard
   * definition, whose deciders return the not_found the route ACKs).
   */
  getProcessDefinition(clientId: string, id: FulfilmentId): Promise<string | null>;
  /**
   * Pending parts whose releaseAt has passed, on releasable fulfilments
   * (created/in_progress) — oldest due first. The release sweep's query.
   */
  listDueParts(now: Date, limit: number): Promise<readonly DuePartRef[]>;

  /**
   * Dispatcher/management view — newest first. `storeRefs` narrows to
   * fulfilments with at least one part originating at any of those stores.
   */
  listByClient(
    clientId: string,
    limit: number,
    offset: number,
    storeRefs?: readonly string[],
    filters?: {
      /** Status filter (any-of). */
      readonly statuses?: readonly string[];
      readonly type?: string;
      /** slotStart range (rides idx_fulfilments_client_slot). */
      readonly slotFrom?: Date;
      readonly slotTo?: Date;
    },
  ): Promise<readonly Fulfilment[]>;

  /** The create-idempotency lookup: (clientId, externalSource, externalRef). */
  findByExternalRef(
    clientId: string,
    externalSource: string,
    externalRef: string,
  ): Promise<Fulfilment | null>;
}
