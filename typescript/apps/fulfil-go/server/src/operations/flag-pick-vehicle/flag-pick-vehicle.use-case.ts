import {
  Result,
  ScopeStore,
  UseCaseError,
  commitAggregate,
  type AggregateRegistryImpl,
  type UnitOfWork,
} from '@fulfil-go/framework';
import { FulfilGoPermission, SyncEventType } from '@fulfil-go/shared';
import { Pick } from '../../domain/picks/pick.js';
import { isPickId, asPickId } from '../../domain/picks/ids.js';
import { toPickDto } from '../../domain/picks/pick-dto.js';
import { PickCarFlagUpdated } from '../../domain/picks/events/pick-car-flag.event.js';
import type { PickRepository } from '../../domain/picks/pick.repository.js';
import type { ActivityLogRepository } from '../../infrastructure/activity-log-repository.js';
import {
  storeChannel,
  type SyncEventRepository,
} from '../../infrastructure/sync-event-repository.js';

export interface FlagPickVehicleCommand {
  readonly clientId: string;
  readonly pickId: string;
  readonly requiresCarOrLarger: boolean;
}

/**
 * SUPERVISOR MODE (Andrew, 2026-07-14): flag a pick as needing a CAR OR
 * BIGGER — no bike/scooter. Requires the supervisor session grant
 * (role='supervisor' at PIN login) and the store binding, same boundary as
 * claiming. Settable ANYTIME the pick isn't failed/cancelled:
 * - pre-completion: the flag rides the pick; completion can only sharpen
 *   it (picker's "No" never downgrades a supervisor's "Yes");
 * - post-completion: the pick:car-flag-updated event lets the fulfilment PM
 *   re-stamp the part — while transport hasn't been requested yet.
 */
export class FlagPickVehicleUseCase {
  static readonly requiredPermission = FulfilGoPermission.SupervisePicks;

  constructor(
    private readonly uow: UnitOfWork,
    private readonly registry: AggregateRegistryImpl,
    private readonly picks: PickRepository,
    private readonly activityLog: ActivityLogRepository,
    private readonly syncEvents: SyncEventRepository,
  ) {}

  async execute(command: FlagPickVehicleCommand): Promise<Result<PickCarFlagUpdated>> {
    const scope = ScopeStore.require();
    if (!scope.permissions.has(FlagPickVehicleUseCase.requiredPermission)) {
      return Result.failure(
        UseCaseError.authorization(
          'PERMISSION_DENIED',
          `Missing permission ${FulfilGoPermission.SupervisePicks} (supervisor role).`,
        ),
      );
    }
    const storeRef = scope.attributes['storeRef'];
    const scopeClientId = scope.attributes['clientId'];
    if (!storeRef || scopeClientId !== command.clientId) {
      return Result.failure(
        UseCaseError.authorization(
          'NOT_A_PICKER_SESSION',
          'Flagging a pick requires a store-bound supervisor session.',
        ),
      );
    }

    const notFound = () =>
      Result.failure(
        UseCaseError.notFound('PICK_NOT_FOUND', `Pick '${command.pickId}' does not exist.`),
      );
    if (!isPickId(command.pickId)) return notFound();
    const prior = await this.picks.findById(command.clientId, asPickId(command.pickId));
    // Store binding = the boundary; cross-store reads as absent (no probing).
    if (!prior || prior.storeRef !== storeRef) return notFound();
    if (prior.status === 'failed') {
      return Result.failure(
        UseCaseError.businessRule(
          'PICK_NOT_FLAGGABLE',
          `Pick '${prior.id}' is failed — nothing to transport.`,
        ),
      );
    }
    if (prior.requiresCarOrLarger === command.requiresCarOrLarger) {
      return Result.failure(
        UseCaseError.businessRule(
          'FLAG_UNCHANGED',
          `Pick '${prior.id}' already has requiresCarOrLarger=${command.requiresCarOrLarger}.`,
        ),
      );
    }

    const now = new Date();
    const pick = Pick.flagCarOrLarger(prior, command.requiresCarOrLarger, now);

    await this.activityLog.append({
      clientId: pick.clientId,
      fulfilmentId: pick.fulfilmentId,
      subjectType: 'pick',
      subjectId: pick.id,
      source: 'domain',
      actor: scope.principalId,
      category: 'vehicle-flag',
      message: `Part #${pick.shortId} ${
        command.requiresCarOrLarger
          ? 'flagged by supervisor: needs a CAR OR BIGGER (no bike/scooter)'
          : 'supervisor cleared the car-or-larger flag'
      }.`,
      data: { pickId: pick.id, partId: pick.partId, pickStatus: pick.status },
    });

    // Store-channel push (same tx): every station sees the 🚗 badge flip.
    await this.syncEvents.append(storeChannel(pick.clientId, pick.storeRef), SyncEventType.PickUpdated, {
      pick: toPickDto(pick),
    });

    return commitAggregate(
      this.uow,
      this.registry,
      pick,
      new PickCarFlagUpdated(scope, {
        pickId: pick.id,
        clientId: pick.clientId,
        storeRef: pick.storeRef,
        fulfilmentId: pick.fulfilmentId,
        partId: pick.partId,
        shortId: pick.shortId,
        requiresCarOrLarger: command.requiresCarOrLarger,
        pickStatus: pick.status,
      }),
      command,
    );
  }
}
