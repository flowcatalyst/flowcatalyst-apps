import { Effect } from 'effect';
import {
  AggregateRegistry,
  AuthorizationError,
  BusinessRuleViolation,
  commitAggregate,
  NotFoundError,
  ScopeStore,
  type Scope,
  ValidationError,
  type Sealed,
  type UnitOfWork,
  type UseCaseError,
} from '@pinpoint/framework';
import { PinpointPermission } from '@pinpoint/shared';

import { Layer } from '../../domain/layers/layer.js';
import { asClientId } from '../../domain/tenancy/ids.js';
import { asLayerId } from '../../domain/layers/ids.js';
import { LayerUpdated } from '../../domain/layers/events/layer-updated.event.js';
import { Layers } from '../../domain/layers/layer.repository.js';
import type { UpdateLayerCommand } from './update-layer.command.js';

export class UpdateLayerUseCase {
  static readonly requiredPermission = PinpointPermission.LayersLayerUpdate;

  execute = (
    command: UpdateLayerCommand,
  ): Effect.Effect<
    Sealed<LayerUpdated>,
    UseCaseError,
    UnitOfWork | AggregateRegistry | Layers
  > => {
    const authorize = (s: Scope): boolean => this.authorize(s);

    return Effect.gen(function* () {
      const scope = ScopeStore.require();
      const layers = yield* Layers;

      if (!authorize(scope)) {
        return yield* Effect.fail(
          new AuthorizationError({
            code: 'PERMISSION_DENIED',
            message: `Missing permission ${PinpointPermission.LayersLayerUpdate}.`,
          }),
        );
      }

      const clientId = asClientId(command.clientId.trim());
      const layerId = asLayerId(command.layerId.trim());
      const name = command.name.trim();
      const description = command.description?.trim() || null;
      if (name.length === 0) {
        return yield* Effect.fail(
          new ValidationError({
            code: 'LAYER_NAME_REQUIRED',
            message: 'Layer name must not be empty.',
          }),
        );
      }

      const existing = yield* layers.findById(layerId);
      if (!existing) {
        return yield* Effect.fail(
          new NotFoundError({
            code: 'LAYER_NOT_FOUND',
            message: `Layer '${layerId}' not found.`,
          }),
        );
      }
      if (existing.clientId !== clientId) {
        return yield* Effect.fail(
          new BusinessRuleViolation({
            code: 'LAYER_CLIENT_MISMATCH',
            message: 'Layer belongs to a different client.',
          }),
        );
      }

      if (existing.layerType === 'RADIUS') {
        if (command.centerLat == null || command.centerLon == null) {
          return yield* Effect.fail(
            new ValidationError({
              code: 'RADIUS_CENTER_REQUIRED',
              message: 'Radius layers require centerLat and centerLon.',
            }),
          );
        }
        if (command.radiusMeters == null) {
          return yield* Effect.fail(
            new ValidationError({
              code: 'RADIUS_METERS_REQUIRED',
              message: 'Radius layers require radiusMeters.',
            }),
          );
        }
      } else if (existing.layerType === 'POLYGON') {
        if (!command.polygonGeojson || command.polygonGeojson.trim().length === 0) {
          return yield* Effect.fail(
            new ValidationError({
              code: 'POLYGON_GEOJSON_REQUIRED',
              message: 'Polygon layers require polygonGeojson.',
            }),
          );
        }
      }

      const updated = Layer.update(existing, {
        name,
        description,
        centerLat: command.centerLat ?? null,
        centerLon: command.centerLon ?? null,
        radiusMeters: command.radiusMeters ?? null,
        polygonGeojson: command.polygonGeojson ?? null,
        status: command.status ?? existing.status,
        now: new Date(),
      });
      const event = new LayerUpdated(scope, {
        layerId: updated.id,
        clientId: updated.clientId,
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
