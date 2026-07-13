import {
  createAggregateHandler,
  type AggregateRegistryImpl,
} from '@flowcatalyst-apps/app-framework';
import { DRIVER_USER_TYPE, type DriverUser } from '../domain/driver-identity/driver-user.js';
import type { DriverUserRepository } from '../domain/driver-identity/driver-user.repository.js';

/**
 * Wire the DriverUser aggregate into the shared AggregateRegistry so
 * `commitAggregate(driver, ...)` resolves to this repository at persist time.
 */
export function registerDriverUser(
  registry: AggregateRegistryImpl,
  repository: DriverUserRepository,
): void {
  registry.register(createAggregateHandler<DriverUser>(DRIVER_USER_TYPE, repository));
}
