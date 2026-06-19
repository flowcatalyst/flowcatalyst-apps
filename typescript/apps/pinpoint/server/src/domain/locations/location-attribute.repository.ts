import type { TransactionContext } from '@flowcatalyst-apps/app-framework';
import type { LocationId } from './ids.js';
import type { LocationAttribute } from './location-attribute.js';

export interface LocationAttributeRepository {
  insertMany(attributes: readonly LocationAttribute[], tx?: TransactionContext): Promise<void>;
  listByLocation(locationId: LocationId): Promise<readonly LocationAttribute[]>;
}
