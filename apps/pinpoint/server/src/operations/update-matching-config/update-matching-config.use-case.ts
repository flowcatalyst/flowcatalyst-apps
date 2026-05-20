import { Effect } from 'effect';
import { generateTsid } from '@flowcatalyst/sdk';
import {
  AggregateRegistry,
  AuthorizationError,
  commitAggregate,
  InfrastructureError,
  NotFoundError,
  ScopeStore,
  type Sealed,
  type UnitOfWork,
  type UseCaseError,
} from '@pinpoint/framework';
import { PinpointPermission } from '@pinpoint/shared';

import { MatchingConfig } from '../../domain/matching/matching-config.js';
import {
  asMatchingConfigId,
  MATCHING_CONFIG_GLOBAL_DEFAULT_ID,
  MATCHING_CONFIG_ID_PREFIX,
} from '../../domain/matching/ids.js';
import { asClientId, asPartitionId } from '../../domain/tenancy/ids.js';
import { MatchingConfigUpdated } from '../../domain/matching/events/matching-config-updated.event.js';
import type { ClientRepository } from '../../domain/tenancy/client.repository.js';
import type { PartitionRepository } from '../../domain/tenancy/partition.repository.js';
import type { MatchingConfigRepository } from '../../domain/matching/matching-config.repository.js';
import type { UpdateMatchingConfigCommand } from './update-matching-config.command.js';

/**
 * Update — or lazily create — a (client, partition)-scoped matching
 * config. If `resolve` returns the global default, we promote a new
 * scoped row with the global defaults + the requested overrides
 * (mirroring the Rust use case).
 *
 * Validation thresholds are 0..1; enforced in the Zod schema, so the
 * use case body only handles repo concerns + the global-default-promotion
 * decision.
 */
export class UpdateMatchingConfigUseCase {
  static readonly requiredPermission = PinpointPermission.MatchingConfigManage;

  constructor(
    private readonly clients: ClientRepository,
    private readonly partitions: PartitionRepository,
    private readonly configs: MatchingConfigRepository,
  ) {}

  execute = (
    command: UpdateMatchingConfigCommand,
  ): Effect.Effect<
    Sealed<MatchingConfigUpdated>,
    UseCaseError,
    UnitOfWork | AggregateRegistry
  > => {
    const clients = this.clients;
    const partitions = this.partitions;
    const configs = this.configs;
    const authorize = (): boolean => this.authorize();

    return Effect.gen(function* () {
      const scope = ScopeStore.require();

      if (!authorize()) {
        return yield* Effect.fail(
          new AuthorizationError({
            code: 'PERMISSION_DENIED',
            message: `Missing permission ${PinpointPermission.MatchingConfigManage}.`,
          }),
        );
      }

      const clientId = asClientId(command.clientId.trim());
      const partitionId =
        command.partitionId != null && command.partitionId.trim().length > 0
          ? asPartitionId(command.partitionId.trim())
          : null;

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

      if (partitionId != null) {
        const partition = yield* Effect.tryPromise({
          try: () => partitions.findById(partitionId),
          catch: (cause) =>
            new InfrastructureError({
              code: 'PARTITION_REPO_READ_FAILED',
              message: cause instanceof Error ? cause.message : String(cause),
            }),
        });
        if (!partition || partition.clientId !== clientId) {
          return yield* Effect.fail(
            new NotFoundError({
              code: 'PARTITION_NOT_FOUND',
              message: `Partition '${partitionId}' not found for client '${clientId}'.`,
            }),
          );
        }
      }

      const resolved = yield* Effect.tryPromise({
        try: () => configs.resolve(clientId, partitionId),
        catch: (cause) =>
          new InfrastructureError({
            code: 'MATCHING_CONFIG_REPO_READ_FAILED',
            message: cause instanceof Error ? cause.message : String(cause),
          }),
      });

      const now = new Date();
      const thresholdUpdate = {
        streetThreshold: command.streetThreshold,
        houseNumberThreshold: command.houseNumberThreshold,
        postalCodeThreshold: command.postalCodeThreshold,
        stateThreshold: command.stateThreshold,
        addressNameThreshold: command.addressNameThreshold,
        overallThreshold: command.overallThreshold,
      };

      const isGlobalDefault = resolved.id === MATCHING_CONFIG_GLOBAL_DEFAULT_ID;
      const targetsDifferentScope =
        resolved.clientId !== clientId || resolved.partitionId !== partitionId;

      const aggregate =
        isGlobalDefault || targetsDifferentScope
          ? MatchingConfig.create({
              id: asMatchingConfigId(`${MATCHING_CONFIG_ID_PREFIX}_${generateTsid()}`),
              clientId,
              partitionId,
              thresholds: thresholdUpdate,
              now,
            })
          : MatchingConfig.update(resolved, thresholdUpdate, now);

      const event = new MatchingConfigUpdated(scope, {
        configId: aggregate.id,
        clientId: aggregate.clientId,
        partitionId: aggregate.partitionId,
      });

      return yield* commitAggregate(aggregate, event, command);
    });
  };

  private authorize(): boolean {
    // TODO(auth): real permission check.
    return true;
  }
}
