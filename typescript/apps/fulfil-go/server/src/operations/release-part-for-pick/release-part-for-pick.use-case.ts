import { CreateDispatchJobDto, type OutboxManager } from '@flowcatalyst/sdk';
import {
  Result,
  ScopeStore,
  UseCaseError,
  commitAggregate,
  eventGroup,
  type AggregateRegistryImpl,
  type UnitOfWork,
} from '@fulfil-go/framework';
import { Fulfilment } from '../../domain/fulfilments/fulfilment.js';
import type { FulfilmentId, FulfilmentPartId } from '../../domain/fulfilments/ids.js';
import { FulfilmentPartPickRequested } from '../../domain/fulfilments/events/fulfilment-part-pick-requested.event.js';
import type { FulfilmentRepository } from '../../domain/fulfilments/fulfilment.repository.js';
import type { ActivityLogRepository } from '../../infrastructure/activity-log-repository.js';
import { CreatePickCommandCode } from '../../flowcatalyst/dispatch-commands.js';

export interface ReleasePartCommand {
  readonly clientId: string;
  readonly fulfilmentId: FulfilmentId;
  readonly partId: FulfilmentPartId;
}

export interface ReleaseDispatchConfig {
  /** Base URL the platform's dispatcher calls back into (create-pick target). */
  readonly publicBaseUrl: string;
  readonly dispatchPoolCode: string;
}

/**
 * Release one part to the pick context (invoked by the release-picks sweep
 * under the SCHEDULER identity — no per-user permission check). In ONE tx:
 * part `pending → pick_requested` (+ fulfilment `created → in_progress`),
 * activity-log entry, the `part.pick-requested` event (fact), and the
 * create-pick DISPATCH JOB (command) — the platform delivers it to the pick
 * context with retries/pooling. Idempotent: a non-pending part short-circuits,
 * and optimistic locking guards the transition.
 */
export class ReleasePartForPickUseCase {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly registry: AggregateRegistryImpl,
    private readonly fulfilments: FulfilmentRepository,
    private readonly activityLog: ActivityLogRepository,
    private readonly outbox: OutboxManager,
    private readonly dispatch: ReleaseDispatchConfig,
  ) {}

  async execute(command: ReleasePartCommand): Promise<Result<FulfilmentPartPickRequested>> {
    const scope = ScopeStore.require();

    const prior = await this.fulfilments.findById(command.clientId, command.fulfilmentId);
    if (!prior) {
      return Result.failure(
        UseCaseError.notFound(
          'FULFILMENT_NOT_FOUND',
          `Fulfilment '${command.fulfilmentId}' does not exist.`,
        ),
      );
    }
    if (prior.status !== 'created' && prior.status !== 'in_progress') {
      return Result.failure(
        UseCaseError.businessRule(
          'FULFILMENT_NOT_RELEASABLE',
          `Fulfilment '${prior.id}' is '${prior.status}'.`,
          { status: prior.status },
        ),
      );
    }
    const part = prior.parts.find((p) => p.id === command.partId);
    if (!part) {
      return Result.failure(
        UseCaseError.notFound('PART_NOT_FOUND', `Part '${command.partId}' does not exist.`),
      );
    }
    if (part.status !== 'pending') {
      return Result.failure(
        UseCaseError.businessRule(
          'PART_ALREADY_RELEASED',
          `Part '${part.id}' is '${part.status}' — nothing to release.`,
          { status: part.status },
        ),
      );
    }

    const now = new Date();
    const releasedLate = now.getTime() > prior.slotEnd.getTime();
    const fulfilment = Fulfilment.releasePart(prior, command.partId, now);

    const event = new FulfilmentPartPickRequested(scope, {
      fulfilmentId: fulfilment.id,
      clientId: fulfilment.clientId,
      partId: part.id,
      shortId: part.shortId,
      originRef: part.origin.ref,
      releasedLate,
    });

    // The create-pick COMMAND — hydrated with everything the pick context
    // needs (captured data; pick hydrates substitutes itself from master
    // data). requireFullPick is the boundary translation of the fulfilment's
    // allowPartialFulfilment policy — pick never learns fulfilment policy.
    const createPickPayload = {
      clientId: fulfilment.clientId,
      fulfilmentId: fulfilment.id,
      partId: part.id,
      shortId: part.shortId,
      type: fulfilment.type,
      serviceLevel: fulfilment.serviceLevel,
      slotStart: fulfilment.slotStart.toISOString(),
      slotEnd: fulfilment.slotEnd.toISOString(),
      timezone: fulfilment.timezone,
      origin: part.origin,
      lines: part.lines,
      requireFullPick: !fulfilment.policies.allowPartialFulfilment,
      allowSubstitutes: fulfilment.policies.allowSubstitutes,
      releasedLate,
    };

    const dispatchJob = CreateDispatchJobDto.create(
      'fulfil-go:fulfilment',
      CreatePickCommandCode,
      `${this.dispatch.publicBaseUrl}/clients/${fulfilment.clientId}/picks`,
      createPickPayload,
      this.dispatch.dispatchPoolCode,
    )
      .withSubject(`fulfilment.part.${part.id}`)
      .withMessageGroup(eventGroup('fulfilment', fulfilment.id))
      // NOTE: no .withMetadata() — the TS SDK serializes metadata as an
      // OBJECT but the Go platform requires [{key,value}] (SDK bug, flagged);
      // an object fails the whole batch decode with 400 INVALID_JSON.
      .withIdempotencyKey(`create-pick-${part.id}`);

    // Joins the ambient use-case tx via the ALS-aware outbox driver — the
    // command rolls back with the transition if anything fails.
    await this.outbox.createDispatchJob(dispatchJob);

    await this.activityLog.append({
      clientId: fulfilment.clientId,
      fulfilmentId: fulfilment.id,
      subjectType: 'part',
      subjectId: part.id,
      source: 'domain',
      actor: scope.principalId,
      category: 'pick-release',
      message: releasedLate
        ? `Part #${part.shortId} released for picking LATE (slot ended ${prior.slotEnd.toISOString()}).`
        : `Part #${part.shortId} released for picking.`,
      data: { partId: part.id, releasedLate, releaseAt: part.releaseAt.toISOString() },
    });

    return commitAggregate(this.uow, this.registry, fulfilment, event, command);
  }
}
