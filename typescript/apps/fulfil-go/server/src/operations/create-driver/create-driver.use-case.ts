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
import { DriverUser } from '../../domain/driver-identity/driver-user.js';
import { newDriverUserId } from '../../domain/driver-identity/ids.js';
import { DriverCreated } from '../../domain/driver-identity/events/driver.events.js';
import type { DriverUserRepository } from '../../domain/driver-identity/driver-user.repository.js';
import type { DepotRepository } from '../../infrastructure/depot-repository.js';
import { hashSecret } from '../../auth/pick-credentials.js';

export interface CreateDriverCommand {
  readonly clientId: string;
  /** Home depot — a depots registry ref. */
  readonly depotRef: string;
  readonly displayName: string;
  readonly staffCode: string;
  readonly pin: string;
  readonly defaultVehicleReg?: string | null;
  /** Vehicle class code (client-settings registry). */
  readonly defaultVehicleClass?: string | null;
}

/**
 * Provision a driver. Admin-authed (ManageDrivers). PIN-primary only — the
 * picker pattern (Andrew 2026-07-13); device pinning waits for the shared
 * device-enrollment phase. Staff-code uniqueness within a depot is checked
 * here and backstopped by the DB unique index against races.
 */
export class CreateDriverUseCase {
  static readonly requiredPermission = FulfilGoPermission.ManageDrivers;

  constructor(
    private readonly uow: UnitOfWork,
    private readonly registry: AggregateRegistryImpl,
    private readonly drivers: DriverUserRepository,
    private readonly depots: DepotRepository,
  ) {}

  async execute(command: CreateDriverCommand): Promise<Result<DriverCreated>> {
    const scope = ScopeStore.require();

    if (!this.authorize(scope)) {
      return Result.failure(
        UseCaseError.authorization(
          'PERMISSION_DENIED',
          `Missing permission ${FulfilGoPermission.ManageDrivers}.`,
        ),
      );
    }
    if (!command.pin) {
      return Result.failure(UseCaseError.validation('PIN_REQUIRED', 'A PIN is required.'));
    }

    const displayName = command.displayName.trim();
    const staffCode = command.staffCode.trim();
    if (displayName.length === 0) {
      return Result.failure(
        UseCaseError.validation('DISPLAY_NAME_REQUIRED', 'displayName must not be empty.'),
      );
    }

    // Drivers bind to a real registry depot.
    const depot = await this.depots.findByRef(command.clientId, command.depotRef);
    if (!depot) {
      return Result.failure(
        UseCaseError.validation(
          'DEPOT_NOT_FOUND',
          `Depot '${command.depotRef}' is not in the registry — create it first.`,
        ),
      );
    }

    const existing = await this.drivers.findByStaffCode(
      command.clientId,
      command.depotRef,
      staffCode,
    );
    if (existing) {
      return Result.failure(
        UseCaseError.businessRule(
          'STAFF_CODE_EXISTS',
          `Staff code '${staffCode}' already exists for depot '${command.depotRef}'.`,
          { driverId: existing.id },
        ),
      );
    }

    const pinHash = await hashSecret(command.pin);
    const id = newDriverUserId();
    const driver = DriverUser.create({
      id,
      clientId: command.clientId,
      depotRef: command.depotRef,
      displayName,
      staffCode,
      defaultVehicleReg: command.defaultVehicleReg?.trim() || null,
      defaultVehicleClass: command.defaultVehicleClass?.trim() || null,
      pinHash,
      now: new Date(),
    });

    const event = new DriverCreated(scope, {
      driverId: id,
      clientId: command.clientId,
      depotRef: command.depotRef,
      staffCode,
    });

    return commitAggregate(this.uow, this.registry, driver, event, command);
  }

  private authorize(scope: Scope): boolean {
    return scope.permissions.has(CreateDriverUseCase.requiredPermission);
  }
}
