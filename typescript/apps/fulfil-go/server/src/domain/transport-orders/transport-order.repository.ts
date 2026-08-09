import type { TransactionContext } from '@flowcatalyst-apps/app-framework';
import type { TransportOrder } from './transport-order.js';
import type { TransportOrderId } from './ids.js';

export interface TransportOrderRepository {
  persist(aggregate: TransportOrder, tx?: TransactionContext): Promise<TransportOrder>;
  delete(aggregate: TransportOrder, tx?: TransactionContext): Promise<boolean>;

  /** Tenant-scoped read — an order is never visible across clients. */
  findById(clientId: string, id: TransportOrderId): Promise<TransportOrder | null>;
  /** State guard for request-transport idempotency (one order per part). */
  listByFulfilment(clientId: string, fulfilmentId: string): Promise<readonly TransportOrder[]>;
  /** Provider webhook correlation ('uber' delivery id → order). */
  findByProviderRef(provider: string, providerRef: string): Promise<TransportOrder | null>;
  /** Management view — newest first by default. */
  listByClient(
    clientId: string,
    limit: number,
    offset: number,
    statuses?: readonly string[],
    options?: {
      /** Any-of origin-store filter. */
      readonly storeRefs?: readonly string[];
      /** Sort column (default createdAt) + direction (default desc). */
      readonly sortField?: 'createdAt' | 'slotStart';
      readonly sortDir?: 'asc' | 'desc';
    },
  ): Promise<readonly TransportOrder[]>;
  /** Planning marketplace feed: requested orders on our-planned providers at a store. */
  listRequestedByStore(
    clientId: string,
    originRef: string,
    providers: readonly string[],
  ): Promise<readonly TransportOrder[]>;
  /** Claim-time hydration of a trip's member orders. */
  findManyByIds(clientId: string, ids: readonly string[]): Promise<readonly TransportOrder[]>;
  /**
   * Anchor-claim fallback: a requested order at the store whose FULFILMENT
   * carries this upstream external ref (the part short id resolves first).
   */
  findRequestedByFulfilmentExternalRef(
    clientId: string,
    originRef: string,
    externalRef: string,
  ): Promise<TransportOrder | null>;
}
