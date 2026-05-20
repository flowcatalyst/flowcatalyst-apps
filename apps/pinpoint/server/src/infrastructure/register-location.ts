import {
  createAggregateHandler,
  type AggregateRegistryImpl,
} from '@flowcatalyst-apps/app-framework';
import { LOCATION_TYPE, type Location } from '../domain/locations/location.js';
import type { LocationRepository } from '../domain/locations/location.repository.js';

export function registerLocation(
  registry: AggregateRegistryImpl,
  repository: LocationRepository,
): void {
  registry.register(createAggregateHandler<Location>(LOCATION_TYPE, repository));
}
