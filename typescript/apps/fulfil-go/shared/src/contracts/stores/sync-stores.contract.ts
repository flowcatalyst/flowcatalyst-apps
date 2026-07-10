import { z } from 'zod';

/**
 * A store record as synced into the registry. `ref` + `name` are the
 * searchable identity; everything else (address, geo, contact, collection
 * point, …) rides along as captured reference data — the registry doesn't
 * interpret it, pickers/devices just bind to `ref`.
 */
export const StoreRecordSchema = z
  .object({
    ref: z.string().min(1).max(64),
    name: z.string().min(1).max(200),
    city: z.string().max(100).optional(),
    region: z.string().max(100).optional(),
  })
  .passthrough();
export type StoreRecord = z.infer<typeof StoreRecordSchema>;

/**
 * Bulk upsert of the store registry (idempotent — keyed on (clientId, ref)).
 * The management app syncs its generator fixtures through this; a real
 * integration would sync from master data. `clientId` injected from the path.
 */
export const SyncStoresCommandSchema = z.object({
  clientId: z.string().min(1).max(64),
  stores: z.array(StoreRecordSchema).min(1).max(500),
});
export type SyncStoresCommand = z.infer<typeof SyncStoresCommandSchema>;
