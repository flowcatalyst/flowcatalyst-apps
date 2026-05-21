import {
  createAggregateHandler,
  type AggregateRegistryImpl,
} from '@flowcatalyst-apps/app-framework';
import { MASTER_LOCATION_TYPE, type MasterLocation } from '../domain/locations/master-location.js';
import type { MasterLocationRepository } from '../domain/locations/master-location.repository.js';

export function registerMasterLocation(
  registry: AggregateRegistryImpl,
  repository: MasterLocationRepository,
): void {
  registry.register(createAggregateHandler<MasterLocation>(MASTER_LOCATION_TYPE, repository));
}
