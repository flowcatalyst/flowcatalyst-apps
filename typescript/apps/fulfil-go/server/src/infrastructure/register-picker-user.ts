import {
  createAggregateHandler,
  type AggregateRegistryImpl,
} from '@flowcatalyst-apps/app-framework';
import { PICKER_USER_TYPE, type PickerUser } from '../domain/pick-identity/picker-user.js';
import type { PickerUserRepository } from '../domain/pick-identity/picker-user.repository.js';

/**
 * Wire the PickerUser aggregate into the shared AggregateRegistry so
 * `commitAggregate(pickerUser, ...)` resolves to this repository at persist
 * time.
 */
export function registerPickerUser(
  registry: AggregateRegistryImpl,
  repository: PickerUserRepository,
): void {
  registry.register(createAggregateHandler<PickerUser>(PICKER_USER_TYPE, repository));
}
