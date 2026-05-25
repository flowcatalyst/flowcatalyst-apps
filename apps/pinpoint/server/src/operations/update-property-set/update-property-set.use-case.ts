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

import { asLayerId, asPropertySetId } from '../../domain/layers/ids.js';
import { PropertySet } from '../../domain/layers/property-set.js';
import { PropertySetUpdated } from '../../domain/layers/events/property-set-updated.event.js';
import type { PropertySetRepository } from '../../domain/layers/property-set.repository.js';
import type { UpdatePropertySetCommand } from './update-property-set.command.js';

export class UpdatePropertySetUseCase {
  static readonly requiredPermission = PinpointPermission.LayersPropertySetUpdate;

  constructor(
    private readonly uow: UnitOfWork,
    private readonly registry: AggregateRegistryImpl,
    private readonly propertySets: PropertySetRepository,
  ) {}

  async execute(command: UpdatePropertySetCommand): Promise<Result<PropertySetUpdated>> {
    const scope = ScopeStore.require();

    if (!this.authorize(scope)) {
      return Result.failure(
        UseCaseError.authorization(
          'PERMISSION_DENIED',
          `Missing permission ${PinpointPermission.LayersPropertySetUpdate}.`,
        ),
      );
    }

    const layerId = asLayerId(command.layerId.trim());
    const propertySetId = asPropertySetId(command.propertySetId.trim());
    const name = command.name.trim();
    const description = command.description?.trim() || null;

    const existing = await this.propertySets.findById(propertySetId);
    if (!existing) {
      return Result.failure(
        UseCaseError.notFound(
          'PROPERTY_SET_NOT_FOUND',
          `Property set '${propertySetId}' not found.`,
        ),
      );
    }
    if (existing.layerId !== layerId) {
      return Result.failure(
        UseCaseError.businessRule(
          'PROPERTY_SET_LAYER_MISMATCH',
          'Property set belongs to a different layer.',
        ),
      );
    }

    if (name !== existing.name) {
      const collision = await this.propertySets.findByLayerAndName(layerId, name);
      if (collision && collision.id !== existing.id) {
        return Result.failure(
          UseCaseError.businessRule(
            'PROPERTY_SET_NAME_TAKEN',
            `Property set '${name}' already exists on this layer.`,
          ),
        );
      }
    }

    const updated = PropertySet.update(existing, { name, description, now: new Date() });
    const event = new PropertySetUpdated(scope, {
      propertySetId: updated.id,
      layerId: updated.layerId,
      name: updated.name,
    });

    return commitAggregate(this.uow, this.registry, updated, event, command);
  }

  private authorize(scope: Scope): boolean {
    return scope.permissions.has(UpdatePropertySetUseCase.requiredPermission);
  }
}
