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

import { asLayerId, asPropertySetId } from '../../domain/layers/ids.js';
import { PropertySetDeleted } from '../../domain/layers/events/property-set-deleted.event.js';
import type { PropertySetRepository } from '../../domain/layers/property-set.repository.js';
import type { DeletePropertySetCommand } from './delete-property-set.command.js';

export class DeletePropertySetUseCase {
  static readonly requiredPermission = PinpointPermission.LayersPropertySetDelete;

  constructor(
    private readonly uow: UnitOfWork,
    private readonly registry: AggregateRegistryImpl,
    private readonly propertySets: PropertySetRepository,
  ) {}

  async execute(command: DeletePropertySetCommand): Promise<Result<PropertySetDeleted>> {
    const scope = ScopeStore.require();

    if (!this.authorize(scope)) {
      return Result.failure(
        UseCaseError.authorization(
          'PERMISSION_DENIED',
          `Missing permission ${PinpointPermission.LayersPropertySetDelete}.`,
        ),
      );
    }

    const layerId = asLayerId(command.layerId.trim());
    const propertySetId = asPropertySetId(command.propertySetId.trim());

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

    const event = new PropertySetDeleted(scope, {
      propertySetId: existing.id,
      layerId: existing.layerId,
    });

    return commitDelete(this.uow, this.registry, existing, event, command);
  }

  private authorize(scope: Scope): boolean {
    return scope.permissions.has(DeletePropertySetUseCase.requiredPermission);
  }
}
