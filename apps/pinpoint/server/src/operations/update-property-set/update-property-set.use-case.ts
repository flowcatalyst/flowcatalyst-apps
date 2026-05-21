import { Effect } from 'effect';
import {
  AggregateRegistry,
  AuthorizationError,
  BusinessRuleViolation,
  commitAggregate,
  InfrastructureError,
  NotFoundError,
  ScopeStore,
  type Sealed,
  type UnitOfWork,
  type UseCaseError,
} from '@pinpoint/framework';
import { PinpointPermission } from '@pinpoint/shared';

import { asLayerId, asPropertySetId } from '../../domain/layers/ids.js';
import { PropertySet } from '../../domain/layers/property-set.js';
import { PropertySetUpdated } from '../../domain/layers/events/property-set-updated.event.js';
import type { PropertySetRepository } from '../../domain/layers/property-set.repository.js';
import type { UpdatePropertySetCommand } from './update-property-set.command.js';

export class UpdatePropertySetUseCase {
  static readonly requiredPermission = PinpointPermission.LayersPropertySetUpdate;

  constructor(private readonly propertySets: PropertySetRepository) {}

  execute = (
    command: UpdatePropertySetCommand,
  ): Effect.Effect<
    Sealed<PropertySetUpdated>,
    UseCaseError,
    UnitOfWork | AggregateRegistry
  > => {
    const propertySets = this.propertySets;
    const authorize = (): boolean => this.authorize();

    return Effect.gen(function* () {
      const scope = ScopeStore.require();

      if (!authorize()) {
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

      const existing = yield* Effect.tryPromise({
        try: () => propertySets.findById(propertySetId),
        catch: (cause) =>
          new InfrastructureError({
            code: 'PROPERTY_SET_REPO_READ_FAILED',
            message: cause instanceof Error ? cause.message : String(cause),
          }),
      });
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
        const collision = yield* Effect.tryPromise({
          try: () => propertySets.findByLayerAndName(layerId, name),
          catch: (cause) =>
            new InfrastructureError({
              code: 'PROPERTY_SET_REPO_READ_FAILED',
              message: cause instanceof Error ? cause.message : String(cause),
            }),
        });
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

  private authorize(): boolean {
    return true;
  }
}
