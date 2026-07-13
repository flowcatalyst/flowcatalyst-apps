/**
 * BOOK a provider-planned transport order — the book dispatch job's TARGET
 * (platform → HMAC POST /clients/:id/transport/orders/:id/book).
 *
 * NOT the Result/commitAggregate shape on purpose (ProvisionEpod pattern):
 * the provider HTTP calls must run OUTSIDE any db tx. The flow:
 *
 *   1. Pool-read the order; state-guard `requested` (replays converge).
 *   2. Walk the candidate chain OUTSIDE any tx: createDelivery per
 *      provider-planned candidate. A 4xx provider error counts as a
 *      REJECTION (fall back to the next candidate); 5xx/network THROWS so
 *      the route 500s and the platform retries. Provider idempotency keys
 *      make crash-replays converge (Uber: 60-min idempotency window keyed
 *      on the order id).
 *   3. One short runWrite tx: re-guard, transition (booked | failed),
 *      event + same-tx activity entry. Provider call/response snapshots
 *      append best-effort (there is no shared tx with the provider).
 */
import {
  Result,
  ScopeStore,
  UseCaseError,
  commitAggregate,
  type AggregateRegistryImpl,
  type UnitOfWork,
} from '@fulfil-go/framework';
import { TransportOrder } from '../../domain/transport-orders/transport-order.js';
import { asTransportOrderId } from '../../domain/transport-orders/ids.js';
import {
  TransportOrderBooked,
  TransportOrderFailed,
} from '../../domain/transport-orders/events/transport-order.events.js';
import type { TransportOrderRepository } from '../../domain/transport-orders/transport-order.repository.js';
import type { ActivityLogRepository } from '../../infrastructure/activity-log-repository.js';
import type { ProviderRegistry } from '../../transport/adapter-registry.js';
import type { ProviderDelivery } from '../../transport/provider-port.js';
import { UberApiError } from '../../transport/uber/client.js';

export interface BookTransportOrderCommand {
  readonly clientId: string;
  readonly transportOrderId: string;
}

type RunWrite = <A>(thunk: () => Promise<Result<A>>) => Promise<Result<A>>;

