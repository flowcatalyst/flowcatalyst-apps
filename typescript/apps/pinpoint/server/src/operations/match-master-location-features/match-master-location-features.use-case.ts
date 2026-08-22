import {
  Result,
  ScopeStore,
  TransactionStore,
  UseCaseError,
  emitEvent,
  type Scope,
  type UnitOfWork,
} from '@pinpoint/framework';
import { PinpointPermission } from '@pinpoint/shared';
import { asClientId } from '../../domain/tenancy/ids.js';
import { asMasterLocationId } from '../../domain/locations/ids.js';
import { MasterLocationFeaturesMatched } from '../../domain/locations/events/master-location-features-matched.event.js';
import type { MasterLocationRepository } from '../../domain/locations/master-location.repository.js';
import type { LocationRepository } from '../../domain/locations/location.repository.js';
import type { LayerFeatureRepository } from '../../domain/layers/layer-feature.repository.js';
import type { MatchMasterLocationFeaturesCommand } from './match-master-location-features.command.js';

/**
 * (Re)associate every child location of a geocoded master with the layer
 * features whose boundary contains the master's point. Operator-triggered
 * from the BFF (single master, or in bulk per client — the route loops);
 * `confirm-master-location` does the same work as part of confirmation.
 */
export class MatchMasterLocationFeaturesUseCase {
  static readonly requiredPermission = PinpointPermission.MatchingSpatialLookup;

  constructor(
    private readonly uow: UnitOfWork,
    private readonly masters: MasterLocationRepository,
    private readonly locations: LocationRepository,
    private readonly layerFeatures: LayerFeatureRepository,
  ) {}

  async execute(
    command: MatchMasterLocationFeaturesCommand,
  ): Promise<Result<MasterLocationFeaturesMatched>> {
    const scope = ScopeStore.require();
    if (!this.authorize(scope)) {
      return Result.failure(
        UseCaseError.authorization(
          'PERMISSION_DENIED',
          `Missing permission ${MatchMasterLocationFeaturesUseCase.requiredPermission}.`,
        ),
      );
    }
    const clientId = asClientId(command.clientId.trim());
    const masterLocationId = asMasterLocationId(command.masterLocationId.trim());

    const master = await this.masters.findById(masterLocationId);
    if (!master || master.clientId !== clientId) {
      return Result.failure(
        UseCaseError.notFound(
          'MASTER_LOCATION_NOT_FOUND',
          `Master location '${masterLocationId}' not found.`,
        ),
      );
    }
    if (master.latitude == null || master.longitude == null) {
      return Result.failure(
        UseCaseError.businessRule(
          'NO_COORDINATES',
          'Master location has no coordinates — geocode it first.',
        ),
      );
    }

    const matches = await this.layerFeatures.findFeaturesContainingPoint({
      clientId: master.clientId,
      partitionId: master.partitionId,
      latitude: master.latitude,
      longitude: master.longitude,
    });
    const associations = matches.map((m) => ({
      layerId: m.layerId,
      featureId: m.layerFeatureId,
      distanceMeters: m.distanceMeters,
    }));
    const tx = TransactionStore.get();
    const children = await this.locations.listByMaster(master.id);
    for (const child of children) {
      await this.layerFeatures.replaceLocationFeatureAssociations(child.id, associations, tx);
    }

    const event = new MasterLocationFeaturesMatched(scope, {
      masterLocationId: master.id,
      clientId: master.clientId,
      locationsUpdated: children.length,
      features: matches.map((m) => ({
        layerFeatureId: m.layerFeatureId,
        layerId: m.layerId,
        layerName: m.layerName,
        featureLabel: m.featureLabel,
        distanceMeters: m.distanceMeters,
      })),
    });
    return emitEvent(this.uow, event, command);
  }

  private authorize(scope: Scope): boolean {
    return scope.permissions.has(MatchMasterLocationFeaturesUseCase.requiredPermission);
  }
}
