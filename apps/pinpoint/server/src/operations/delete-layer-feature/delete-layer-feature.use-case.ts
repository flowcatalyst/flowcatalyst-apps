import {
  Result,
  ScopeStore,
  UseCaseError,
  commitDelete,
  type AggregateRegistryImpl,
  type Scope,
  type UnitOfWork,
} from '@pinpoint/framework';
import { PinpointPermission } from '@pinpoint/shared';

import { asLayerFeatureId } from '../../domain/layers/ids.js';
import { LayerFeatureDeleted } from '../../domain/layers/events/layer-feature-deleted.event.js';
import type { LayerFeatureRepository } from '../../domain/layers/layer-feature.repository.js';
import type { DeleteLayerFeatureCommand } from './delete-layer-feature.command.js';

export class DeleteLayerFeatureUseCase {
  static readonly requiredPermission = PinpointPermission.LayersFeatureDelete;

  constructor(
    private readonly uow: UnitOfWork,
    private readonly registry: AggregateRegistryImpl,
    private readonly features: LayerFeatureRepository,
  ) {}

  async execute(command: DeleteLayerFeatureCommand): Promise<Result<LayerFeatureDeleted>> {
    const scope = ScopeStore.require();

    if (!this.authorize(scope)) {
      return Result.failure(
        UseCaseError.authorization(
          'PERMISSION_DENIED',
          `Missing permission ${PinpointPermission.LayersFeatureDelete}.`,
        ),
      );
    }

    const featureId = asLayerFeatureId(command.featureId.trim());

    const prior = await this.features.findById(featureId);
    if (!prior) {
      return Result.failure(
        UseCaseError.notFound('FEATURE_NOT_FOUND', `Feature '${featureId}' not found.`),
      );
    }

    const event = new LayerFeatureDeleted(scope, {
      featureId: prior.id,
      layerId: prior.layerId,
    });

    return commitDelete(this.uow, this.registry, prior, event, command);
  }

  private authorize(scope: Scope): boolean {
    return scope.permissions.has(DeleteLayerFeatureUseCase.requiredPermission);
  }
}
