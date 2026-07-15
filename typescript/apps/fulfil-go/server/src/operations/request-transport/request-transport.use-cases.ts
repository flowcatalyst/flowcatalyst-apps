/**
 * The fulfilment-READY → transport handoff (docs/transport-context.md):
 *
 *   ScheduleTransportRequestUseCase — the STANDARD-service decider: book a
 *   TIMED REACTION at slotStart − transportLeadTime (store transport
 *   settings; clamped to now). The reactions sweep releases it. Idempotent
 *   via the unique (kind, fulfilment) reaction row.
 *
 *   RequestTransportUseCase — creates ONE TransportOrder per picked part
 *   (v1: no consolidation — planning composes multi-stop trips later):
 *   builds stops from the store registry + captured destination, parcels
 *   from the pick ACTUALS, resolves the provider chain per origin store,
 *   and for provider-planned channels dispatches the BOOK job (platform →
 *   /transport/orders/:id/book). Our-planned channels ('own', 'epod')
 *   leave the order `requested` for the planning marketplace.
 *
 * Both are process-manager reactions: state guards return business-rule
 * failures the webhook/sweep ACKs; real errors 500 for a retry.
 */
import { CreateDispatchJobDto, type OutboxManager } from '@flowcatalyst/sdk';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import {
  Result,
  ScopeStore,
  UseCaseError,
  commitAggregate,
  emitEvent,
  eventGroup,
  isFailure,
  type AggregateRegistryImpl,
  type UnitOfWork,
} from '@fulfil-go/framework';
import { handoverDeliveryProof } from '@fulfil-go/shared';
import type { Contact, Location } from '@fulfil-go/shared';
import { Fulfilment, type FulfilmentPart } from '../../domain/fulfilments/fulfilment.js';
import { asFulfilmentId } from '../../domain/fulfilments/ids.js';
import { FulfilmentTransportScheduled } from '../../domain/fulfilments/events/fulfilment-transport-scheduled.event.js';
import type { FulfilmentRepository } from '../../domain/fulfilments/fulfilment.repository.js';
import { TransportOrder } from '../../domain/transport-orders/transport-order.js';
import { newTransportOrderId } from '../../domain/transport-orders/ids.js';
import {
  TransportOrderFailed,
  TransportOrderRequested,
} from '../../domain/transport-orders/events/transport-order.events.js';
import type { TransportOrderRepository } from '../../domain/transport-orders/transport-order.repository.js';
import type { ActivityLogRepository } from '../../infrastructure/activity-log-repository.js';
import type { ProcessReactionRepository } from '../../infrastructure/process-reaction-repository.js';
import type { StoreRepository } from '../../infrastructure/store-repository.js';
import { loadTransportSettingsResolver } from '../../infrastructure/store-settings-resolver.js';
import type { ProviderRegistry } from '../../transport/adapter-registry.js';
import { resolveProviders } from '../../transport/provider-resolver.js';
import type { TransportParcel, TransportStop } from '../../transport/provider-port.js';

export const REQUEST_TRANSPORT_REACTION = 'request-transport' as const;

export interface TransportRequestCommand {
  readonly clientId: string;
  readonly fulfilmentId: string;
}

export interface TransportDispatchConfig {
  readonly publicBaseUrl: string;
  readonly dispatchPoolCode: string;
}

/** Captured location → provider-neutral stop (fallbacks keep stops usable). */
export function toTransportStop(location: Location, fallbackName: string): TransportStop {
  return {
    name: location.name ?? fallbackName,
    address: {
      line1: location.address.line1 ?? location.name ?? fallbackName,
      ...(location.address.line2 !== undefined ? { line2: location.address.line2 } : {}),
      ...(location.address.suburb !== undefined ? { suburb: location.address.suburb } : {}),
      city: location.address.city ?? location.address.region ?? '',
      ...(location.address.region !== undefined ? { region: location.address.region } : {}),
      ...(location.address.postalCode !== undefined
        ? { postalCode: location.address.postalCode }
        : {}),
      countryCode: location.address.countryCode,
    },
    ...(location.geo ? { geo: { lat: location.geo.lat, lng: location.geo.lng } } : {}),
    phone: location.contact?.phone ?? '',
    ...(location.instructions !== undefined ? { instructions: location.instructions } : {}),
  };
}

