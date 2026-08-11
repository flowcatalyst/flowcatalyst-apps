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
import { resolveClientSettings } from '@fulfil-go/shared';
import { TransportOrder } from '../../domain/transport-orders/transport-order.js';
import type { TransportOrderRepository } from '../../domain/transport-orders/transport-order.repository.js';
import { Trip } from '../../domain/trips/trip.js';
import { newTripId } from '../../domain/trips/ids.js';
import { TripOffered } from '../../domain/trips/events/trip.events.js';
import type { TripRepository } from '../../domain/trips/trip.repository.js';
import type { ActivityLogRepository } from '../../infrastructure/activity-log-repository.js';
import type { DepotRepository } from '../../infrastructure/depot-repository.js';
import type { ClientSettingsRepository } from '../../infrastructure/client-settings-repository.js';
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
  /**
   * Depot context — the DEPOTS registry ref (a depot serves MANY stores;
   * no 1:1 depot↔store). The offer feed spans every store the depot
   * serves; the seed order picks the trip's single origin store.
   */
  readonly depotRef?: string | null;
  readonly territoryRef?: string | null;
  /** Callers may pin ONE store instead of a depot (admin/dev flows). */
  readonly storeRef?: string | null;
  /** Anchor claim — the driver-entered part reference. */
  readonly orderRef?: string | null;
  /** Vehicle class code (client settings) — unit-capacity cap when set. */
  readonly vehicleClass?: string | null;
}

type RunWrite = <A>(thunk: () => Promise<Result<A>>) => Promise<Result<A>>;

export class ComposeTransportOfferUseCase {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly registry: AggregateRegistryImpl,
    private readonly db: PostgresJsDatabase,
    private readonly transportOrders: TransportOrderRepository,
    private readonly trips: TripRepository,
    private readonly stores: StoreRepository,
    private readonly depots: DepotRepository,
    private readonly clientSettings: ClientSettingsRepository,
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

    // ONE ACTIVE TRIP per driver (Andrew, 2026-07-14): refuse to even
    // COMPOSE for an own-channel driver with an open trip — fail at Find
    // work, not at claim. EPOD's door manages its own driver workload.
    if (command.channel === 'own') {
      const open = await this.trips.listByDriver(command.clientId, command.driverRef, ['claimed'], 1);
      if (open.length > 0) return empty('OPEN_TRIP_EXISTS');
    }

    // ── 1. Resolve CANDIDATE STORES (depot serves many; store pin wins) ────
    const resolver = await loadTransportSettingsResolver(this.db, command.clientId);
    let candidateStores: readonly string[];
    if (command.storeRef) {
      candidateStores = [command.storeRef];
    } else if (command.depotRef) {
      const depot = await this.depots.findByRef(command.clientId, command.depotRef);
      if (!depot) return empty('DEPOT_NOT_FOUND');
      if (depot.storeRefs.length === 0) return empty('DEPOT_SERVES_NO_STORES');
      candidateStores = depot.storeRefs;
    } else {
      return empty('NO_DEPOT_OR_STORE');
    }
    // Only stores on the claim strategy participate in the marketplace.
    const eligibleStores = candidateStores.filter(
      (ref) => resolver.resolve(ref).allocationStrategy === 'claim',
    );
    if (eligibleStores.length === 0) return empty('NO_STORE_ON_CLAIM_STRATEGY');

    // ── 2. Feed across the depot's stores + anchor ─────────────────────────
    const now = new Date();
    const feed = (
      await Promise.all(
        eligibleStores.map((ref) =>
          this.transportOrders.listRequestedByStore(command.clientId, ref, MARKETPLACE_PROVIDERS),
        ),
      )
    ).flat();
    let anchor: TransportOrder | null = null;
    if (command.orderRef) {
      anchor = feed.find((o) => o.shortId === command.orderRef) ?? null;
      for (const ref of eligibleStores) {
        if (anchor) break;
        anchor = await this.transportOrders.findRequestedByFulfilmentExternalRef(
          command.clientId,
          ref,
          command.orderRef,
        );
      }
      if (!anchor) return empty('ANCHOR_NOT_FOUND');
      if (!TransportOrder.isOfferable(anchor, now)) return empty('ANCHOR_UNAVAILABLE');
    }

    // ── 3. Select + sequence (router HTTP — outside any tx) ────────────────
    // Vehicle-class capacity (units) from client settings, when a class rides
    // the request (own-channel driver sessions carry the driver's class).
    const client = resolveClientSettings(await this.clientSettings.get(command.clientId));
    const vehicleClass = command.vehicleClass
      ? (client.vehicleClasses.find((c) => c.code === command.vehicleClass) ?? null)
      : null;

    // Caps resolve per SEED store — the trip's single origin. Pre-rank to
    // find the seed, then select against that store's settings.
    const probe = selectOfferOrders(feed, anchor, { maxStops: 1, maxBags: 1_000_000 }, now);
    if (!probe) return empty('NO_OFFERABLE_ORDERS');
    const seedStoreRef = probe.orders[0]!.originRef;
    const settings = resolver.resolve(seedStoreRef);
    const store = await this.stores.findByRef(command.clientId, seedStoreRef);
    if (!store) return empty('STORE_NOT_FOUND');
    const storeRef = seedStoreRef;

    const selection = selectOfferOrders(
      feed,
      anchor,
      {
        maxStops: settings.maxStopsPerTrip,
        maxBags: settings.maxBagsPerTrip,
        maxUnits: vehicleClass?.maxUnits ?? null,
        unitSizes: client.packageUnitSizes,
      },
      now,
    );
    if (!selection) return empty('NO_OFFERABLE_ORDERS');
    const route = await sequenceTripStops(this.router, store.geo, selection);

    // ── 4. Reserve the group + persist the trip (one short tx) ─────────────
    const tripId = newTripId();
    const expiresAt = new Date(now.getTime() + OFFER_TTL_SECONDS * 1000);
    const territoryRef = command.territoryRef ?? null;

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
              // Duration at response time — the app counts down from THIS on
              // its monotonic clock. Comparing expiresAt to the device clock
              // breaks under device/server skew (emulators especially).
              expiresInSeconds: Math.max(
                0,
                Math.round((expiresAt.getTime() - Date.now()) / 1000),
              ),
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
