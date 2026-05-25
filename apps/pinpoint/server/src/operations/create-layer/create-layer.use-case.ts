import { generateTsid } from '@flowcatalyst/sdk';
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
import { asLayerId, LAYER_ID_PREFIX } from '../../domain/layers/ids.js';
import { asClientId } from '../../domain/tenancy/ids.js';
import { LayerCreated } from '../../domain/layers/events/layer-created.event.js';
import type { LayerRepository } from '../../domain/layers/layer.repository.js';
import type { ClientRepository } from '../../domain/tenancy/client.repository.js';
import type { CreateLayerCommand } from './create-layer.command.js';

export class CreateLayerUseCase {
  static readonly requiredPermission = PinpointPermission.LayersLayerCreate;

  constructor(
    private readonly uow: UnitOfWork,
    private readonly registry: AggregateRegistryImpl,
    private readonly clients: ClientRepository,
    private readonly layers: LayerRepository,
  ) {}

  async execute(command: CreateLayerCommand): Promise<Result<LayerCreated>> {
    const scope = ScopeStore.require();

    if (!this.authorize(scope)) {
      return Result.failure(
        UseCaseError.authorization(
          'PERMISSION_DENIED',
          `Missing permission ${PinpointPermission.LayersLayerCreate}.`,
        ),
      );
    }

    const clientId = asClientId(command.clientId.trim());
    const code = command.code.trim();
    const name = command.name.trim();
    const description = command.description?.trim() || null;
    const layerType = command.layerType;

    if (name.length === 0) {
      return Result.failure(
        UseCaseError.validation('LAYER_NAME_REQUIRED', 'Layer name must not be empty.'),
      );
    }
    if (code.length === 0) {
      return Result.failure(
        UseCaseError.validation('LAYER_CODE_REQUIRED', 'Layer code must not be empty.'),
      );
    }

    if (layerType === 'RADIUS') {
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
    } else if (layerType === 'POLYGON') {
      if (!command.polygonGeojson || command.polygonGeojson.trim().length === 0) {
        return Result.failure(
          UseCaseError.validation(
            'POLYGON_GEOJSON_REQUIRED',
            'Polygon layers require polygonGeojson.',
          ),
        );
      }
    }

    const client = await this.clients.findById(clientId);
    if (!client) {
      return Result.failure(
        UseCaseError.notFound('CLIENT_NOT_FOUND', `Client '${clientId}' not found.`),
      );
    }

    const duplicate = await this.layers.findByClientAndCode(clientId, code);
    if (duplicate) {
      return Result.failure(
        UseCaseError.businessRule(
          'LAYER_CODE_EXISTS',
          `A layer with code '${code}' already exists for client '${clientId}'.`,
          { existingLayerId: duplicate.id },
        ),
      );
    }

    const id = asLayerId(`${LAYER_ID_PREFIX}_${generateTsid()}`);
    const layer = Layer.create({
      id,
      clientId,
      code,
      name,
      description,
      layerType,
      centerLat: command.centerLat ?? null,
      centerLon: command.centerLon ?? null,
      radiusMeters: command.radiusMeters ?? null,
      polygonGeojson: command.polygonGeojson ?? null,
      now: new Date(),
    });
    const event = new LayerCreated(scope, {
      layerId: id,
      clientId,
      code,
      name,
      layerType,
    });

    return commitAggregate(this.uow, this.registry, layer, event, command);
  }

  private authorize(scope: Scope): boolean {
    return scope.permissions.has(CreateLayerUseCase.requiredPermission);
  }
}
