/**
 * Mark a GEOCODED master_location as VALIDATED. Cascades to every child
 * `locations` row: flips status to VALIDATED, writes the spatial-feature
 * associations from the master's coordinate, and emits LocationValidated
 * (carrying the rich layer-property payload).
 */
import { Effect } from 'effect';
import {
  AggregateRegistry,
  AuthorizationError,
  BusinessRuleViolation,
  commitAggregate,
  NotFoundError,
  ScopeStore,
  type Scope,
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
import { MasterLocations } from '../../domain/locations/master-location.repository.js';
import { Locations } from '../../domain/locations/location.repository.js';
import { LayerFeatures } from '../../domain/layers/layer-feature.repository.js';
import { ProcessingLogs } from '../../domain/locations/processing-log.repository.js';
import type {
  LocationFeatureAssociationInput,
  SpatialLookupHit,
} from '../../domain/layers/layer-feature.repository.js';
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
              .map((parts): [number, number] => [Number(parts[0]), Number(parts[1])])
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

  execute = (
    command: ConfirmMasterLocationCommand,
  ): Effect.Effect<
    Sealed<MasterLocationValidated>,
    UseCaseError,
    UnitOfWork | AggregateRegistry | MasterLocations | Locations | LayerFeatures | ProcessingLogs
  > => {
    const authorize = (s: Scope): boolean => this.authorize(s);

    return Effect.gen(function* () {
      const scope = ScopeStore.require();
      const masters = yield* MasterLocations;
      const locations = yield* Locations;
      const layerFeatures = yield* LayerFeatures;
      const processingLog = yield* ProcessingLogs;

      if (!authorize(scope)) {
        return yield* Effect.fail(
          new AuthorizationError({
            code: 'PERMISSION_DENIED',
            message: `Missing permission ${PinpointPermission.LocationsMasterLocationConfirm}.`,
          }),
        );
      }

      const masterId = asMasterLocationId(command.masterLocationId.trim());
      const commandClientId = asClientId(command.clientId.trim());

      const master = yield* masters.findById(masterId);
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

      const spatialHits = yield* layerFeatures.spatialLookup({
        clientId: master.clientId,
        partitionId: master.partitionId,
        latitude,
        longitude,
        layerCodes: null,
      });

      const associations = spatialHits.map(spatialHitToAssociation);
      const layerProperties = spatialHits.map(spatialHitToLayerProperty);

      const children = yield* locations.listByMaster(masterId);

      const now = new Date();
      let locationsValidated = 0;
      for (const child of children) {
        yield* layerFeatures.replaceLocationFeatureAssociations(child.id, associations);

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

      // Fire-and-forget audit row — a logging failure must not block
      // the confirm flow. `Effect.ignore` drops the error channel.
      yield* Effect.ignore(
        processingLog.append(master.id, 'validated', {
          method: 'direct',
          locations_validated: locationsValidated,
          features_matched: associations.length,
        }),
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

  private authorize(scope: Scope): boolean {
    return scope.permissions.has(
      (this.constructor as unknown as { readonly requiredPermission: string }).requiredPermission,
    );
  }
}
