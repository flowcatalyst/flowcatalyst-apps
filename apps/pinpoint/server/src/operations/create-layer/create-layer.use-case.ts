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
  type Scope,
  ValidationError,
  type Sealed,
  type UnitOfWork,
  type UseCaseError,
} from '@pinpoint/framework';
import { PinpointPermission } from '@pinpoint/shared';

import { Layer } from '../../domain/layers/layer.js';
import { asLayerId, LAYER_ID_PREFIX } from '../../domain/layers/ids.js';
import { asClientId } from '../../domain/tenancy/ids.js';
import { LayerCreated } from '../../domain/layers/events/layer-created.event.js';
import type { LayerRepository } from '../../domain/layers/layer.repository.js';
import type { ClientRepository } from '../../domain/tenancy/client.repository.js';
import type { CreateLayerCommand } from './create-layer.command.js';

export class CreateLayerUseCase {
  static readonly requiredPermission = PinpointPermission.LayersLayerCreate;

  constructor(
    private readonly clients: ClientRepository,
    private readonly layers: LayerRepository,
  ) {}

  execute = (
    command: CreateLayerCommand,
  ): Effect.Effect<Sealed<LayerCreated>, UseCaseError, UnitOfWork | AggregateRegistry> => {
    const clients = this.clients;
    const layers = this.layers;
    const authorize = (s: Scope): boolean => this.authorize(s);

    return Effect.gen(function* () {
      const scope = ScopeStore.require();

      if (!authorize(scope)) {
        return yield* Effect.fail(
          new AuthorizationError({
            code: 'PERMISSION_DENIED',
            message: `Missing permission ${PinpointPermission.LayersLayerCreate}.`,
          }),
        );
      }

      const clientId = asClientId(command.clientId.trim());
      const code = command.code.trim();
      const name = command.name.trim();
      const description = command.description?.trim() || null;
      const layerType = command.layerType;

      if (name.length === 0) {
        return yield* Effect.fail(
          new ValidationError({
            code: 'LAYER_NAME_REQUIRED',
            message: 'Layer name must not be empty.',
          }),
        );
      }
      if (code.length === 0) {
        return yield* Effect.fail(
          new ValidationError({
            code: 'LAYER_CODE_REQUIRED',
            message: 'Layer code must not be empty.',
          }),
        );
      }

      // Geometry rules per LayerKind — mirror the Rust validate() block.
      if (layerType === 'RADIUS') {
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
      } else if (layerType === 'POLYGON') {
        if (!command.polygonGeojson || command.polygonGeojson.trim().length === 0) {
          return yield* Effect.fail(
            new ValidationError({
              code: 'POLYGON_GEOJSON_REQUIRED',
              message: 'Polygon layers require polygonGeojson.',
            }),
          );
        }
      }
      // POINT: no layer-level geometry required — individual features provide it.

      const client = yield* Effect.tryPromise({
        try: () => clients.findById(clientId),
        catch: (cause) =>
          new InfrastructureError({
            code: 'CLIENT_REPO_READ_FAILED',
            message: cause instanceof Error ? cause.message : String(cause),
          }),
      });
      if (!client) {
        return yield* Effect.fail(
          new NotFoundError({
            code: 'CLIENT_NOT_FOUND',
            message: `Client '${clientId}' not found.`,
          }),
        );
      }

      const duplicate = yield* Effect.tryPromise({
        try: () => layers.findByClientAndCode(clientId, code),
        catch: (cause) =>
          new InfrastructureError({
            code: 'LAYER_REPO_READ_FAILED',
            message: cause instanceof Error ? cause.message : String(cause),
          }),
      });
      if (duplicate) {
        return yield* Effect.fail(
          new BusinessRuleViolation({
            code: 'LAYER_CODE_EXISTS',
            message: `A layer with code '${code}' already exists for client '${clientId}'.`,
            details: { existingLayerId: duplicate.id },
          }),
        );
      }

      const id = asLayerId(`${LAYER_ID_PREFIX}_${generateTsid()}`);
      const layer = Layer.create({
        id,
        clientId,
        code,
        name,
        description,
        layerType,
        centerLat: command.centerLat ?? null,
        centerLon: command.centerLon ?? null,
        radiusMeters: command.radiusMeters ?? null,
        polygonGeojson: command.polygonGeojson ?? null,
        now: new Date(),
      });
      const event = new LayerCreated(scope, {
        layerId: id,
        clientId,
        code,
        name,
        layerType,
      });

      return yield* commitAggregate(layer, event, command);
    });
  };

  private authorize(scope: Scope): boolean {
    return scope.permissions.has(
      (this.constructor as unknown as { readonly requiredPermission: string }).requiredPermission,
    );
  }
}
