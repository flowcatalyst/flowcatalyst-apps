import { Effect } from 'effect';
import { generateTsid } from '@flowcatalyst/sdk';
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

import {
  asLayerId,
  asPropertySetId,
  PROPERTY_SET_ID_PREFIX,
} from '../../domain/layers/ids.js';
import { asClientId } from '../../domain/tenancy/ids.js';
import { PropertySet } from '../../domain/layers/property-set.js';
import { PropertySetCreated } from '../../domain/layers/events/property-set-created.event.js';
import { Layers } from '../../domain/layers/layer.repository.js';
import { PropertySets } from '../../domain/layers/property-set.repository.js';
import type { CreatePropertySetCommand } from './create-property-set.command.js';

export class CreatePropertySetUseCase {
  static readonly requiredPermission = PinpointPermission.LayersPropertySetCreate;

  execute = (
    command: CreatePropertySetCommand,
  ): Effect.Effect<
    Sealed<PropertySetCreated>,
    UseCaseError,
    UnitOfWork | AggregateRegistry | Layers | PropertySets
  > => {
    const authorize = (s: Scope): boolean => this.authorize(s);

    return Effect.gen(function* () {
      const scope = ScopeStore.require();
      const layers = yield* Layers;
      const propertySets = yield* PropertySets;

      if (!authorize(scope)) {
        return yield* Effect.fail(
          new AuthorizationError({
            code: 'PERMISSION_DENIED',
            message: `Missing permission ${PinpointPermission.LayersPropertySetCreate}.`,
          }),
        );
      }

      const clientId = asClientId(command.clientId.trim());
      const layerId = asLayerId(command.layerId.trim());
      const name = command.name.trim();
      const description = command.description?.trim() || null;

      const layer = yield* layers.findById(layerId);
      if (!layer) {
        return yield* Effect.fail(
          new NotFoundError({
            code: 'LAYER_NOT_FOUND',
            message: `Layer '${layerId}' not found.`,
          }),
        );
      }
      if (layer.clientId !== clientId) {
        return yield* Effect.fail(
          new BusinessRuleViolation({
            code: 'LAYER_CLIENT_MISMATCH',
            message: 'Layer belongs to a different client.',
          }),
        );
      }

      const duplicate = yield* propertySets.findByLayerAndName(layerId, name);
      if (duplicate) {
        return yield* Effect.fail(
          new BusinessRuleViolation({
            code: 'PROPERTY_SET_NAME_TAKEN',
            message: `Property set '${name}' already exists on this layer.`,
          }),
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

      return yield* commitAggregate(set, event, command);
    });
  };

  private authorize(scope: Scope): boolean {
    return scope.permissions.has(
      (this.constructor as unknown as { readonly requiredPermission: string }).requiredPermission,
    );
  }
}
