import {
  Result,
  ScopeStore,
  UseCaseError,
  commitAggregate,
  type AggregateRegistryImpl,
  type UnitOfWork,
} from '@fulfil-go/framework';
import { SyncEventType, type CreatePickRequest } from '@fulfil-go/shared';
import { Pick } from '../../domain/picks/pick.js';
import { newPickId } from '../../domain/picks/ids.js';
import { toPickDto } from '../../domain/picks/pick-dto.js';
import { PickCreated } from '../../domain/picks/events/pick-created.event.js';
import type { PickRepository } from '../../domain/picks/pick.repository.js';
import type { FulfilmentProcessingLogRepository } from '../../infrastructure/fulfilment-processing-log-repository.js';
import {
  storeChannel,
  type SyncEventRepository,
} from '../../infrastructure/sync-event-repository.js';

/**
 * PICK CONTEXT INTAKE: accept a create-pick command (delivered by the
 * platform dispatcher to the /picks landing pad) and register the work item.
 * Runs under a SERVICE scope — the command is platform-authenticated (HMAC),
 * not user-driven, so there's no per-user permission check (same shape as the
 * release sweep).
 *
 * Idempotent on (clientId, partId): the dispatcher retries on non-2xx, so a
 * duplicate returns PICK_ALREADY_EXISTS and the landing pad still acks 200.
 * Receipt is recorded on the fulfilment's processing log in the same tx —
 * observability only (the log is cross-context but same-DB, and nothing reads
 * it to make decisions).
 */
export class ReceivePickUseCase {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly registry: AggregateRegistryImpl,
    private readonly picks: PickRepository,
    private readonly fulfilmentLog: FulfilmentProcessingLogRepository,
    private readonly syncEvents: SyncEventRepository,
  ) {}

  async execute(command: CreatePickRequest): Promise<Result<PickCreated>> {
    const scope = ScopeStore.require();

    const existing = await this.picks.findByPartId(command.clientId, command.partId);
    if (existing) {
      return Result.failure(
        UseCaseError.businessRule(
          'PICK_ALREADY_EXISTS',
          `A pick for part '${command.partId}' already exists.`,
          { pickId: existing.id },
        ),
      );
    }

    const now = new Date();
    const pick = Pick.create({
      id: newPickId(),
      clientId: command.clientId,
      fulfilmentId: command.fulfilmentId,
      partId: command.partId,
      shortId: command.shortId,
      type: command.type,
      serviceLevel: command.serviceLevel,
      slotStart: new Date(command.slotStart),
      slotEnd: new Date(command.slotEnd),
      timezone: command.timezone,
      origin: command.origin,
      lines: command.lines,
      requireFullPick: command.requireFullPick,
      allowSubstitutes: command.allowSubstitutes,
      releasedLate: command.releasedLate,
      now,
    });

    const event = new PickCreated(scope, {
      pickId: pick.id,
      clientId: pick.clientId,
      storeRef: pick.storeRef,
      fulfilmentId: pick.fulfilmentId,
      partId: pick.partId,
      shortId: pick.shortId,
    });

    await this.fulfilmentLog.append({
      clientId: pick.clientId,
      fulfilmentId: pick.fulfilmentId,
      actor: scope.principalId,
      category: 'pick-release',
      message: `Pick ${pick.id} registered for part #${pick.shortId} at ${pick.storeRef}.`,
      data: { pickId: pick.id, partId: pick.partId },
    });

    // Same ALS-bound tx as the aggregate write — the station stream never
    // sees a pick whose commit rolled back.
    await this.syncEvents.append(
      storeChannel(pick.clientId, pick.storeRef),
      SyncEventType.PickCreated,
      { pick: toPickDto(pick) },
    );

    return commitAggregate(this.uow, this.registry, pick, event, command);
  }
}
