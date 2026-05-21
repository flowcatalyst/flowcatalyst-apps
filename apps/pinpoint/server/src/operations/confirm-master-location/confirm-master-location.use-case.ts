/**
 * Mark a GEOCODED master_location as VALIDATED. Cascades to every child
 * `locations` row: flips status to VALIDATED, writes the spatial-feature
 * associations from the master's coordinate, and emits LocationValidated
 * (carrying the rich layer-property payload).
 *
 * Port of Rust `confirm_master_location.rs`. Same structure: spatial
 * lookup once at the master's coords, then loop over child locations
 * doing per-location associations + events. The Rust uses a single UoW
 * commit per-location; we do the same so each LocationValidated event
 * rides with that location's status update.
 *
 * The primary event returned to the caller is `MasterLocationValidated`.
 * The per-location LocationValidated events are committed inside the
 * Effect via secondary `commitAggregate` calls — they share the same
 * Drizzle tx and outbox batch.
 */
import { Effect } from 'effect';
import {
  AggregateRegistry,
  AuthorizationError,
  BusinessRuleViolation,
  commitAggregate,
  InfrastructureError,
  NotFoundError,
  ScopeStore,
  type Sealed,
  type UnitOfWork,
  type UseCaseError,
} from '@pinpoint/framework';
import { PinpointPermission } from '@pinpoint/shared';

import { MasterLocation } from '../../domain/locations/master-location.js';
import { asClientId } from '../../domain/tenancy/ids.js';
import { asMasterLocationId } from '../../domain/locations/ids.js';
import { MasterLocationValidated } from '../../domain/locations/events/master-location-validated.event.js';
import {
  LocationValidated,
  type LayerPropertyAssignment,
} from '../../domain/locations/events/location-validated.event.js';
import type { Location } from '../../domain/locations/location.js';
import type { MasterLocationRepository } from '../../domain/locations/master-location.repository.js';
import type { LocationRepository } from '../../domain/locations/location.repository.js';
import type {
  LayerFeatureRepository,
  LocationFeatureAssociationInput,
  SpatialLookupHit,
} from '../../domain/layers/layer-feature.repository.js';
import type { ProcessingLogRepository } from '../../domain/locations/processing-log.repository.js';
import type { ConfirmMasterLocationCommand } from './confirm-master-location.command.js';

function spatialHitToLayerProperty(hit: SpatialLookupHit): LayerPropertyAssignment {
  return {
    layerId: hit.layerId,
    layerCode: hit.layerCode,
    layerName: hit.layerName,
    layerType: hit.layerType,
    featureId: hit.featureId,
    featureLabel: hit.featureLabel,
    distanceMeters: hit.distanceMeters,
    geometry: {
      geometryType: hit.layerType,
      longitude: hit.centerLon,
      latitude: hit.centerLat,
      radiusMeters: hit.radiusMeters,
      polygonPoints:
        hit.polygonPoints !== null
          ? hit.polygonPoints
              .split(';')
              .map((p) => p.split(','))
              .filter((parts) => parts.length === 2)
              .map((parts): readonly [number, number] => [Number(parts[0]), Number(parts[1])])
          : null,
    },
    properties: Object.entries(hit.propertyValues).map(([key, value]) => ({ key, value })),
  };
}

function spatialHitToAssociation(hit: SpatialLookupHit): LocationFeatureAssociationInput {
  return {
    layerId: hit.layerId,
    featureId: hit.featureId,
    distanceMeters: hit.distanceMeters,
  };
}

export class ConfirmMasterLocationUseCase {
  static readonly requiredPermission = PinpointPermission.LocationsMasterLocationConfirm;

  constructor(
    private readonly masters: MasterLocationRepository,
    private readonly locations: LocationRepository,
    private readonly layerFeatures: LayerFeatureRepository,
    private readonly processingLog: ProcessingLogRepository,
  ) {}