function toParcels(part: FulfilmentPart): TransportParcel[] {
  return (part.packages ?? []).map((pkg) => ({
    ref: pkg.ref,
    kind: pkg.kind === 'loose' ? 'loose' : 'bag',
    size: (pkg.size as TransportParcel['size']) ?? null,
    temperature: pkg.temperature,
    // Stamped at pick completion (docs/bag-sizing.md); pre-feature packages
    // fall back to 'standard' / unknown dims.
    construction: pkg.construction ?? 'standard',
    dims: pkg.dims ?? null,
    description: `${pkg.kind === 'loose' ? 'Loose item' : 'Bag'} ${pkg.ref} (part #${part.shortId})`,
  }));
}

export class ScheduleTransportRequestUseCase {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly db: PostgresJsDatabase,
    private readonly fulfilments: FulfilmentRepository,
    private readonly reactions: ProcessReactionRepository,
    private readonly activityLog: ActivityLogRepository,
  ) {}

  async execute(command: TransportRequestCommand): Promise<Result<FulfilmentTransportScheduled>> {
    const scope = ScopeStore.require();
    const fulfilment = await this.fulfilments.findById(
      command.clientId,
      asFulfilmentId(command.fulfilmentId),
    );
    if (!fulfilment) {
      return Result.failure(
        UseCaseError.notFound(
          'FULFILMENT_NOT_FOUND',
          `Fulfilment '${command.fulfilmentId}' does not exist.`,
        ),
      );
    }
    if (fulfilment.status !== 'ready') {
      return Result.failure(
        UseCaseError.businessRule(
          'FULFILMENT_NOT_READY',
          `Fulfilment '${fulfilment.id}' is '${fulfilment.status}' — nothing to schedule.`,
        ),
      );
    }

    // Lead time from the FIRST viable part's origin store (multi-store
    // fulfilments share one request; earliest-window semantics can come
    // with a real multi-store consumer).
    const originRef = Fulfilment.viableParts(fulfilment)[0]?.origin.ref;
    const resolver = await loadTransportSettingsResolver(
      this.db,
      fulfilment.clientId,
      originRef ? [originRef] : undefined,
    );
    const lead = (originRef ? resolver.resolve(originRef) : resolver.defaults)
      .transportLeadTimeMinutes;
    const now = new Date();
    const dueAt = new Date(Math.max(now.getTime(), fulfilment.slotStart.getTime() - lead * 60_000));

    const scheduled = await this.reactions.schedule({
      clientId: fulfilment.clientId,
      fulfilmentId: fulfilment.id,
      kind: REQUEST_TRANSPORT_REACTION,
      dueAt,
    });
    if (!scheduled) {
      return Result.failure(
        UseCaseError.businessRule(
          'TRANSPORT_REQUEST_ALREADY_SCHEDULED',
          `A transport request is already scheduled for fulfilment '${fulfilment.id}'.`,
        ),
      );
    }

    await this.activityLog.append({
      clientId: fulfilment.clientId,
      fulfilmentId: fulfilment.id,
      subjectType: 'fulfilment',
      subjectId: fulfilment.id,
      source: 'domain',
      actor: scope.principalId,
      category: 'transport',
      message: `Transport request scheduled for ${dueAt.toISOString()} (slot − ${lead}min).`,
      data: { dueAt: dueAt.toISOString(), transportLeadTimeMinutes: lead },
    });

    const event = new FulfilmentTransportScheduled(scope, {
      fulfilmentId: fulfilment.id,
      clientId: fulfilment.clientId,
      dueAt: dueAt.toISOString(),
    });
    return emitEvent(this.uow, event, command);
  }
}

