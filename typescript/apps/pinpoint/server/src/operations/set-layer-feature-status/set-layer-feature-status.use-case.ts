import {
  Result,
  ScopeStore,
  UseCaseError,
  commitAggregate,
  type AggregateRegistryImpl,
  type Scope,
  type UnitOfWork,
} from '@pinpoint/framework';
import { PinpointPermission } from '@pinpoint/shared';
import type { LayerFeature } from '../../domain/layers/layer-feature.js';
import { asLayerFeatureId, asLayerId } from '../../domain/layers/ids.js';
import { asClientId } from '../../domain/tenancy/ids.js';
import { LayerFeatureStatusChanged } from '../../domain/layers/events/layer-feature-status-changed.event.js';
import type { LayerFeatureRepository } from '../../domain/layers/layer-feature.repository.js';
import type { LayerRepository } from '../../domain/layers/layer.repository.js';
import type { SetLayerFeatureStatusCommand } from './set-layer-feature-status.command.js';

/** Activate / deactivate a layer feature (inactive features are ignored by spatial lookup). */
export class SetLayerFeatureStatusUseCase {
  static readonly requiredPermission = PinpointPermission.LayersFeatureUpdate;

  constructor(
    private readonly uow: UnitOfWork,
    private readonly registry: AggregateRegistryImpl,
    private readonly layerFeatures: LayerFeatureRepository,
    private readonly layers: LayerRepository,
  ) {}

  async execute(command: SetLayerFeatureStatusCommand): Promise<Result<LayerFeatureStatusChanged>> {
    const scope = ScopeStore.require();
    if (!this.authorize(scope)) {
      return Result.failure(
        UseCaseError.authorization(
          'PERMISSION_DENIED',
          `Missing permission ${SetLayerFeatureStatusUseCase.requiredPermission}.`,
        ),
      );
    }
    const clientId = asClientId(command.clientId.trim());
    const layerId = asLayerId(command.layerId.trim());
    const featureId = asLayerFeatureId(command.featureId.trim());

    const layer = await this.layers.findById(layerId);
    if (!layer || layer.clientId !== clientId) {
      return Result.failure(
        UseCaseError.notFound('LAYER_NOT_FOUND', `Layer '${layerId}' not found.`),
      );
    }
    const feature = await this.layerFeatures.findById(featureId);
    if (!feature || feature.layerId !== layerId) {
      return Result.failure(
        UseCaseError.notFound('LAYER_FEATURE_NOT_FOUND', `Feature '${featureId}' not found.`),
      );
    }

    const updated: LayerFeature = { ...feature, status: command.status, updatedAt: new Date() };
    const event = new LayerFeatureStatusChanged(scope, {
      featureId: updated.id,
      layerId: updated.layerId,
      status: command.status,
    });
    return commitAggregate(this.uow, this.registry, updated, event, command);
  }

  private authorize(scope: Scope): boolean {
    return scope.permissions.has(SetLayerFeatureStatusUseCase.requiredPermission);
  }
}
