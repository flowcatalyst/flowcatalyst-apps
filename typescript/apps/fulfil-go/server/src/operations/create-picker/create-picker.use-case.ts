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
import { PickerUser } from '../../domain/pick-identity/picker-user.js';
import { newPickerUserId } from '../../domain/pick-identity/ids.js';
import { PickerCreated } from '../../domain/pick-identity/events/picker-created.event.js';
import type { PickerUserRepository } from '../../domain/pick-identity/picker-user.repository.js';
import { hashSecret } from '../../auth/pick-credentials.js';
import type { CreatePickerCommand } from './create-picker.command.js';

/**
 * Provision a picker. Admin-authed (ManagePickers). Slice scope: PIN-primary
 * only — QR-primary + break-glass arrive in a later phase. Staff-code
 * uniqueness within a store is checked here and backstopped by the DB unique
 * index against races.
 */
export class CreatePickerUseCase {
  static readonly requiredPermission = FulfilGoPermission.ManagePickers;

  constructor(
    private readonly uow: UnitOfWork,
    private readonly registry: AggregateRegistryImpl,
    private readonly pickers: PickerUserRepository,
  ) {}

  async execute(command: CreatePickerCommand): Promise<Result<PickerCreated>> {
    const scope = ScopeStore.require();

    if (!this.authorize(scope)) {
      return Result.failure(
        UseCaseError.authorization(
          'PERMISSION_DENIED',
          `Missing permission ${FulfilGoPermission.ManagePickers}.`,
        ),
      );
    }

    if (command.primaryAuthMethod === 'qr') {
      return Result.failure(
        UseCaseError.validation(
          'QR_AUTH_NOT_IMPLEMENTED',
          'QR-primary pickers are not implemented yet; use primaryAuthMethod "pin".',
        ),
      );
    }
    if (!command.pin) {
      return Result.failure(
        UseCaseError.validation('PIN_REQUIRED', 'A PIN is required for a pin-primary picker.'),
      );
    }

    const displayName = command.displayName.trim();
    const staffCode = command.staffCode.trim();
    if (displayName.length === 0) {
      return Result.failure(
        UseCaseError.validation('DISPLAY_NAME_REQUIRED', 'displayName must not be empty.'),
      );
    }

    const existing = await this.pickers.findByStaffCode(
      command.clientId,
      command.storeRef,
      staffCode,
    );
    if (existing) {
      return Result.failure(
        UseCaseError.businessRule(
          'STAFF_CODE_EXISTS',
          `Staff code '${staffCode}' already exists for store '${command.storeRef}'.`,
          { pickerId: existing.id },
        ),
      );
    }

    const pinHash = await hashSecret(command.pin);
    const id = newPickerUserId();
    const picker = PickerUser.create({
      id,
      clientId: command.clientId,
      storeRef: command.storeRef,
      displayName,
      staffCode,
      primaryAuthMethod: 'pin',
      pinHash,
      now: new Date(),
    });

    const event = new PickerCreated(scope, {
      pickerId: id,
      clientId: command.clientId,
      storeRef: command.storeRef,
      staffCode,
      primaryAuthMethod: 'pin',
    });

    return commitAggregate(this.uow, this.registry, picker, event, command);
  }

  private authorize(scope: Scope): boolean {
    return scope.permissions.has(CreatePickerUseCase.requiredPermission);
  }
}
