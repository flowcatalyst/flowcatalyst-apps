import {
  createAggregateHandler,
  type AggregateRegistryImpl,
} from '@flowcatalyst-apps/app-framework';
import { PROPERTY_SET_TYPE, type PropertySet } from '../domain/layers/property-set.js';
import type { PropertySetRepository } from '../domain/layers/property-set.repository.js';

export function registerPropertySet(
  registry: AggregateRegistryImpl,
  repository: PropertySetRepository,
): void {
  registry.register(createAggregateHandler<PropertySet>(PROPERTY_SET_TYPE, repository));
}
