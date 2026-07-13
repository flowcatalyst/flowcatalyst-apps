/**
 * Compose (and RESERVE) a trip offer — the claim marketplace's read+hold
 * step (docs/transport-context.md "Offer composition", locked 2026-07-13).
 *
 * One surface, two callers: the EPOD claim proxy (driver/vehicle/depot
 * context from the Integral driver app) and our execution app (storeRef
 * direct). Flow:
 *
 *   1. Resolve the store (epod: depotReference → the store whose 'epod'
 *      provider entry names that depot; own: explicit storeRef) and gate on
 *      allocationStrategy === 'claim'.
 *   2. Anchor claims: the driver-entered reference resolves against the
 *      part SHORT ID first, then the fulfilment external ref. Anchor
 *      missing/held ⇒ EMPTY offer with the reason — never substitute.
 *   3. Select companions (compatibility filters + caps) and sequence via
 *      VROOM — all OUTSIDE any tx (router HTTP).
 *   4. One short tx: re-read, reserve the WHOLE group (expiring holds,
 *      driver+vehicle bound NOW), persist the trip, emit trip:offered.
 *      A racing reservation shrinks the offer (anchor loss aborts it).
 */
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import {
  Result,
  ScopeStore,
  UseCaseError,
  commitAggregate,
  type AggregateRegistryImpl,
  type UnitOfWork,
} from '@fulfil-go/framework';
import { ConcurrencyConflictError } from '@fulfil-go/framework';
import type { ResolvedTransportStoreSettings } from '@fulfil-go/shared';
import { TransportOrder } from '../../domain/transport-orders/transport-order.js';
import type { TransportOrderRepository } from '../../domain/transport-orders/transport-order.repository.js';
import { Trip } from '../../domain/trips/trip.js';
import { newTripId } from '../../domain/trips/ids.js';
import { TripOffered } from '../../domain/trips/events/trip.events.js';
import type { TripRepository } from '../../domain/trips/trip.repository.js';
import type { ActivityLogRepository } from '../../infrastructure/activity-log-repository.js';
import type { StoreRepository } from '../../infrastructure/store-repository.js';
import { loadTransportSettingsResolver } from '../../infrastructure/store-settings-resolver.js';
import {
  OFFER_TTL_SECONDS,
  selectOfferOrders,
  sequenceTripStops,
} from '../../transport/planning/offer-composition.js';
import type { RouterClient } from '../../transport/router/client.js';
import type { ComposeOfferResult } from './offer-types.js';

/** The one marketplace: requested orders on any our-planned channel. */
export const MARKETPLACE_PROVIDERS = ['own', 'epod'] as const;

export interface ComposeTransportOfferCommand {
  readonly clientId: string;
  readonly channel: 'own' | 'epod';
  readonly driverRef: string;
  readonly vehicleRef: string;
  /** EPOD offer context (depot → store; echoed into the route plan). */
  readonly depotRef?: string | null;
  readonly territoryRef?: string | null;
  /** Own-channel callers name the store directly. */
  readonly storeRef?: string | null;
  /** Anchor claim — the driver-entered part reference. */
  readonly orderRef?: string | null;
}

type RunWrite = <A>(thunk: () => Promise<Result<A>>) => Promise<Result<A>>;

function providerEntryConfig(
  settings: ResolvedTransportStoreSettings,
  code: string,
): Record<string, unknown> {
  return settings.transportProviders.find((p) => p.code === code)?.config ?? {};
}

