import {
  createAggregateHandler,
  type AggregateRegistryImpl,
} from '@flowcatalyst-apps/app-framework';
import { TRIP_TYPE, type Trip } from '../domain/trips/trip.js';
import type { TripRepository } from '../domain/trips/trip.repository.js';

/**
 * Wire the Trip aggregate into the shared AggregateRegistry so
 * `commitAggregate(trip, ...)` resolves to this repository at persist time.
 */
export function registerTrip(registry: AggregateRegistryImpl, repository: TripRepository): void {
  registry.register(createAggregateHandler<Trip>(TRIP_TYPE, repository));
}
