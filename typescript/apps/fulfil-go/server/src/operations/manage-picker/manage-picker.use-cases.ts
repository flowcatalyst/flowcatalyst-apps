/**
 * Picker lifecycle admin operations: suspend / reactivate / reassign / delete.
 * Deliberately co-located — each is the same thin shape (authorize →
 * load → guard → transition → event → commit) over the PickerUser aggregate.
 *
 * Sessions are NOT revoked here: picker access tokens are short-lived and
 * /pick-auth/refresh re-checks status + store binding, so suspension or a
 * store move ends a live session within one access TTL.
 */
import {
  Result,
  ScopeStore,
  UseCaseError,
  commitAggregate,
  commitDelete,
  type AggregateRegistryImpl,
  type Scope,
  type UnitOfWork,
} from '@fulfil-go/framework';
import { FulfilGoPermission } from '@fulfil-go/shared';
import { PickerUser } from '../../domain/pick-identity/picker-user.js';
import { asPickerUserId, isPickerUserId } from '../../domain/pick-identity/ids.js';
import {
  PickerDeleted,
  PickerReactivated,
  PickerReassigned,
  PickerSuspended,
  type PickerLifecycleData,
} from '../../domain/pick-identity/events/picker-lifecycle.events.js';
import type { PickerUserRepository } from '../../domain/pick-identity/picker-user.repository.js';
import type { StoreRepository } from '../../infrastructure/store-repository.js';

export interface PickerRefCommand {
  readonly clientId: string;
  readonly pickerId: string;
}

export interface ReassignPickerCommand extends PickerRefCommand {
  readonly storeRef: string;
}

type LoadOutcome =
  | { readonly ok: true; readonly picker: PickerUser; readonly scope: Scope }
  | { readonly ok: false; readonly failure: Result<never> };

async function authorizeAndLoad(
  pickers: PickerUserRepository,
  command: PickerRefCommand,
): Promise<LoadOutcome> {
  const scope = ScopeStore.require();
  if (!scope.permissions.has(FulfilGoPermission.ManagePickers)) {
    return {
      ok: false,
      failure: Result.failure(
        UseCaseError.authorization(
          'PERMISSION_DENIED',
          `Missing permission ${FulfilGoPermission.ManagePickers}.`,
        ),
      ),
    };
  }
  if (!isPickerUserId(command.pickerId)) {
    return {
      ok: false,
      failure: Result.failure(
        UseCaseError.notFound('PICKER_NOT_FOUND', `Picker '${command.pickerId}' does not exist.`),
      ),
    };
  }
  const picker = await pickers.findById(command.clientId, asPickerUserId(command.pickerId));
  if (!picker) {
    return {
      ok: false,
      failure: Result.failure(
        UseCaseError.notFound('PICKER_NOT_FOUND', `Picker '${command.pickerId}' does not exist.`),
      ),
    };
  }
  return { ok: true, picker, scope };
}

function lifecycleData(picker: PickerUser): PickerLifecycleData {
  return {
    pickerId: picker.id,
    clientId: picker.clientId,
    storeRef: picker.storeRef,
    staffCode: picker.staffCode,
  };
}

export class SuspendPickerUseCase {
  static readonly requiredPermission = FulfilGoPermission.ManagePickers;

  constructor(
    private readonly uow: UnitOfWork,
    private readonly registry: AggregateRegistryImpl,
    private readonly pickers: PickerUserRepository,
  ) {}

  async execute(command: PickerRefCommand): Promise<Result<PickerSuspended>> {
    const loaded = await authorizeAndLoad(this.pickers, command);
    if (!loaded.ok) return loaded.failure;
    if (loaded.picker.status === 'suspended') {
      return Result.failure(
        UseCaseError.businessRule('PICKER_ALREADY_SUSPENDED', 'Picker is already suspended.'),
      );
    }
    const picker = PickerUser.suspend(loaded.picker, new Date());
    const event = new PickerSuspended(loaded.scope, lifecycleData(picker));
    return commitAggregate(this.uow, this.registry, picker, event, command);
  }
}

export class ReactivatePickerUseCase {
  static readonly requiredPermission = FulfilGoPermission.ManagePickers;

  constructor(
    private readonly uow: UnitOfWork,
    private readonly registry: AggregateRegistryImpl,
    private readonly pickers: PickerUserRepository,
  ) {}

  async execute(command: PickerRefCommand): Promise<Result<PickerReactivated>> {
    const loaded = await authorizeAndLoad(this.pickers, command);
    if (!loaded.ok) return loaded.failure;
    if (loaded.picker.status === 'active') {
      return Result.failure(
        UseCaseError.businessRule('PICKER_ALREADY_ACTIVE', 'Picker is already active.'),
      );
    }
    const picker = PickerUser.reactivate(loaded.picker, new Date());
    const event = new PickerReactivated(loaded.scope, lifecycleData(picker));
    return commitAggregate(this.uow, this.registry, picker, event, command);
  }
}

export class ReassignPickerUseCase {
  static readonly requiredPermission = FulfilGoPermission.ManagePickers;

  constructor(
    private readonly uow: UnitOfWork,
    private readonly registry: AggregateRegistryImpl,
    private readonly pickers: PickerUserRepository,
    private readonly stores: StoreRepository,
  ) {}

  async execute(command: ReassignPickerCommand): Promise<Result<PickerReassigned>> {
    const loaded = await authorizeAndLoad(this.pickers, command);
    if (!loaded.ok) return loaded.failure;
    const { picker: prior, scope } = loaded;

    if (prior.storeRef === command.storeRef) {
      return Result.failure(
        UseCaseError.businessRule(
          'PICKER_ALREADY_AT_STORE',
          `Picker is already at '${command.storeRef}'.`,
        ),
      );
    }
    const storeExists = await this.stores.existsByRef(command.clientId, command.storeRef);
    if (!storeExists) {
      return Result.failure(
        UseCaseError.validation(
          'STORE_NOT_FOUND',
          `Store '${command.storeRef}' is not in the registry.`,
        ),
      );
    }
    // Staff codes are unique per store — a collision at the target would
    // otherwise surface as a raw DB unique violation.
    const clash = await this.pickers.findByStaffCode(
      command.clientId,
      command.storeRef,
      prior.staffCode,
    );
    if (clash) {
      return Result.failure(
        UseCaseError.businessRule(
          'STAFF_CODE_EXISTS',
          `Staff code '${prior.staffCode}' already exists at '${command.storeRef}'.`,
          { pickerId: clash.id },
        ),
      );
    }

    const picker = PickerUser.reassign(prior, command.storeRef, new Date());
    const event = new PickerReassigned(scope, {
      ...lifecycleData(picker),
      previousStoreRef: prior.storeRef,
    });
    return commitAggregate(this.uow, this.registry, picker, event, command);
  }
}

export class DeletePickerUseCase {
  static readonly requiredPermission = FulfilGoPermission.ManagePickers;

  constructor(
    private readonly uow: UnitOfWork,
    private readonly registry: AggregateRegistryImpl,
    private readonly pickers: PickerUserRepository,
  ) {}

  async execute(command: PickerRefCommand): Promise<Result<PickerDeleted>> {
    const loaded = await authorizeAndLoad(this.pickers, command);
    if (!loaded.ok) return loaded.failure;
    // Hard delete: the row goes; historical attributions (picks.claimedBy,
    // activity-log actors) keep the pkr_… id as a plain string.
    const event = new PickerDeleted(loaded.scope, lifecycleData(loaded.picker));
    return commitDelete(this.uow, this.registry, loaded.picker, event, command);
  }
}
