import { Effect } from 'effect';
import {
  AggregateRegistry,
  AuthorizationError,
  BusinessRuleViolation,
  commitDelete,
  InfrastructureError,
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
import type { PropertySetRepository } from '../../domain/layers/property-set.repository.js';
import type { DeletePropertySetCommand } from './delete-property-set.command.js';

export class DeletePropertySetUseCase {
  static readonly requiredPermission = PinpointPermission.LayersPropertySetDelete;

  constructor(private readonly propertySets: PropertySetRepository) {}

  execute = (
    command: DeletePropertySetCommand,
  ): Effect.Effect<
    Sealed<PropertySetDeleted>,
    UseCaseError,
    UnitOfWork | AggregateRegistry
  > => {
    const propertySets = this.propertySets;
    const authorize = (s: Scope): boolean => this.authorize(s);

    return Effect.gen(function* () {
      const scope = ScopeStore.require();

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

      const event = new PropertySetDeleted(scope, {
        propertySetId: existing.id,
        layerId: existing.layerId,
      });

      // properties FK cascades to property_set_id.
      return yield* commitDelete(existing, event, command);
    });
  };

  private authorize(scope: Scope): boolean {
    return scope.permissions.has(
      (this.constructor as unknown as { readonly requiredPermission: string }).requiredPermission,
    );
  }
}
