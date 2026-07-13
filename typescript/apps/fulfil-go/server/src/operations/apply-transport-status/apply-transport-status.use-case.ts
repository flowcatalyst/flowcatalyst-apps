/**
 * Apply a PROVIDER status signal to a transport order — the normalized
 * landing point for every provider's callbacks (Uber webhooks today; EPOD
 * stop/workflow webhooks when that channel lands). Forward-only: stale or
 * out-of-order signals surface as business-rule failures the webhook route
 * ACKs. Runs inside the route's runWrite tx.
 */
import {
  Result,
  ScopeStore,
  UseCaseError,
  commitAggregate,
  type AggregateRegistryImpl,
  type UnitOfWork,
} from '@fulfil-go/framework';
import {
  TransportOrder,
  type TransportCourier,
  type TransportOrderStatus,
} from '../../domain/transport-orders/transport-order.js';
import { TRANSPORT_ORDER_EVENT_BY_STATUS } from '../../domain/transport-orders/events/transport-order.events.js';
import type { TransportOrderRepository } from '../../domain/transport-orders/transport-order.repository.js';
import type {
  ActivityLogRepository,
  ActivitySource,
} from '../../infrastructure/activity-log-repository.js';

export interface ApplyTransportStatusCommand {
  readonly provider: string;
  readonly providerRef: string;
  readonly status: TransportOrderStatus;
  readonly courier?: TransportCourier | null;
  readonly trackingUrl?: string | null;
  readonly failureReason?: string | null;
  /** Raw provider payload snapshot for the chain record. */
  readonly raw?: unknown;
}

export class ApplyTransportStatusUseCase {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly registry: AggregateRegistryImpl,
    private readonly transportOrders: TransportOrderRepository,
    private readonly activityLog: ActivityLogRepository,
  ) {}

  async execute(command: ApplyTransportStatusCommand): Promise<Result<unknown>> {
    const scope = ScopeStore.require();
    const order = await this.transportOrders.findByProviderRef(
      command.provider,
      command.providerRef,
    );
    if (!order) {
      return Result.failure(
        UseCaseError.notFound(
          'TRANSPORT_ORDER_NOT_FOUND',
          `No transport order for ${command.provider} ref '${command.providerRef}'.`,
        ),
      );
    }
    if (command.status === 'requested') {
      return Result.failure(
        UseCaseError.businessRule('STATUS_NOT_APPLICABLE', 'requested is not a provider signal.'),
      );
    }
    if (!TransportOrder.canAdvance(order, command.status)) {
      return Result.failure(
        UseCaseError.businessRule(
          'TRANSPORT_STATUS_STALE',
          `Order '${order.id}' is '${order.status}' — '${command.status}' is stale or a replay.`,
          { current: order.status, signalled: command.status },
        ),
      );
    }

    const now = new Date();
    const next = TransportOrder.advance(order, command.status, now, {
      ...(command.courier !== undefined ? { courier: command.courier } : {}),
      ...(command.trackingUrl !== undefined ? { trackingUrl: command.trackingUrl } : {}),
      ...(command.failureReason !== undefined ? { failureReason: command.failureReason } : {}),
    });

    const source: ActivitySource =
      command.provider === 'uber' || command.provider === 'epod' ? command.provider : 'domain';
    await this.activityLog.append({
      clientId: next.clientId,
      fulfilmentId: next.fulfilmentId,
      subjectType: 'transport_order',
      subjectId: next.id,
      source,
      actor: scope.principalId,
      category: 'webhook',
      message: `Transport order → ${command.status} (provider '${command.provider}').`,
      data: {
        providerRef: command.providerRef,
        courier: command.courier ?? null,
        raw: command.raw ?? null,
      },
    });

    const EventClass = TRANSPORT_ORDER_EVENT_BY_STATUS[command.status];
    return commitAggregate(
      this.uow,
      this.registry,
      next,
      new EventClass(scope, {
        transportOrderId: next.id,
        clientId: next.clientId,
        fulfilmentId: next.fulfilmentId,
        partId: next.partId,
        shortId: next.shortId,
        provider: next.provider,
        providerRef: next.providerRef,
        ...(command.failureReason ? { reason: command.failureReason } : {}),
      }),
      command,
    );
  }
}