export class BookTransportOrderUseCase {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly registry: AggregateRegistryImpl,
    private readonly transportOrders: TransportOrderRepository,
    private readonly activityLog: ActivityLogRepository,
    private readonly providers: ProviderRegistry,
    private readonly runWrite: RunWrite,
  ) {}

  async execute(command: BookTransportOrderCommand): Promise<Result<unknown>> {
    const scope = ScopeStore.require();
    const order = await this.transportOrders.findById(
      command.clientId,
      asTransportOrderId(command.transportOrderId),
    );
    if (!order) {
      return Result.failure(
        UseCaseError.notFound(
          'TRANSPORT_ORDER_NOT_FOUND',
          `Transport order '${command.transportOrderId}' does not exist.`,
        ),
      );
    }
    if (order.status !== 'requested') {
      return Result.failure(
        UseCaseError.businessRule(
          'TRANSPORT_ORDER_NOT_BOOKABLE',
          `Transport order '${order.id}' is '${order.status}' — booking already applied or superseded.`,
        ),
      );
    }

    // Walk provider-planned candidates OUTSIDE any tx.
    let booked: { provider: string; delivery: ProviderDelivery } | null = null;
    const rejections: { provider: string; reason: string }[] = [];
    for (const code of order.candidateProviders) {
      const channel = this.providers.get(code);
      if (!channel?.adapter) {
        // Our-planned channels don't book — the planning marketplace owns
        // them. A mixed chain simply skips them here.
        rejections.push({ provider: code, reason: 'not provider-planned (skipped for booking)' });
        continue;
      }
      try {
        const delivery = await channel.adapter.createDelivery({
          origin: order.origin,
          destination: order.destination,
          window: order.window,
          parcels: order.parcels,
          requiresVehicle: order.requiresVehicle,
          externalRef: order.id,
          idempotencyKey: order.id,
        });
        booked = { provider: code, delivery };
        break;
      } catch (err) {
        if (err instanceof UberApiError && err.status < 500) {
          // The provider REFUSED (unserviceable address, window, validation)
          // — retrying won't change its mind; fall through the chain.
          rejections.push({ provider: code, reason: `${err.code}: ${err.message}` });
          await this.activityLog.appendDetached({
            clientId: order.clientId,
            fulfilmentId: order.fulfilmentId,
            subjectType: 'transport_order',
            subjectId: order.id,
            source: code === 'uber' ? 'uber' : 'domain',
            actor: scope.principalId,
            category: 'provider-call',
            message: `Provider '${code}' rejected the booking: ${err.code}.`,
            data: { status: err.status, code: err.code, message: err.message },
          });
          continue;
        }
        throw err; // 5xx / network — 500 for a platform retry.
      }
    }

    if (booked) {
      const { provider, delivery } = booked;
      await this.activityLog.appendDetached({
        clientId: order.clientId,
        fulfilmentId: order.fulfilmentId,
        subjectType: 'transport_order',
        subjectId: order.id,
        source: provider === 'uber' ? 'uber' : 'domain',
        actor: scope.principalId,
        category: 'provider-call',
        message: `Provider '${provider}' accepted the booking (${delivery.providerRef}).`,
        data: {
          providerRef: delivery.providerRef,
          status: delivery.status,
          feeCents: delivery.feeCents ?? null,
          liveMode: delivery.liveMode ?? null,
        },
      });
      return this.runWrite(async () => {
        const fresh = await this.transportOrders.findById(order.clientId, order.id);
        if (!fresh || fresh.status !== 'requested') {
          return Result.failure(
            UseCaseError.businessRule(
              'TRANSPORT_ORDER_NOT_BOOKABLE',
              `Transport order '${order.id}' moved on during booking.`,
            ),
          );
        }
        const now = new Date();
        const next = TransportOrder.book(
          fresh,
          provider,
          delivery.providerRef,
          delivery.trackingUrl ?? null,
          now,
        );
        await this.activityLog.append({
          clientId: next.clientId,
          fulfilmentId: next.fulfilmentId,
          subjectType: 'transport_order',
          subjectId: next.id,
          source: 'domain',
          actor: scope.principalId,
          category: 'transport',
          message: `Transport order booked with '${provider}' — ${delivery.providerRef}.`,
          data: { providerRef: delivery.providerRef, trackingUrl: delivery.trackingUrl ?? null },
        });
        return commitAggregate(
          this.uow,
          this.registry,
          next,
          new TransportOrderBooked(scope, {
            transportOrderId: next.id,
            clientId: next.clientId,
            fulfilmentId: next.fulfilmentId,
            partId: next.partId,
            shortId: next.shortId,
            provider,
            providerRef: delivery.providerRef,
          }),
          command,
        );
      });
    }

    // Chain exhausted — terminal failure (the resolver's fallback ran dry).
    return this.runWrite(async () => {
      const fresh = await this.transportOrders.findById(order.clientId, order.id);
      if (!fresh || fresh.status !== 'requested') {
        return Result.failure(
          UseCaseError.businessRule(
            'TRANSPORT_ORDER_NOT_BOOKABLE',
            `Transport order '${order.id}' moved on during booking.`,
          ),
        );
      }
      const now = new Date();
      const reason = `all providers rejected the booking (${rejections.map((r) => r.provider).join(', ')})`;
      const next = TransportOrder.fail(fresh, reason, now);
      await this.activityLog.append({
        clientId: next.clientId,
        fulfilmentId: next.fulfilmentId,
        subjectType: 'transport_order',
        subjectId: next.id,
        source: 'domain',
        actor: scope.principalId,
        category: 'transport',
        message: `Transport order FAILED — ${reason}.`,
        data: { rejections },
      });
      return commitAggregate(
        this.uow,
        this.registry,
        next,
        new TransportOrderFailed(scope, {
          transportOrderId: next.id,
          clientId: next.clientId,
          fulfilmentId: next.fulfilmentId,
          partId: next.partId,
          shortId: next.shortId,
          provider: next.provider,
          providerRef: null,
          reason,
        }),
        command,
      );
    });
  }
}
