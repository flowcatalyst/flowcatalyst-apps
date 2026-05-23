import { Effect } from 'effect';
import {
  AggregateRegistry,
  AuthorizationError,
  BusinessRuleViolation,
  commitDelete,
  NotFoundError,
  ScopeStore,
  type Scope,
  type Sealed,
  type UnitOfWork,
  type UseCaseError,
} from '@pinpoint/framework';
import { PinpointPermission } from '@pinpoint/shared';

import { asLayerId, asPropertySetId } from '../../domain/layers/ids.js';
import { PropertySetDeleted } from '../../domain/layers/events/property-set-deleted.event.js';
import { PropertySets } from '../../domain/layers/property-set.repository.js';
import type { DeletePropertySetCommand } from './delete-property-set.command.js';

export class DeletePropertySetUseCase {
  static readonly requiredPermission = PinpointPermission.LayersPropertySetDelete;

  execute = (
    command: DeletePropertySetCommand,
  ): Effect.Effect<
    Sealed<PropertySetDeleted>,
    UseCaseError,
    UnitOfWork | AggregateRegistry | PropertySets
  > => {
    const authorize = (s: Scope): boolean => this.authorize(s);

    return Effect.gen(function* () {
      const scope = ScopeStore.require();
      const propertySets = yield* PropertySets;

      if (!authorize(scope)) {
        return yield* Effect.fail(
          new AuthorizationError({
            code: 'PERMISSION_DENIED',
            message: `Missing permission ${PinpointPermission.LayersPropertySetDelete}.`,
          }),
        );
      }

      const layerId = asLayerId(command.layerId.trim());
      const propertySetId = asPropertySetId(command.propertySetId.trim());

      const existing = yield* propertySets.findById(propertySetId);
      if (!existing) {
        return yield* Effect.fail(
          new NotFoundError({
            code: 'PROPERTY_SET_NOT_FOUND',
            message: `Property set '${propertySetId}' not found.`,
          }),
        );
      }
      if (existing.layerId !== layerId) {
        return yield* Effect.fail(
          new BusinessRuleViolation({
            code: 'PROPERTY_SET_LAYER_MISMATCH',
            message: 'Property set belongs to a different layer.',
          }),
        );
      }

      const event = new PropertySetDeleted(scope, {
        propertySetId: existing.id,
        layerId: existing.layerId,
      });

      return yield* commitDelete(existing, event, command);
    });
  };

  private authorize(scope: Scope): boolean {
    return scope.permissions.has(
      (this.constructor as unknown as { readonly requiredPermission: string }).requiredPermission,
    );
  }
}
