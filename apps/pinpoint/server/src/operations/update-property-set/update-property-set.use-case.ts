import { Effect } from 'effect';
import {
  AggregateRegistry,
  AuthorizationError,
  BusinessRuleViolation,
  commitAggregate,
  NotFoundError,
  ScopeStore,
  type Scope,
  type Sealed,
  type UnitOfWork,
  type UseCaseError,
} from '@pinpoint/framework';
import { PinpointPermission } from '@pinpoint/shared';

import { asLayerId, asPropertySetId } from '../../domain/layers/ids.js';
import { PropertySet } from '../../domain/layers/property-set.js';
import { PropertySetUpdated } from '../../domain/layers/events/property-set-updated.event.js';
import { PropertySets } from '../../domain/layers/property-set.repository.js';
import type { UpdatePropertySetCommand } from './update-property-set.command.js';

export class UpdatePropertySetUseCase {
  static readonly requiredPermission = PinpointPermission.LayersPropertySetUpdate;

  execute = (
    command: UpdatePropertySetCommand,
  ): Effect.Effect<
    Sealed<PropertySetUpdated>,
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
            message: `Missing permission ${PinpointPermission.LayersPropertySetUpdate}.`,
          }),
        );
      }

      const layerId = asLayerId(command.layerId.trim());
      const propertySetId = asPropertySetId(command.propertySetId.trim());
      const name = command.name.trim();
      const description = command.description?.trim() || null;

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

      if (name !== existing.name) {
        const collision = yield* propertySets.findByLayerAndName(layerId, name);
        if (collision && collision.id !== existing.id) {
          return yield* Effect.fail(
            new BusinessRuleViolation({
              code: 'PROPERTY_SET_NAME_TAKEN',
              message: `Property set '${name}' already exists on this layer.`,
            }),
          );
        }
      }

      const updated = PropertySet.update(existing, { name, description, now: new Date() });
      const event = new PropertySetUpdated(scope, {
        propertySetId: updated.id,
        layerId: updated.layerId,
        name: updated.name,
      });

      return yield* commitAggregate(updated, event, command);
    });
  };

  private authorize(scope: Scope): boolean {
    return scope.permissions.has(
      (this.constructor as unknown as { readonly requiredPermission: string }).requiredPermission,
    );
  }
}
