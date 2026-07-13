/**
 * Driver lifecycle admin operations: suspend / reactivate / reassign /
 * delete — the manage-picker shape over the DriverUser aggregate.
 *
 * Sessions are NOT revoked here: driver access tokens are short-lived and
 * /driver-auth/refresh re-checks status + depot binding, so suspension or a
 * depot move ends a live session within one access TTL.
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
import { DriverUser } from '../../domain/driver-identity/driver-user.js';
import { asDriverUserId, isDriverUserId } from '../../domain/driver-identity/ids.js';
import {
  DriverDeleted,
  DriverReactivated,
  DriverReassigned,
  DriverSuspended,
  type DriverLifecycleData,
} from '../../domain/driver-identity/events/driver.events.js';
import type { DriverUserRepository } from '../../domain/driver-identity/driver-user.repository.js';
import type { StoreRepository } from '../../infrastructure/store-repository.js';

export interface DriverRefCommand {
  readonly clientId: string;
  readonly driverId: string;
}

export interface ReassignDriverCommand extends DriverRefCommand {
  readonly storeRef: string;
}

type LoadOutcome =
  | { readonly ok: true; readonly driver: DriverUser; readonly scope: Scope }
  | { readonly ok: false; readonly failure: Result<never> };

async function authorizeAndLoad(
  drivers: DriverUserRepository,
  command: DriverRefCommand,
): Promise<LoadOutcome> {
  const scope = ScopeStore.require();
  if (!scope.permissions.has(FulfilGoPermission.ManageDrivers)) {
    return {
      ok: false,
      failure: Result.failure(
        UseCaseError.authorization(
          'PERMISSION_DENIED',
          `Missing permission ${FulfilGoPermission.ManageDrivers}.`,
        ),
      ),
    };
  }
  if (!isDriverUserId(command.driverId)) {
    return {
      ok: false,
      failure: Result.failure(
        UseCaseError.notFound('DRIVER_NOT_FOUND', `Driver '${command.driverId}' does not exist.`),
      ),
    };
  }
  const driver = await drivers.findById(command.clientId, asDriverUserId(command.driverId));
  if (!driver) {
    return {
      ok: false,
      failure: Result.failure(
        UseCaseError.notFound('DRIVER_NOT_FOUND', `Driver '${command.driverId}' does not exist.`),
      ),
    };
  }
  return { ok: true, driver, scope };
}

function lifecycleData(driver: DriverUser): DriverLifecycleData {
  return {
    driverId: driver.id,
    clientId: driver.clientId,
    storeRef: driver.storeRef,
    staffCode: driver.staffCode,
  };
}

export class SuspendDriverUseCase {
  static readonly requiredPermission = FulfilGoPermission.ManageDrivers;

  constructor(
    private readonly uow: UnitOfWork,
    private readonly registry: AggregateRegistryImpl,
    private readonly drivers: DriverUserRepository,
  ) {}

  async execute(command: DriverRefCommand): Promise<Result<DriverSuspended>> {
    const loaded = await authorizeAndLoad(this.drivers, command);
    if (!loaded.ok) return loaded.failure;
    if (loaded.driver.status === 'suspended') {
      return Result.failure(
        UseCaseError.businessRule('DRIVER_ALREADY_SUSPENDED', 'Driver is already suspended.'),
      );
    }
    const driver = DriverUser.suspend(loaded.driver, new Date());
    const event = new DriverSuspended(loaded.scope, lifecycleData(driver));
    return commitAggregate(this.uow, this.registry, driver, event, command);
  }
}

export class ReactivateDriverUseCase {
  static readonly requiredPermission = FulfilGoPermission.ManageDrivers;

  constructor(
    private readonly uow: UnitOfWork,
    private readonly registry: AggregateRegistryImpl,
    private readonly drivers: DriverUserRepository,
  ) {}

  async execute(command: DriverRefCommand): Promise<Result<DriverReactivated>> {
    const loaded = await authorizeAndLoad(this.drivers, command);
    if (!loaded.ok) return loaded.failure;
    if (loaded.driver.status === 'active') {
      return Result.failure(
        UseCaseError.businessRule('DRIVER_ALREADY_ACTIVE', 'Driver is already active.'),
      );
    }
    const driver = DriverUser.reactivate(loaded.driver, new Date());
    const event = new DriverReactivated(loaded.scope, lifecycleData(driver));
    return commitAggregate(this.uow, this.registry, driver, event, command);
  }
}

export class ReassignDriverUseCase {
  static readonly requiredPermission = FulfilGoPermission.ManageDrivers;

  constructor(
    private readonly uow: UnitOfWork,
    private readonly registry: AggregateRegistryImpl,
    private readonly drivers: DriverUserRepository,
    private readonly stores: StoreRepository,
  ) {}

  async execute(command: ReassignDriverCommand): Promise<Result<DriverReassigned>> {
    const loaded = await authorizeAndLoad(this.drivers, command);
    if (!loaded.ok) return loaded.failure;
    const { driver: prior, scope } = loaded;

    if (prior.storeRef === command.storeRef) {
      return Result.failure(
        UseCaseError.businessRule(
          'DRIVER_ALREADY_AT_DEPOT',
          `Driver is already at '${command.storeRef}'.`,
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
    const clash = await this.drivers.findByStaffCode(
      command.clientId,
      command.storeRef,
      prior.staffCode,
    );
    if (clash) {
      return Result.failure(
        UseCaseError.businessRule(
          'STAFF_CODE_EXISTS',
          `Staff code '${prior.staffCode}' already exists at '${command.storeRef}'.`,
          { driverId: clash.id },
        ),
      );
    }

    const driver = DriverUser.reassign(prior, command.storeRef, new Date());
    const event = new DriverReassigned(scope, {
      ...lifecycleData(driver),
      previousStoreRef: prior.storeRef,
    });
    return commitAggregate(this.uow, this.registry, driver, event, command);
  }
}

export class DeleteDriverUseCase {
  static readonly requiredPermission = FulfilGoPermission.ManageDrivers;

  constructor(
    private readonly uow: UnitOfWork,
    private readonly registry: AggregateRegistryImpl,
    private readonly drivers: DriverUserRepository,
  ) {}

  async execute(command: DriverRefCommand): Promise<Result<DriverDeleted>> {
    const loaded = await authorizeAndLoad(this.drivers, command);
    if (!loaded.ok) return loaded.failure;
    // Hard delete: historical attributions keep the drv_… id as a string.
    const event = new DriverDeleted(loaded.scope, lifecycleData(loaded.driver));
    return commitDelete(this.uow, this.registry, loaded.driver, event, command);
  }
}
