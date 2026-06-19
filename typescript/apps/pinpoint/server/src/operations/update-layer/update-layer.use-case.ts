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

import { Layer } from '../../domain/layers/layer.js';
import { asClientId } from '../../domain/tenancy/ids.js';
import { asLayerId } from '../../domain/layers/ids.js';
import { LayerUpdated } from '../../domain/layers/events/layer-updated.event.js';
import type { LayerRepository } from '../../domain/layers/layer.repository.js';
import type { UpdateLayerCommand } from './update-layer.command.js';

export class UpdateLayerUseCase {
  static readonly requiredPermission = PinpointPermission.LayersLayerUpdate;

  constructor(
    private readonly uow: UnitOfWork,
    private readonly registry: AggregateRegistryImpl,
    private readonly layers: LayerRepository,
  ) {}

  async execute(command: UpdateLayerCommand): Promise<Result<LayerUpdated>> {
    const scope = ScopeStore.require();

    if (!this.authorize(scope)) {
      return Result.failure(
        UseCaseError.authorization(
          'PERMISSION_DENIED',
          `Missing permission ${PinpointPermission.LayersLayerUpdate}.`,
        ),
      );
    }

    const clientId = asClientId(command.clientId.trim());
    const layerId = asLayerId(command.layerId.trim());
    const name = command.name.trim();
    const description = command.description?.trim() || null;
    if (name.length === 0) {
      return Result.failure(
        UseCaseError.validation('LAYER_NAME_REQUIRED', 'Layer name must not be empty.'),
      );
    }

    const existing = await this.layers.findById(layerId);
    if (!existing) {
      return Result.failure(
        UseCaseError.notFound('LAYER_NOT_FOUND', `Layer '${layerId}' not found.`),
      );
    }
    if (existing.clientId !== clientId) {
      return Result.failure(
        UseCaseError.businessRule('LAYER_CLIENT_MISMATCH', 'Layer belongs to a different client.'),
      );
    }

    if (existing.layerType === 'RADIUS') {
      if (command.centerLat == null || command.centerLon == null) {
        return Result.failure(
          UseCaseError.validation(
            'RADIUS_CENTER_REQUIRED',
            'Radius layers require centerLat and centerLon.',
          ),
        );
      }
      if (command.radiusMeters == null) {
        return Result.failure(
          UseCaseError.validation('RADIUS_METERS_REQUIRED', 'Radius layers require radiusMeters.'),
        );
      }
    } else if (existing.layerType === 'POLYGON') {
      if (!command.polygonGeojson || command.polygonGeojson.trim().length === 0) {
        return Result.failure(
          UseCaseError.validation(
            'POLYGON_GEOJSON_REQUIRED',
            'Polygon layers require polygonGeojson.',
          ),
        );
      }
    }

    const updated = Layer.update(existing, {
      name,
      description,
      centerLat: command.centerLat ?? null,
      centerLon: command.centerLon ?? null,
      radiusMeters: command.radiusMeters ?? null,
      polygonGeojson: command.polygonGeojson ?? null,
      status: command.status ?? existing.status,
      now: new Date(),
    });
    const event = new LayerUpdated(scope, {
      layerId: updated.id,
      clientId: updated.clientId,
      name: updated.name,
    });

    return commitAggregate(this.uow, this.registry, updated, event, command);
  }

  private authorize(scope: Scope): boolean {
    return scope.permissions.has(UpdateLayerUseCase.requiredPermission);
  }
}
