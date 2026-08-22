import { z } from 'zod';

/**
 * Validate (geocode) a PENDING master location. Resolves lat/lon via
 * the configured geocoder and transitions PENDING → GEOCODED. Despite
 * the name, this is the geocoding step — `confirm-master-location`
 * does the canonical-validation cascade.
 */
export const ValidateMasterLocationCommandSchema = z.object({
  masterLocationId: z.string().trim().min(1),
});
export type ValidateMasterLocationCommand = z.infer<typeof ValidateMasterLocationCommandSchema>;

/**
 * Confirm a GEOCODED master location as canonical. Transitions
 * * → VALIDATED, runs a spatial-feature lookup at the master's coords,
 * writes per-child location_feature_associations rows, and emits
 * LocationValidated for every non-validated child location.
 */
export const ConfirmMasterLocationCommandSchema = z.object({
  masterLocationId: z.string().trim().min(1),
  clientId: z.string().trim().min(1),
});
export type ConfirmMasterLocationCommand = z.infer<typeof ConfirmMasterLocationCommandSchema>;

/**
 * Manually edit a master location's normalized components. Used by the
 * BFF "edit master" form when a human spotted a libpostal misparse.
 * Recomputes `addressHash` + `normalizedAddressLine` from the new
 * components so future matches dedupe correctly.
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
 * Delete a master location. This is a CASCADE: it first deletes every child
 * location linked to this master (each cascading its own association rows), then
 * the master location itself (and its processing-log rows via DB FK).
 */
export const DeleteMasterLocationCommandSchema = z.object({
  masterLocationId: z.string().trim().min(1),
  clientId: z.string().trim().min(1),
});
export type DeleteMasterLocationCommand = z.infer<typeof DeleteMasterLocationCommandSchema>;

export const MatchMasterLocationFeaturesCommandSchema = z.object({
  clientId: z.string().trim().min(1),
  masterLocationId: z.string().trim().min(1),
});
export type MatchMasterLocationFeaturesCommand = z.infer<
  typeof MatchMasterLocationFeaturesCommandSchema
>;

export const ConfirmMasterLocationGeocodeCommandSchema = z.object({
  clientId: z.string().trim().min(1),
  masterLocationId: z.string().trim().min(1),
  houseNumber: z.string().trim().optional().nullable(),
  road: z.string().trim().optional().nullable(),
  suburb: z.string().trim().optional().nullable(),
  city: z.string().trim().min(1),
  state: z.string().trim().optional().nullable(),
  postalCode: z.string().trim().optional().nullable(),
  country: z.string().trim().min(1),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});
export type ConfirmMasterLocationGeocodeCommand = z.infer<
  typeof ConfirmMasterLocationGeocodeCommandSchema
>;
