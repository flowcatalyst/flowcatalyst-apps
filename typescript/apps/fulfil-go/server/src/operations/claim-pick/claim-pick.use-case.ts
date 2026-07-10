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
import { Pick } from '../../domain/picks/pick.js';
import { isPickId, asPickId } from '../../domain/picks/ids.js';
import { PickClaimed } from '../../domain/picks/events/pick-claimed.event.js';
import type { PickRepository } from '../../domain/picks/pick.repository.js';
import type { FulfilmentProcessingLogRepository } from '../../infrastructure/fulfilment-processing-log-repository.js';

export interface ClaimPickCommand {
  readonly clientId: string;
  readonly pickId: string;
}

/**
 * A picker claims a requested pick. Callable only with a picker session:
 * the scope must carry `storeRef`/`clientId` attributes (stamped by the
 * session token), and the pick must belong to that store — the shared
 * station's store binding IS the authorization boundary. Optimistic locking
 * turns a racing double-claim into a 409.
 */
export class ClaimPickUseCase {
  static readonly requiredPermission = FulfilGoPermission.ClaimPick;

  constructor(
    private readonly uow: UnitOfWork,
    private readonly registry: AggregateRegistryImpl,
    private readonly picks: PickRepository,
    private readonly fulfilmentLog: FulfilmentProcessingLogRepository,
  ) {}

  async execute(command: ClaimPickCommand): Promise<Result<PickClaimed>> {
    const scope = ScopeStore.require();

    if (!this.authorize(scope)) {
      return Result.failure(
        UseCaseError.authorization(
          'PERMISSION_DENIED',
          `Missing permission ${FulfilGoPermission.ClaimPick}.`,
        ),
      );
    }
    const storeRef = scope.attributes['storeRef'];
    const scopeClientId = scope.attributes['clientId'];
    if (!storeRef || !scopeClientId) {
      return Result.failure(
        UseCaseError.authorization(
          'NOT_A_PICKER_SESSION',
          'Claiming a pick requires a store-bound picker session.',
        ),
      );
    }
    if (scopeClientId !== command.clientId) {
      return Result.failure(
        UseCaseError.authorization(
          'CLIENT_SCOPE_MISMATCH',
          'Picker session is not scoped to this client.',
        ),
      );
    }

    if (!isPickId(command.pickId)) {
      return Result.failure(
        UseCaseError.notFound('PICK_NOT_FOUND', `Pick '${command.pickId}' does not exist.`),
      );
    }
    const prior = await this.picks.findById(command.clientId, asPickId(command.pickId));
    if (!prior) {
      return Result.failure(
        UseCaseError.notFound('PICK_NOT_FOUND', `Pick '${command.pickId}' does not exist.`),
      );
    }
    // Store binding is the boundary: a picker never sees or touches another
    // store's picks. 404 (not 403) so cross-store probing can't enumerate ids.
    if (prior.storeRef !== storeRef) {
      return Result.failure(
        UseCaseError.notFound('PICK_NOT_FOUND', `Pick '${command.pickId}' does not exist.`),
      );
    }
    if (prior.status !== 'requested') {
      return Result.failure(
        UseCaseError.businessRule(
          'PICK_NOT_CLAIMABLE',
          `Pick '${prior.id}' is '${prior.status}'.`,
          { status: prior.status, claimedBy: prior.claimedBy },
        ),
      );
    }

    const now = new Date();
    const pick = Pick.claim(prior, scope.principalId, now);

    const event = new PickClaimed(scope, {
      pickId: pick.id,
      clientId: pick.clientId,
      storeRef: pick.storeRef,
      fulfilmentId: pick.fulfilmentId,
      partId: pick.partId,
      shortId: pick.shortId,
      pickerId: scope.principalId,
    });

    await this.fulfilmentLog.append({
      clientId: pick.clientId,
      fulfilmentId: pick.fulfilmentId,
      actor: scope.principalId,
      category: 'pick-release',
      message: `Part #${pick.shortId} claimed for picking at ${pick.storeRef}.`,
      data: { pickId: pick.id, partId: pick.partId, pickerId: scope.principalId },
    });

    return commitAggregate(this.uow, this.registry, pick, event, command);
  }

  private authorize(scope: Scope): boolean {
    return scope.permissions.has(ClaimPickUseCase.requiredPermission);
  }
}
