import { z } from 'zod';

/**
 * Manually edit a master location's normalized components (the BFF "edit
 * master" form). Recomputes `addressHash` + `normalizedAddressLine` from the
 * new components so future matches dedupe correctly. Status is unchanged.
 *
 * `city` + `country` are required (matcher invariants); the rest are
 * optional+nullable to match the underlying type.
 */
export const UpdateMasterLocationCommandSchema = z.object({
  masterLocationId: z.string().trim().min(1),
  clientId: z.string().trim().min(1),
  normalizedHouseNumber: z.string().trim().optional().nullable(),
  normalizedRoad: z.string().trim().optional().nullable(),
  normalizedSuburb: z.string().trim().optional().nullable(),
  normalizedCity: z.string().trim().min(1),
  normalizedState: z.string().trim().optional().nullable(),
  normalizedPostalCode: z.string().trim().optional().nullable(),
  normalizedCountry: z.string().trim().min(1),
});
export type UpdateMasterLocationCommand = z.infer<typeof UpdateMasterLocationCommandSchema>;

/**
 * Reject a master location. Marks it REJECTED so the matching pipeline
 * filters it out of candidate lookups. Optional reason captured for
 * the audit trail.
 */
export const RejectMasterLocationCommandSchema = z.object({
  masterLocationId: z.string().trim().min(1),
  clientId: z.string().trim().min(1),
  reason: z.string().trim().optional().nullable(),
});
export type RejectMasterLocationCommand = z.infer<typeof RejectMasterLocationCommandSchema>;

/**
 * Delete a master location (and its processing trail). Locations that copied
 * its data keep their copy — they only referenced it.
 */
export const DeleteMasterLocationCommandSchema = z.object({
  masterLocationId: z.string().trim().min(1),
  clientId: z.string().trim().min(1),
});
export type DeleteMasterLocationCommand = z.infer<typeof DeleteMasterLocationCommandSchema>;

/**
 * Capture the address of a DRAFT master location properly (it came from a
 * delivery capture, with only a reverse-geocoded address): DRAFT → VALIDATED,
 * usable for matching. Same component fields as the update.
 */
export const CompleteMasterLocationCommandSchema = UpdateMasterLocationCommandSchema.extend({
  name: z.string().trim().optional().nullable(),
});
export type CompleteMasterLocationCommand = z.infer<typeof CompleteMasterLocationCommandSchema>;
