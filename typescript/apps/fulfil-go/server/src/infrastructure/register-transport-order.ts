import {
  createAggregateHandler,
  type AggregateRegistryImpl,
} from '@flowcatalyst-apps/app-framework';
import {
  TRANSPORT_ORDER_TYPE,
  type TransportOrder,
} from '../domain/transport-orders/transport-order.js';
import type { TransportOrderRepository } from '../domain/transport-orders/transport-order.repository.js';

/**
 * Wire the TransportOrder aggregate into the shared AggregateRegistry so
 * `commitAggregate(order, ...)` resolves to this repository at persist time.
 */
export function registerTransportOrder(
  registry: AggregateRegistryImpl,
  repository: TransportOrderRepository,
): void {
  registry.register(createAggregateHandler<TransportOrder>(TRANSPORT_ORDER_TYPE, repository));
}
