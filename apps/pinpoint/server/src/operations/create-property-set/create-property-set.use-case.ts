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
import type { LayerRepository } from '../../domain/layers/layer.repository.js';
import type { PropertySetRepository } from '../../domain/layers/property-set.repository.js';
import type { CreatePropertySetCommand } from './create-property-set.command.js';

export class CreatePropertySetUseCase {
  static readonly requiredPermission = PinpointPermission.LayersPropertySetCreate;

  constructor(
    private readonly layers: LayerRepository,
    private readonly propertySets: PropertySetRepository,
  ) {}

  execute = (
    command: CreatePropertySetCommand,
  ): Effect.Effect<
    Sealed<PropertySetCreated>,
    UseCaseError,
    UnitOfWork | AggregateRegistry
  > => {
    const layers = this.layers;
    const propertySets = this.propertySets;
    const authorize = (): boolean => this.authorize();

    return Effect.gen(function* () {
      const scope = ScopeStore.require();

      if (!authorize()) {
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

      const layer = yield* Effect.tryPromise({
        try: () => layers.findById(layerId),
        catch: (cause) =>
          new InfrastructureError({
            code: 'LAYER_REPO_READ_FAILED',
            message: cause instanceof Error ? cause.message : String(cause),
          }),
      });
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

      const duplicate = yield* Effect.tryPromise({
        try: () => propertySets.findByLayerAndName(layerId, name),
        catch: (cause) =>
          new InfrastructureError({
            code: 'PROPERTY_SET_REPO_READ_FAILED',
            message: cause instanceof Error ? cause.message : String(cause),
          }),
      });
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

  private authorize(): boolean {
    return true;
  }
}