export class RequestTransportUseCase {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly registry: AggregateRegistryImpl,
    private readonly db: PostgresJsDatabase,
    private readonly fulfilments: FulfilmentRepository,
    private readonly transportOrders: TransportOrderRepository,
    private readonly stores: StoreRepository,
    private readonly activityLog: ActivityLogRepository,
    private readonly providers: ProviderRegistry,
    private readonly outbox: OutboxManager,
    private readonly dispatch: TransportDispatchConfig,
  ) {}

  async execute(command: TransportRequestCommand): Promise<Result<unknown>> {
    const scope = ScopeStore.require();
    const fulfilment = await this.fulfilments.findById(
      command.clientId,
      asFulfilmentId(command.fulfilmentId),
    );
    if (!fulfilment) {
      return Result.failure(
        UseCaseError.notFound(
          'FULFILMENT_NOT_FOUND',
          `Fulfilment '${command.fulfilmentId}' does not exist.`,
        ),
      );
    }
    if (fulfilment.type === 'collect') {
      // Collections need no provider — the customer is the transport.
      return Result.failure(
        UseCaseError.businessRule(
          'NOTHING_TO_TRANSPORT',
          `Fulfilment '${fulfilment.id}' is a collection — no transport leg.`,
        ),
      );
    }
    if (fulfilment.status !== 'ready') {
      return Result.failure(
        UseCaseError.businessRule(
          'FULFILMENT_NOT_READY',
          `Fulfilment '${fulfilment.id}' is '${fulfilment.status}' — transport not applicable.`,
        ),
      );
    }
    // State guard: one request per fulfilment, ever (the unique
    // (client, part) index backstops concurrent deliveries).
    const existing = await this.transportOrders.listByFulfilment(
      fulfilment.clientId,
      fulfilment.id,
    );
    if (existing.length > 0) {
      return Result.failure(
        UseCaseError.businessRule(
          'TRANSPORT_ALREADY_REQUESTED',
          `Fulfilment '${fulfilment.id}' already has ${existing.length} transport order(s).`,
        ),
      );
    }

    const parts = Fulfilment.viableParts(fulfilment).filter(
      (p) => p.status === 'picked' || p.status === 'short_picked',
    );
    if (parts.length === 0) {
      return Result.failure(
        UseCaseError.businessRule(
          'NO_PICKED_PARTS',
          `Fulfilment '${fulfilment.id}' has no picked parts to transport.`,
        ),
      );
    }

    const originRefs = [...new Set(parts.map((p) => p.origin.ref))];
    const settingsResolver = await loadTransportSettingsResolver(
      this.db,
      fulfilment.clientId,
      originRefs,
    );
    const destinationStop = toTransportStop(fulfilment.destination.location, 'Destination');
    const dropoffGeo = fulfilment.destination.location.geo ?? null;
    const now = new Date();

    let last: Result<unknown> | null = null;
    for (const part of parts) {
      const store = await this.stores.findByRef(fulfilment.clientId, part.origin.ref);
      const originStop = toTransportStop(
        { ...part.origin, ...(store?.data.geo && !part.origin.geo ? { geo: store.data.geo } : {}) },
        store?.name ?? part.origin.ref,
      );
      const settings = settingsResolver.resolve(part.origin.ref);
      const resolved = resolveProviders({
        settings,
        registry: this.providers,
        requiresCarOrLarger: part.requiresCarOrLarger ?? false,
        minAgeRequired: fulfilment.maxRestrictedAge,
        storeGeo: store?.geo ?? part.origin.geo ?? null,
        dropoffGeo,
      });

      const orderId = newTransportOrderId();
      const provider = resolved.candidates[0];
      let order = TransportOrder.create({
        // Requirements only (booleans/ages) — pin VALUES stay on the
        // fulfilment aggregate; verifiers read them there server-side.
        verificationRequirements: {
          pickupPin: part.pickupPin !== null,
          deliveryPin: fulfilment.deliveryPin !== null,
          deliveryProof: handoverDeliveryProof(fulfilment.handoverPolicy),
          minAge: fulfilment.maxRestrictedAge,
          ageVisualOverrideAllowed: fulfilment.handoverPolicy?.ageVisualOverrideAllowed ?? false,
          ageIdPhotoRequired: fulfilment.handoverPolicy?.ageIdPhotoRequired ?? false,
        },
        id: orderId,
        clientId: fulfilment.clientId,
        fulfilmentId: fulfilment.id,
        partId: part.id,
        shortId: part.shortId,
        serviceLevel: fulfilment.serviceLevel,
        originRef: part.origin.ref,
        origin: originStop,
        destination: destinationStop,
        window: { slotStart: fulfilment.slotStart, slotEnd: fulfilment.slotEnd },
        parcels: toParcels(part),
        requiresCarOrLarger: part.requiresCarOrLarger ?? false,
        provider: provider ?? 'none',
        candidateProviders: resolved.candidates,
        now,
      });

      const eventData = {
        transportOrderId: order.id,
        clientId: order.clientId,
        fulfilmentId: order.fulfilmentId,
        partId: order.partId,
        shortId: order.shortId,
        provider: order.provider,
        providerRef: null,
      };

      if (!provider) {
        // No serviceable provider: the order exists AS failed — visible on
        // the flightboard, with the rejection detail in the chain record.
        order = { ...order, status: 'failed', failureReason: 'no serviceable provider' };
        await this.activityLog.append({
          clientId: order.clientId,
          fulfilmentId: order.fulfilmentId,
          subjectType: 'transport_order',
          subjectId: order.id,
          source: 'domain',
          actor: scope.principalId,
          category: 'transport',
          message: `Transport order for part #${part.shortId} FAILED — no serviceable provider.`,
          data: { rejected: resolved.rejected },
        });
        const requested = await emitEvent(
          this.uow,
          new TransportOrderRequested(scope, eventData),
          command,
        );
        if (isFailure(requested)) return requested;
        last = await commitAggregate(
          this.uow,
          this.registry,
          order,
          new TransportOrderFailed(scope, {
            ...eventData,
            reason: 'no serviceable provider',
          }),
          command,
        );
        if (isFailure(last)) return last;
        continue;
      }

      const channel = this.providers.get(provider);
      await this.activityLog.append({
        clientId: order.clientId,
        fulfilmentId: order.fulfilmentId,
        subjectType: 'transport_order',
        subjectId: order.id,
        source: 'domain',
        actor: scope.principalId,
        category: 'transport',
        message: `Transport order created for part #${part.shortId} — provider '${provider}' (${channel?.kind}).`,
        data: {
          candidates: resolved.candidates,
          rejected: resolved.rejected,
          requiresCarOrLarger: order.requiresCarOrLarger,
          parcels: order.parcels.length,
        },
      });

      if (channel?.kind === 'provider-planned') {
        // Booking talks to the provider — never inside this tx. The platform
        // delivers it to the book landing pad with retries.
        const dispatchJob = CreateDispatchJobDto.create(
          'fulfil-go:transport',
          'book-transport-order',
          `${this.dispatch.publicBaseUrl}/clients/${order.clientId}/transport/orders/${order.id}/book`,
          { clientId: order.clientId, transportOrderId: order.id },
          this.dispatch.dispatchPoolCode,
        )
          .withSubject(`transport.order.${order.id}`)
          .withMessageGroup(eventGroup('transport-order', order.id))
          .withIdempotencyKey(`book-transport-${order.id}`);
        await this.outbox.createDispatchJob(dispatchJob);
      }

      last = await commitAggregate(
        this.uow,
        this.registry,
        order,
        new TransportOrderRequested(scope, eventData),
        command,
      );
      if (isFailure(last)) return last;
    }

    return last ?? Result.failure(UseCaseError.businessRule('NO_ORDERS_CREATED', 'Nothing to do.'));
  }
}
