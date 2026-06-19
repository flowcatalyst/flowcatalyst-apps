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

import { asLayerId, asPropertySetId, PROPERTY_SET_ID_PREFIX } from '../../domain/layers/ids.js';
import { asClientId } from '../../domain/tenancy/ids.js';
import { PropertySet } from '../../domain/layers/property-set.js';
import { PropertySetCreated } from '../../domain/layers/events/property-set-created.event.js';
import type { LayerRepository } from '../../domain/layers/layer.repository.js';
import type { PropertySetRepository } from '../../domain/layers/property-set.repository.js';
import type { CreatePropertySetCommand } from './create-property-set.command.js';

export class CreatePropertySetUseCase {
  static readonly requiredPermission = PinpointPermission.LayersPropertySetCreate;

  constructor(
    private readonly uow: UnitOfWork,
    private readonly registry: AggregateRegistryImpl,
    private readonly layers: LayerRepository,
    private readonly propertySets: PropertySetRepository,
  ) {}

  async execute(command: CreatePropertySetCommand): Promise<Result<PropertySetCreated>> {
    const scope = ScopeStore.require();

    if (!this.authorize(scope)) {
      return Result.failure(
        UseCaseError.authorization(
          'PERMISSION_DENIED',
          `Missing permission ${PinpointPermission.LayersPropertySetCreate}.`,
        ),
      );
    }

    const clientId = asClientId(command.clientId.trim());
    const layerId = asLayerId(command.layerId.trim());
    const name = command.name.trim();
    const description = command.description?.trim() || null;

    const layer = await this.layers.findById(layerId);
    if (!layer) {
      return Result.failure(
        UseCaseError.notFound('LAYER_NOT_FOUND', `Layer '${layerId}' not found.`),
      );
    }
    if (layer.clientId !== clientId) {
      return Result.failure(
        UseCaseError.businessRule('LAYER_CLIENT_MISMATCH', 'Layer belongs to a different client.'),
      );
    }

    const duplicate = await this.propertySets.findByLayerAndName(layerId, name);
    if (duplicate) {
      return Result.failure(
        UseCaseError.businessRule(
          'PROPERTY_SET_NAME_TAKEN',
          `Property set '${name}' already exists on this layer.`,
        ),
      );
    }

    const id = asPropertySetId(`${PROPERTY_SET_ID_PREFIX}_${generateTsid()}`);
    const set = PropertySet.create({
      id,
      layerId,
      name,
      description,
      now: new Date(),
    });
    const event = new PropertySetCreated(scope, {
      propertySetId: set.id,
      layerId: set.layerId,
      name: set.name,
    });

    return commitAggregate(this.uow, this.registry, set, event, command);
  }

  private authorize(scope: Scope): boolean {
    return scope.permissions.has(CreatePropertySetUseCase.requiredPermission);
  }
}
