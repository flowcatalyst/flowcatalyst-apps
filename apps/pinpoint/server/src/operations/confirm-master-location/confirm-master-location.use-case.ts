/**
 * Mark a GEOCODED master_location as VALIDATED. Cascades to every child
 * `locations` row: flips status to VALIDATED, writes the spatial-feature
 * associations from the master's coordinate, and emits LocationValidated
 * (carrying the rich layer-property payload).
 */
import {
  Result,
  ScopeStore,
  UseCaseError,
  commitAggregate,
  isFailure,
  type AggregateRegistryImpl,
  type Scope,
  type UnitOfWork,
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

  constructor(
    private readonly uow: UnitOfWork,
    private readonly registry: AggregateRegistryImpl,
    private readonly masters: MasterLocationRepository,
    private readonly locations: LocationRepository,
    private readonly layerFeatures: LayerFeatureRepository,
    private readonly processingLog: ProcessingLogRepository,
  ) {}

  async execute(command: ConfirmMasterLocationCommand): Promise<Result<MasterLocationValidated>> {
    const scope = ScopeStore.require();

    if (!this.authorize(scope)) {
      return Result.failure(
        UseCaseError.authorization(
          'PERMISSION_DENIED',
          `Missing permission ${PinpointPermission.LocationsMasterLocationConfirm}.`,
        ),
      );
    }

    const masterId = asMasterLocationId(command.masterLocationId.trim());
    const commandClientId = asClientId(command.clientId.trim());

    const master = await this.masters.findById(masterId);
    if (!master) {
      return Result.failure(
        UseCaseError.notFound(
          'MASTER_LOCATION_NOT_FOUND',
          `Master location '${masterId}' not found.`,
        ),
      );
    }
    if (master.clientId !== commandClientId) {
      return Result.failure(
        UseCaseError.businessRule(
          'MASTER_LOCATION_CLIENT_MISMATCH',
          `Master location belongs to a different client.`,
        ),
      );
    }
    if (master.latitude === null || master.longitude === null) {
      return Result.failure(
        UseCaseError.businessRule(
          'MASTER_LOCATION_NOT_GEOCODED',
          'Master location has no coordinates — run validate-master-location to geocode it first.',
        ),
      );
    }

    const latitude = master.latitude;
    const longitude = master.longitude;

    const spatialHits = await this.layerFeatures.spatialLookup({
      clientId: master.clientId,
      partitionId: master.partitionId,
      latitude,
      longitude,
      layerCodes: null,
    });

    const associations = spatialHits.map(spatialHitToAssociation);
    const layerProperties = spatialHits.map(spatialHitToLayerProperty);

    const children = await this.locations.listByMaster(masterId);

    const now = new Date();
    let locationsValidated = 0;
    for (const child of children) {
      await this.layerFeatures.replaceLocationFeatureAssociations(child.id, associations);

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
      const childResult = await commitAggregate(
        this.uow,
        this.registry,
        validatedChild,
        childEvent,
        command,
      );
      // Short-circuit on commit failure — surrounding tx will see the
      // returned failure or, on uncaught throws inside persist, roll back.
      // Reconstruct the failure so the return type matches the outer
      // Result<MasterLocationValidated> instead of Result<LocationValidated>.
      if (isFailure(childResult)) return Result.failure(childResult.error);
      locationsValidated += 1;
    }

    // Fire-and-forget audit row — a logging failure must not block the
    // confirm flow.
    try {
      await this.processingLog.append(master.id, 'validated', {
        method: 'direct',
        locations_validated: locationsValidated,
        features_matched: associations.length,
      });
    } catch {
      // swallow
    }

    const updatedMaster = MasterLocation.confirmed(master, now);
    const masterEvent = new MasterLocationValidated(scope, {
      masterLocationId: master.id,
      clientId: master.clientId,
      latitude,
      longitude,
      locationsValidated,
      featuresMatched: associations.length,
    });

    return commitAggregate(this.uow, this.registry, updatedMaster, masterEvent, command);
  }

  private authorize(scope: Scope): boolean {
    return scope.permissions.has(ConfirmMasterLocationUseCase.requiredPermission);
  }
}
