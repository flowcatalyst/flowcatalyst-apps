import { Effect } from 'effect';
import { generateTsid } from '@flowcatalyst/sdk';
import {
  AggregateRegistry,
  AuthorizationError,
  BusinessRuleViolation,
  commitAggregate,
  InfrastructureError,
  NotFoundError,
  ScopeStore,
  ValidationError,
  type Sealed,
  type UnitOfWork,
  type UseCaseError,
} from '@pinpoint/framework';
import { PinpointPermission } from '@pinpoint/shared';

import {
  asLayerId,
  asPropertyId,
  asPropertySetId,
  PROPERTY_ID_PREFIX,
} from '../../domain/layers/ids.js';
import {
  MAX_PROPERTIES_PER_SET,
  PropertySet,
} from '../../domain/layers/property-set.js';
import { PropertySetPropertiesReplaced } from '../../domain/layers/events/property-set-properties-replaced.event.js';
import type { PropertySetRepository } from '../../domain/layers/property-set.repository.js';
import type { ReplacePropertySetPropertiesCommand } from './replace-property-set-properties.command.js';

export class ReplacePropertySetPropertiesUseCase {
  // Reuse the update permission — replacing properties is a property-set
  // mutation; there's no separate "manage properties" permission in the
  // Rust pinpoint role catalog either.
  static readonly requiredPermission = PinpointPermission.LayersPropertySetUpdate;

  constructor(private readonly propertySets: PropertySetRepository) {}

  execute = (
    command: ReplacePropertySetPropertiesCommand,
  ): Effect.Effect<
    Sealed<PropertySetPropertiesReplaced>,
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

      if (command.properties.length > MAX_PROPERTIES_PER_SET) {
        return yield* Effect.fail(
          new ValidationError({
            code: 'TOO_MANY_PROPERTIES',
            message: `A property set can have at most ${MAX_PROPERTIES_PER_SET} properties.`,
          }),
        );
      }

      const seen = new Set<string>();
      for (const p of command.properties) {
        const key = p.key.trim();
        if (key.length === 0) {
          return yield* Effect.fail(
            new ValidationError({
              code: 'PROPERTY_KEY_REQUIRED',
              message: 'Property keys must not be empty.',
            }),
          );
        }
        if (seen.has(key)) {
          return yield* Effect.fail(
            new BusinessRuleViolation({
              code: 'DUPLICATE_PROPERTY_KEY',
              message: `Duplicate property key '${key}'.`,
            }),
          );
        }
        seen.add(key);
      }

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

      const now = new Date();
      const incoming = command.properties.map((p) => ({
        id: asPropertyId(`${PROPERTY_ID_PREFIX}_${generateTsid()}`),
        key: p.key.trim(),
        value: p.value,
      }));
      const updated = PropertySet.replaceProperties(existing, incoming, now);

      const event = new PropertySetPropertiesReplaced(scope, {
        propertySetId: updated.id,
        layerId: updated.layerId,
        properties: updated.properties.map((p) => ({ key: p.key, value: p.value })),
      });

      return yield* commitAggregate(updated, event, command);
    });
  };

  private authorize(): boolean {
    return true;
  }
}
