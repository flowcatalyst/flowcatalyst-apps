/**
 * THE FULFILMENT PROCESS MANAGER — completion leg: reactions to
 * transport-order terminal outcomes (delivered/failed/cancelled), delivered
 * by the platform subscription to /processes/fulfilment.
 *
 * One decider for all three: the part takes the outcome
 * (picked|short_picked → completed|failed), then the derivation point —
 * outcomes still outstanding → fulfilment COMPLETING; all in-play parts
 * terminal → COMPLETED (all delivered) + fulfilment:completed,
 * PARTIALLY_COMPLETED (mixed) + fulfilment:partially-completed, or FAILED
 * (nothing delivered) + fulfilment:failed.
 *
 * Deliveries retry, so the decider is idempotent: state guards return
 * business-rule failures the webhook ACKs (200) — only real errors 500 for
 * a platform retry. Service-scoped, like the pick-process deciders.
 */
import {
  Result,
  ScopeStore,
  UseCaseError,
  commitAggregate,
  emitEvent,
  isFailure,
  type AggregateRegistryImpl,
  type UnitOfWork,
} from '@fulfil-go/framework';
import { Fulfilment } from '../../domain/fulfilments/fulfilment.js';
import { asFulfilmentId, asFulfilmentPartId } from '../../domain/fulfilments/ids.js';
import {
  FulfilmentCompleted,
  FulfilmentPartDelivered,
  FulfilmentPartDeliveryFailed,
  FulfilmentPartiallyCompleted,
} from '../../domain/fulfilments/events/fulfilment-completion.events.js';
import { FulfilmentFailed } from '../../domain/fulfilments/events/fulfilment-pick-progress.events.js';
import type { FulfilmentRepository } from '../../domain/fulfilments/fulfilment.repository.js';
import type { ActivityLogRepository } from '../../infrastructure/activity-log-repository.js';

export interface PartDeliveryCommand {
  readonly clientId: string;
  readonly fulfilmentId: string;
  readonly partId: string;
  readonly transportOrderId: string;
  readonly provider: string;
  readonly delivered: boolean;
  /** Present when the transport order failed/cancelled. */
  readonly reason?: string;
}