  execute = (
    command: ConfirmMasterLocationCommand,
  ): Effect.Effect<
    Sealed<MasterLocationValidated>,
    UseCaseError,
    UnitOfWork | AggregateRegistry
  > => {
    const masters = this.masters;
    const locations = this.locations;
    const layerFeatures = this.layerFeatures;
    const processingLog = this.processingLog;
    const authorize = (): boolean => this.authorize();

    return Effect.gen(function* () {
      const scope = ScopeStore.require();

      if (!authorize()) {
        return yield* Effect.fail(
          new AuthorizationError({
            code: 'PERMISSION_DENIED',
            message: `Missing permission ${PinpointPermission.LocationsMasterLocationConfirm}.`,
          }),
        );
      }

      const masterId = asMasterLocationId(command.masterLocationId.trim());
      const commandClientId = asClientId(command.clientId.trim());

      const master = yield* Effect.tryPromise({
        try: () => masters.findById(masterId),
        catch: (cause) =>
          new InfrastructureError({
            code: 'MASTER_LOCATION_REPO_READ_FAILED',
            message: cause instanceof Error ? cause.message : String(cause),
          }),
      });
      if (!master) {
        return yield* Effect.fail(
          new NotFoundError({
            code: 'MASTER_LOCATION_NOT_FOUND',
            message: `Master location '${masterId}' not found.`,
          }),
        );
      }
      if (master.clientId !== commandClientId) {
        return yield* Effect.fail(
          new BusinessRuleViolation({
            code: 'MASTER_LOCATION_CLIENT_MISMATCH',
            message: `Master location belongs to a different client.`,
          }),
        );
      }
      if (master.latitude === null || master.longitude === null) {
        return yield* Effect.fail(
          new BusinessRuleViolation({
            code: 'MASTER_LOCATION_NOT_GEOCODED',
            message:
              'Master location has no coordinates — run validate-master-location to geocode it first.',
          }),
        );
      }

      const latitude = master.latitude;
      const longitude = master.longitude;

      // One spatial lookup at the master's coordinate; reused for both
      // the per-location associations write and the LocationValidated
      // event payload below.
      const spatialHits = yield* Effect.tryPromise({
        try: () =>
          layerFeatures.spatialLookup({
            clientId: master.clientId,
            partitionId: master.partitionId,
            latitude,
            longitude,
            layerCodes: null,
          }),
        catch: (cause) =>
          new InfrastructureError({
            code: 'SPATIAL_LOOKUP_FAILED',
            message: cause instanceof Error ? cause.message : String(cause),
          }),
      });

      const associations = spatialHits.map(spatialHitToAssociation);
      const layerProperties = spatialHits.map(spatialHitToLayerProperty);

      const children = yield* Effect.tryPromise({
        try: () => locations.listByMaster(masterId),
        catch: (cause) =>
          new InfrastructureError({
            code: 'LOCATION_REPO_READ_FAILED',
            message: cause instanceof Error ? cause.message : String(cause),
          }),
      });

      const now = new Date();
      let locationsValidated = 0;
      for (const child of children) {
        yield* Effect.tryPromise({
          try: () => layerFeatures.replaceLocationFeatureAssociations(child.id, associations),
          catch: (cause) =>
            new InfrastructureError({
              code: 'LOCATION_FEATURE_ASSOC_WRITE_FAILED',
              message: cause instanceof Error ? cause.message : String(cause),
            }),
        });

        if (child.status === 'VALIDATED') continue;

        const validatedChild: Location = { ...child, status: 'VALIDATED', updatedAt: now };
        const childEvent = new LocationValidated(scope, {
          locationId: child.id,
          clientId: child.clientId,
          masterLocationId: master.id,
          latitude,
          longitude,
          layerProperties,
        });
        yield* commitAggregate(validatedChild, childEvent, command);
        locationsValidated += 1;
      }

      // Fire-and-forget audit row. A logging failure must not block the
      // confirm flow; the caller never observes it.
      yield* Effect.promise(() =>
        processingLog
          .append(master.id, 'validated', {
            method: 'direct',
            locations_validated: locationsValidated,
            features_matched: associations.length,
          })
          .catch(() => undefined),
      );

      const updatedMaster = MasterLocation.confirmed(master, now);
      const masterEvent = new MasterLocationValidated(scope, {
        masterLocationId: master.id,
        clientId: master.clientId,
        latitude,
        longitude,
        locationsValidated,
        featuresMatched: associations.length,
      });

      return yield* commitAggregate(updatedMaster, masterEvent, command);
    });
  };

  private authorize(): boolean {
    // TODO(auth): real permission check.
    return true;
  }
}