export class ComposeTransportOfferUseCase {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly registry: AggregateRegistryImpl,
    private readonly db: PostgresJsDatabase,
    private readonly transportOrders: TransportOrderRepository,
    private readonly trips: TripRepository,
    private readonly stores: StoreRepository,
    private readonly activityLog: ActivityLogRepository,
    private readonly router: RouterClient | null,
    private readonly runWrite: RunWrite,
  ) {}

  async execute(command: ComposeTransportOfferCommand): Promise<Result<ComposeOfferResult>> {
    const scope = ScopeStore.require();
    // Result.success is UoW-restricted (events must ride commits) — empty
    // offers travel as business-rule failures; the route maps them to
    // 200 {offers: [], reason}.
    const empty = (reason: string): Result<ComposeOfferResult> =>
      Result.failure(UseCaseError.businessRule(reason, `No offer: ${reason}.`));

    // ── 1. Resolve the store + its transport settings ──────────────────────
    const resolver = await loadTransportSettingsResolver(this.db, command.clientId);
    let storeRef: string | null = command.storeRef ?? null;
    if (command.channel === 'epod' && !storeRef) {
      if (!command.depotRef) return empty('NO_DEPOT_REFERENCE');
      for (const store of await this.stores.listByClient(command.clientId)) {
        const config = providerEntryConfig(resolver.resolve(store.storeRef), 'epod');
        if (config['depotReference'] === command.depotRef) {
          storeRef = store.storeRef;
          break;
        }
      }
      if (!storeRef) return empty('NO_STORE_FOR_DEPOT');
    }
    if (!storeRef) return empty('NO_STORE');
    const store = await this.stores.findByRef(command.clientId, storeRef);
    if (!store) return empty('STORE_NOT_FOUND');
    const settings = resolver.resolve(storeRef);
    if (settings.allocationStrategy !== 'claim') return empty('STORE_NOT_ON_CLAIM_STRATEGY');

    // ── 2. Feed + anchor ───────────────────────────────────────────────────
    const now = new Date();
    const feed = await this.transportOrders.listRequestedByStore(
      command.clientId,
      storeRef,
      MARKETPLACE_PROVIDERS,
    );
    let anchor: TransportOrder | null = null;
    if (command.orderRef) {
      anchor =
        feed.find((o) => o.shortId === command.orderRef) ??
        (await this.transportOrders.findRequestedByFulfilmentExternalRef(
          command.clientId,
          storeRef,
          command.orderRef,
        ));
      if (!anchor) return empty('ANCHOR_NOT_FOUND');
      if (!TransportOrder.isOfferable(anchor, now)) return empty('ANCHOR_UNAVAILABLE');
    }

    // ── 3. Select + sequence (router HTTP — outside any tx) ────────────────
    const selection = selectOfferOrders(
      feed,
      anchor,
      { maxStops: settings.maxStopsPerTrip, maxBags: settings.maxBagsPerTrip },
      now,
    );
    if (!selection) return empty('NO_OFFERABLE_ORDERS');
    const route = await sequenceTripStops(this.router, store.geo, selection);

    // ── 4. Reserve the group + persist the trip (one short tx) ─────────────
    const tripId = newTripId();
    const expiresAt = new Date(now.getTime() + OFFER_TTL_SECONDS * 1000);
    const epodConfig = providerEntryConfig(settings, 'epod');
    const territoryRef =
      command.territoryRef ??
      (typeof epodConfig['territoryReference'] === 'string'
        ? epodConfig['territoryReference']
        : null);

    return this.runWrite(async () => {
      const fresh = await this.transportOrders.findManyByIds(
        command.clientId,
        selection.orders.map((o) => o.id),
      );
      const freshById = new Map(fresh.map((o) => [o.id, o]));
      const reserved: TransportOrder[] = [];
      for (const picked of selection.orders) {
        const current = freshById.get(picked.id);
        if (!current || !TransportOrder.isOfferable(current, now)) {
          if (anchor && picked.id === anchor.id) {
            return Result.failure(
              UseCaseError.businessRule('ANCHOR_UNAVAILABLE', 'The anchored order was taken.'),
            );
          }
          continue; // a companion raced away — the offer shrinks
        }
        try {
          reserved.push(
            await this.transportOrders.persist(
              TransportOrder.reserve(
                current,
                {
                  tripId,
                  driverRef: command.driverRef,
                  vehicleRef: command.vehicleRef,
                  expiresAt,
                },
                now,
              ),
            ),
          );
        } catch (err) {
          if (!(err instanceof ConcurrencyConflictError)) throw err;
          if (anchor && picked.id === anchor.id) {
            return Result.failure(
              UseCaseError.businessRule('ANCHOR_UNAVAILABLE', 'The anchored order was taken.'),
            );
          }
          // companion lost to a racing offer — shrink
        }
      }
      if (reserved.length === 0) {
        return Result.failure(
          UseCaseError.businessRule('NO_OFFERABLE_ORDERS', 'Every candidate was taken.'),
        );
      }

      const keep = new Set(reserved.map((o) => o.id));
      const trip = Trip.shrink(
        Trip.offer({
          id: tripId,
          clientId: command.clientId,
          originRef: storeRef,
          provider: command.channel,
          driverRef: command.driverRef,
          vehicleRef: command.vehicleRef,
          depotRef: command.depotRef ?? null,
          territoryRef,
          orderIds: selection.orders.map((o) => o.id),
          anchorOrderId: anchor?.id ?? null,
          stops: route.stops,
          offerExpiresAt: expiresAt,
          routeKm: route.routeKm,
          routeMinutes: route.routeMinutes,
          now,
        }),
        keep,
      );

      for (const order of reserved) {
        await this.activityLog.append({
          clientId: order.clientId,
          fulfilmentId: order.fulfilmentId,
          subjectType: 'trip',
          subjectId: trip.id,
          source: 'domain',
          actor: scope.principalId,
          category: 'transport',
          message: `Part #${order.shortId} offered in trip ${trip.id} to driver '${trip.driverRef}' (${trip.provider}).`,
          data: {
            transportOrderId: order.id,
            driverRef: trip.driverRef,
            vehicleRef: trip.vehicleRef,
            expiresAt: expiresAt.toISOString(),
          },
        });
      }

      const committed = await commitAggregate(
        this.uow,
        this.registry,
        trip,
        new TripOffered(scope, {
          tripId: trip.id,
          clientId: trip.clientId,
          originRef: trip.originRef,
          provider: trip.provider,
          driverRef: trip.driverRef,
          vehicleRef: trip.vehicleRef,
          transportOrderIds: [...trip.orderIds],
          partShortIds: trip.stops.map((s) => s.shortId),
        }),
        command,
      );

      return Result.map(
        committed,
        (): ComposeOfferResult => ({
          offers: [
            {
              groupId: trip.id,
              depotNames: [store.name],
              partReferences: trip.stops.map((s) => s.shortId),
              transportOrderRefs: [...trip.orderIds],
              expiresAt: expiresAt.toISOString(),
              originRef: trip.originRef,
              stops: trip.stops.map((s) => ({
                orderId: s.orderId,
                shortId: s.shortId,
                destination: s.destination,
                legKm: s.legKm,
                legMinutes: s.legMinutes,
              })),
              routeKm: trip.routeKm,
              routeMinutes: trip.routeMinutes,
            },
          ],
        }),
      );
    });
  }
}
