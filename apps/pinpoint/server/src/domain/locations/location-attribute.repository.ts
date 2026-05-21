import type { TransactionContext } from '@flowcatalyst-apps/app-framework';
import type { LocationId } from './ids.js';
import type { LocationAttribute } from './location-attribute.js';

export interface LocationAttributeRepository {
  /**
   * Insert attributes for a freshly-created location. Caller assumes the
   * location row already exists; this just writes the child rows.
   * Conflicts on `(location_id, key)` are surfaced — the caller (the
   * create-location use case) prevents duplicates by validating the
   * incoming list before calling.
   */
  insertMany(
    attributes: readonly LocationAttribute[],
    tx?: TransactionContext,
  ): Promise<void>;

  listByLocation(locationId: LocationId): Promise<readonly LocationAttribute[]>;
}
