/**
 * Post-claim pick outcomes: complete (full or short) and fail. Co-located —
 * both are the same claimer-only shape over the Pick aggregate.
 *
 * The policy seam: `pick.requireFullPick` is the boundary translation of the
 * fulfilment's `allowPartialFulfilment` (hydrated at pick release). A short
 * completion is REJECTED when requireFullPick — the picker's only out is an
 * explicit fail, which the future process manager turns into failing the
 * whole fulfilment (all-or-nothing).
 */
import {
  Result,
  ScopeStore,
  UseCaseError,
  commitAggregate,
  type AggregateRegistryImpl,
  type Scope,
  type UnitOfWork,
} from '@fulfil-go/framework';
import {
  FulfilGoPermission,
  SyncEventType,
  type CompletePickCommand,
  type FailPickCommand,
} from '@fulfil-go/shared';
import { Pick, type PickLineResult } from '../../domain/picks/pick.js';
import { asPickId, isPickId } from '../../domain/picks/ids.js';
import { toPickDto } from '../../domain/picks/pick-dto.js';
import {
  PickFailed,
  PickPicked,
  PickShortPicked,
} from '../../domain/picks/events/pick-outcome.events.js';
import type { PickRepository } from '../../domain/picks/pick.repository.js';
import type { FulfilmentProcessingLogRepository } from '../../infrastructure/fulfilment-processing-log-repository.js';
import {
  storeChannel,
  type SyncEventRepository,
} from '../../infrastructure/sync-event-repository.js';

interface PickRef {
  readonly clientId: string;
  readonly pickId: string;
}

type LoadOutcome =
  | { readonly ok: true; readonly pick: Pick; readonly scope: Scope }
  | { readonly ok: false; readonly failure: Result<never> };

/**
 * Shared guard: picker session scoped to this client, pick exists at the
 * picker's store (cross-store reads as 404 — no id enumeration), pick is
 * claimed, and the CALLER is the claimer.
 */
async function authorizeAndLoad(picks: PickRepository, command: PickRef): Promise<LoadOutcome> {
  const scope = ScopeStore.require();
  const fail = (failure: Result<never>): LoadOutcome => ({ ok: false, failure });

  if (!scope.permissions.has(FulfilGoPermission.ReportPickOutcome)) {
    return fail(
      Result.failure(
        UseCaseError.authorization(
          'PERMISSION_DENIED',
          `Missing permission ${FulfilGoPermission.ReportPickOutcome}.`,
        ),
      ),
    );
  }
  const storeRef = scope.attributes['storeRef'];
  const scopeClientId = scope.attributes['clientId'];
  if (!storeRef || scopeClientId !== command.clientId) {
    return fail(
      Result.failure(
        UseCaseError.authorization(
          'NOT_A_PICKER_SESSION',
          'Reporting a pick outcome requires a picker session scoped to this client.',
        ),
      ),
    );
  }

  const notFound = () =>
    fail(
      Result.failure(
        UseCaseError.notFound('PICK_NOT_FOUND', `Pick '${command.pickId}' does not exist.`),
      ),
    );
  if (!isPickId(command.pickId)) return notFound();
  const pick = await picks.findById(command.clientId, asPickId(command.pickId));
  if (!pick || pick.storeRef !== storeRef) return notFound();

  if (pick.status !== 'claimed') {
    return fail(
      Result.failure(
        UseCaseError.businessRule('PICK_NOT_IN_PROGRESS', `Pick '${pick.id}' is '${pick.status}'.`, {
          status: pick.status,
        }),
      ),
    );
  }
  if (pick.claimedBy !== scope.principalId) {
    return fail(
      Result.failure(
        UseCaseError.authorization(
          'PICK_NOT_YOURS',
          'Only the picker who claimed this pick can report its outcome.',
        ),
      ),
    );
  }
  return { ok: true, pick, scope };
}

export class CompletePickUseCase {
  static readonly requiredPermission = FulfilGoPermission.ReportPickOutcome;

  constructor(
    private readonly uow: UnitOfWork,
    private readonly registry: AggregateRegistryImpl,
    private readonly picks: PickRepository,
    private readonly fulfilmentLog: FulfilmentProcessingLogRepository,
    private readonly syncEvents: SyncEventRepository,
  ) {}

