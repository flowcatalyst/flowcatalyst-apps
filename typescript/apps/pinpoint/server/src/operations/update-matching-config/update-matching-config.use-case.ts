import { generateTsid } from '@flowcatalyst/sdk';
import {
  Result,
  ScopeStore,
  UseCaseError,
  commitAggregate,
  type AggregateRegistryImpl,
  type Scope,
  type UnitOfWork,
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
 */
export class UpdateMatchingConfigUseCase {
  static readonly requiredPermission = PinpointPermission.MatchingConfigManage;

  constructor(
    private readonly uow: UnitOfWork,
    private readonly registry: AggregateRegistryImpl,
    private readonly clients: ClientRepository,
    private readonly partitions: PartitionRepository,
    private readonly configs: MatchingConfigRepository,
  ) {}

  async execute(command: UpdateMatchingConfigCommand): Promise<Result<MatchingConfigUpdated>> {
    const scope = ScopeStore.require();

    if (!this.authorize(scope)) {
      return Result.failure(
        UseCaseError.authorization(
          'PERMISSION_DENIED',
          `Missing permission ${PinpointPermission.MatchingConfigManage}.`,
        ),
      );
    }

    const clientId = asClientId(command.clientId.trim());
    const partitionId =
      command.partitionId != null && command.partitionId.trim().length > 0
        ? asPartitionId(command.partitionId.trim())
        : null;

    const client = await this.clients.findById(clientId);
    if (!client) {
      return Result.failure(
        UseCaseError.notFound('CLIENT_NOT_FOUND', `Client '${clientId}' not found.`),
      );
    }

    if (partitionId != null) {
      const partition = await this.partitions.findById(partitionId);
      if (!partition || partition.clientId !== clientId) {
        return Result.failure(
          UseCaseError.notFound(
            'PARTITION_NOT_FOUND',
            `Partition '${partitionId}' not found for client '${clientId}'.`,
          ),
        );
      }
    }

    const resolved = await this.configs.resolve(clientId, partitionId);

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

    return commitAggregate(this.uow, this.registry, aggregate, event, command);
  }

  private authorize(scope: Scope): boolean {
    return scope.permissions.has(UpdateMatchingConfigUseCase.requiredPermission);
  }
}
