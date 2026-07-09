import {
  Result,
  ScopeStore,
  UseCaseError,
  commitAggregate,
  type AggregateRegistryImpl,
  type Scope,
  type UnitOfWork,
} from '@fulfil-go/framework';
import { FulfilGoPermission } from '@fulfil-go/shared';
import { Fulfilment } from '../../domain/fulfilments/fulfilment.js';
import { isFulfilmentId } from '../../domain/fulfilments/ids.js';
import { FulfilmentCancelled } from '../../domain/fulfilments/events/fulfilment-cancelled.event.js';
import type { FulfilmentRepository } from '../../domain/fulfilments/fulfilment.repository.js';
import type { FulfilmentProcessingLogRepository } from '../../infrastructure/fulfilment-processing-log-repository.js';
import type { CancelFulfilmentCommand } from './cancel-fulfilment.command.js';

export class CancelFulfilmentUseCase {
  static readonly requiredPermission = FulfilGoPermission.CancelFulfilment;

  constructor(
    private readonly uow: UnitOfWork,
    private readonly registry: AggregateRegistryImpl,
    private readonly fulfilments: FulfilmentRepository,
    private readonly processingLog: FulfilmentProcessingLogRepository,
  ) {}

  async execute(command: CancelFulfilmentCommand): Promise<Result<FulfilmentCancelled>> {
    const scope = ScopeStore.require();

    if (!this.authorize(scope)) {
      return Result.failure(
        UseCaseError.authorization(
          'PERMISSION_DENIED',
          `Missing permission ${FulfilGoPermission.CancelFulfilment}.`,
        ),
      );
    }

    if (!isFulfilmentId(command.fulfilmentId)) {
      return Result.failure(
        UseCaseError.notFound(
          'FULFILMENT_NOT_FOUND',
          `Fulfilment '${command.fulfilmentId}' does not exist.`,
        ),
      );
    }

    const prior = await this.fulfilments.findById(command.clientId, command.fulfilmentId);
    if (!prior) {
      return Result.failure(
        UseCaseError.notFound(
          'FULFILMENT_NOT_FOUND',
          `Fulfilment '${command.fulfilmentId}' does not exist.`,
        ),
      );
    }
    if (prior.status === 'cancelled' || prior.status === 'cancelling') {
      return Result.failure(
        UseCaseError.businessRule(
          'FULFILMENT_ALREADY_CANCELLED',
          `Fulfilment '${prior.id}' is already ${prior.status}.`,
          { status: prior.status },
        ),
      );
    }
    // Only `created` is reachable until the process manager lands; once picks
    // can be in flight, cancel from `in_progress` moves through `cancelling`
    // and awaits the pick-context fan-out instead of completing synchronously.
    if (prior.status !== 'created') {
      return Result.failure(
        UseCaseError.businessRule(
          'FULFILMENT_NOT_CANCELLABLE',
          `Fulfilment '${prior.id}' is '${prior.status}' and can no longer be cancelled.`,
          { status: prior.status },
        ),
      );
    }

    const fulfilment = Fulfilment.cancel(prior, new Date());
    const event = new FulfilmentCancelled(scope, {
      fulfilmentId: fulfilment.id,
      clientId: fulfilment.clientId,
      externalSource: fulfilment.externalSource,
      externalRef: fulfilment.externalRef,
      ...(command.reason ? { reason: command.reason } : {}),
    });

    await this.processingLog.append({
      clientId: fulfilment.clientId,
      fulfilmentId: fulfilment.id,
      actor: scope.principalId,
      category: 'lifecycle',
      message: command.reason ? `Fulfilment cancelled: ${command.reason}` : 'Fulfilment cancelled.',
      data: { reason: command.reason ?? null },
    });

    return commitAggregate(this.uow, this.registry, fulfilment, event, command);
  }

  private authorize(scope: Scope): boolean {
    return scope.permissions.has(CancelFulfilmentUseCase.requiredPermission);
  }
}