  async execute(command: CompletePickCommand): Promise<Result<PickPicked | PickShortPicked>> {
    const loaded = await authorizeAndLoad(this.picks, command);
    if (!loaded.ok) return loaded.failure;
    const { pick: prior, scope } = loaded;

    // Exact line coverage: one result per pick line, nothing extra, and
    // never more than was ordered. Explicit zeros, no silent omissions.
    const byRef = new Map(command.lines.map((l) => [l.externalLineRef, l.pickedQuantity]));
    if (byRef.size !== command.lines.length) {
      return Result.failure(
        UseCaseError.validation('DUPLICATE_LINE_RESULT', 'Each line may appear only once.'),
      );
    }
    for (const line of prior.lines) {
      const picked = byRef.get(line.externalLineRef);
      if (picked === undefined) {
        return Result.failure(
          UseCaseError.validation(
            'LINE_RESULT_MISSING',
            `Missing picked quantity for line '${line.externalLineRef}'.`,
          ),
        );
      }
      if (picked > line.quantity) {
        return Result.failure(
          UseCaseError.validation(
            'LINE_OVER_PICKED',
            `Line '${line.externalLineRef}': picked ${picked} exceeds ordered ${line.quantity}.`,
          ),
        );
      }
      byRef.delete(line.externalLineRef);
    }
    if (byRef.size > 0) {
      return Result.failure(
        UseCaseError.validation(
          'UNKNOWN_LINE_RESULT',
          `Unknown line ref(s): ${[...byRef.keys()].join(', ')}.`,
        ),
      );
    }

    const results: PickLineResult[] = command.lines.map((l) => ({
      externalLineRef: l.externalLineRef,
      pickedQuantity: l.pickedQuantity,
    }));
    const full = Pick.isFullPick(prior, results);
    // THE policy gate: short completion needs the fulfilment to have allowed
    // partial fulfilment (requireFullPick = !allowPartialFulfilment).
    if (!full && prior.requireFullPick) {
      return Result.failure(
        UseCaseError.businessRule(
          'PICK_REQUIRES_FULL_PICK',
          'This pick must be completed in full — the fulfilment does not allow ' +
            'partial fulfilment. Pick every line in full, or fail the pick.',
          { requireFullPick: true },
        ),
      );
    }

    const now = new Date();
    const pick = Pick.complete(prior, results, now);
    const data = {
      pickId: pick.id,
      clientId: pick.clientId,
      storeRef: pick.storeRef,
      fulfilmentId: pick.fulfilmentId,
      partId: pick.partId,
      shortId: pick.shortId,
      pickerId: scope.principalId,
      lineResults: results,
    };
    const event = full ? new PickPicked(scope, data) : new PickShortPicked(scope, data);

    const units = results.reduce((sum, r) => sum + r.pickedQuantity, 0);
    const ordered = prior.lines.reduce((sum, l) => sum + l.quantity, 0);
    await this.fulfilmentLog.append({
      clientId: pick.clientId,
      fulfilmentId: pick.fulfilmentId,
      actor: scope.principalId,
      category: 'pick-release',
      message: full
        ? `Part #${pick.shortId} picked in full (${units} units) at ${pick.storeRef}.`
        : `Part #${pick.shortId} picked SHORT (${units} of ${ordered} units) at ${pick.storeRef}.`,
      data: { pickId: pick.id, partId: pick.partId, lineResults: results, full },
    });
    await this.syncEvents.append(
      storeChannel(pick.clientId, pick.storeRef),
      SyncEventType.PickCompleted,
      { pick: toPickDto(pick) },
    );

    return commitAggregate(this.uow, this.registry, pick, event, command);
  }
}

export class FailPickUseCase {
  static readonly requiredPermission = FulfilGoPermission.ReportPickOutcome;

  constructor(
    private readonly uow: UnitOfWork,
    private readonly registry: AggregateRegistryImpl,
    private readonly picks: PickRepository,
    private readonly fulfilmentLog: FulfilmentProcessingLogRepository,
    private readonly syncEvents: SyncEventRepository,
  ) {}

  async execute(command: FailPickCommand): Promise<Result<PickFailed>> {
    const loaded = await authorizeAndLoad(this.picks, command);
    if (!loaded.ok) return loaded.failure;
    const { pick: prior, scope } = loaded;

    const now = new Date();
    const pick = Pick.fail(prior, command.reason, now);
    const event = new PickFailed(scope, {
      pickId: pick.id,
      clientId: pick.clientId,
      storeRef: pick.storeRef,
      fulfilmentId: pick.fulfilmentId,
      partId: pick.partId,
      shortId: pick.shortId,
      pickerId: scope.principalId,
      reason: command.reason,
    });

    await this.fulfilmentLog.append({
      clientId: pick.clientId,
      fulfilmentId: pick.fulfilmentId,
      actor: scope.principalId,
      category: 'pick-release',
      message: `Part #${pick.shortId} pick FAILED at ${pick.storeRef}: ${command.reason}`,
      data: { pickId: pick.id, partId: pick.partId, reason: command.reason },
    });
    await this.syncEvents.append(
      storeChannel(pick.clientId, pick.storeRef),
      SyncEventType.PickFailed,
      { pick: toPickDto(pick) },
    );

    return commitAggregate(this.uow, this.registry, pick, event, command);
  }
}