export class RegisterPartDeliveryUseCase {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly registry: AggregateRegistryImpl,
    private readonly fulfilments: FulfilmentRepository,
    private readonly activityLog: ActivityLogRepository,
  ) {}

  async execute(
    command: PartDeliveryCommand,
  ): Promise<Result<FulfilmentPartDelivered | FulfilmentPartDeliveryFailed>> {
    const scope = ScopeStore.require();
    const prior = await this.fulfilments.findById(
      command.clientId,
      asFulfilmentId(command.fulfilmentId),
    );
    if (!prior) {
      return Result.failure(
        UseCaseError.notFound(
          'FULFILMENT_NOT_FOUND',
          `Fulfilment '${command.fulfilmentId}' does not exist.`,
        ),
      );
    }
    const part = prior.parts.find((p) => p.id === command.partId);
    if (!part) {
      return Result.failure(
        UseCaseError.notFound('PART_NOT_FOUND', `Part '${command.partId}' does not exist.`),
      );
    }
    // Only a fulfilment awaiting its delivery leg reacts — anything else
    // (cancelled, already completed, replay) is an ACK.
    if (prior.status !== 'ready' && prior.status !== 'completing') {
      return Result.failure(
        UseCaseError.businessRule(
          'FULFILMENT_NOT_AWAITING_DELIVERY',
          `Fulfilment '${prior.id}' is '${prior.status}' — delivery outcome not applicable.`,
          { status: prior.status },
        ),
      );
    }
    if (!Fulfilment.awaitingDelivery(part)) {
      return Result.failure(
        UseCaseError.businessRule(
          'PART_TRANSITION_ALREADY_APPLIED',
          `Part '${part.id}' is '${part.status}' — event already applied or superseded.`,
          { status: part.status },
        ),
      );
    }

    const now = new Date();
    let fulfilment = Fulfilment.partDeliveryOutcome(
      prior,
      asFulfilmentPartId(command.partId),
      command.delivered,
      now,
    );
    await this.activityLog.append({
      clientId: fulfilment.clientId,
      fulfilmentId: fulfilment.id,
      subjectType: 'part',
      subjectId: part.id,
      source: 'domain',
      actor: scope.principalId,
      category: 'delivery',
      message: command.delivered
        ? `Part #${part.shortId} DELIVERED (order ${command.transportOrderId}).`
        : `Part #${part.shortId} delivery FAILED (order ${command.transportOrderId}): ${command.reason ?? 'no reason given'}`,
      data: {
        partId: part.id,
        transportOrderId: command.transportOrderId,
        provider: command.provider,
        delivered: command.delivered,
        ...(command.reason ? { reason: command.reason } : {}),
      },
    });

    // Derivation point: the delivery leg's fulfilment status.
    const status = Fulfilment.deriveCompletion(fulfilment);
    fulfilment = Fulfilment.markCompletion(fulfilment, status, now);
    if (status !== 'completing') {
      const parts = fulfilment.parts
        .filter((p) => p.status === 'completed' || p.status === 'failed')
        .map((p) => ({
          partId: p.id,
          shortId: p.shortId,
          delivered: p.status === 'completed',
        }));
      const terminal =
        status === 'completed'
          ? new FulfilmentCompleted(scope, {
              fulfilmentId: fulfilment.id,
              clientId: fulfilment.clientId,
              externalSource: fulfilment.externalSource,
              externalRef: fulfilment.externalRef,
              parts,
            })
          : status === 'partially_completed'
            ? new FulfilmentPartiallyCompleted(scope, {
                fulfilmentId: fulfilment.id,
                clientId: fulfilment.clientId,
                externalSource: fulfilment.externalSource,
                externalRef: fulfilment.externalRef,
                parts,
              })
            : new FulfilmentFailed(scope, {
                fulfilmentId: fulfilment.id,
                clientId: fulfilment.clientId,
                externalSource: fulfilment.externalSource,
                externalRef: fulfilment.externalRef,
                reason: `No parts were delivered (last failure: ${command.reason ?? 'delivery failed'})`,
              });
      const emitted = await emitEvent(this.uow, terminal, command);
      if (isFailure(emitted)) return emitted;
      await this.activityLog.append({
        clientId: fulfilment.clientId,
        fulfilmentId: fulfilment.id,
        subjectType: 'fulfilment',
        subjectId: fulfilment.id,
        source: 'domain',
        actor: scope.principalId,
        category: 'lifecycle',
        message:
          status === 'completed'
            ? 'Fulfilment COMPLETED — every part delivered.'
            : status === 'partially_completed'
              ? 'Fulfilment PARTIALLY COMPLETED — mixed part outcomes.'
              : 'Fulfilment FAILED — no parts were delivered.',
        data: { parts },
      });
    } else if (prior.status === 'ready') {
      await this.activityLog.append({
        clientId: fulfilment.clientId,
        fulfilmentId: fulfilment.id,
        subjectType: 'fulfilment',
        subjectId: fulfilment.id,
        source: 'domain',
        actor: scope.principalId,
        category: 'lifecycle',
        message: 'Fulfilment COMPLETING — first delivery outcome in; others outstanding.',
        data: null,
      });
    }

    const eventData = {
      fulfilmentId: fulfilment.id,
      clientId: fulfilment.clientId,
      partId: part.id,
      shortId: part.shortId,
      transportOrderId: command.transportOrderId,
      provider: command.provider,
      ...(command.reason ? { reason: command.reason } : {}),
    };
    const event = command.delivered
      ? new FulfilmentPartDelivered(scope, eventData)
      : new FulfilmentPartDeliveryFailed(scope, eventData);
    return commitAggregate(this.uow, this.registry, fulfilment, event, command);
  }
}
