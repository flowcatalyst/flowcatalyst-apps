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
export type ValidateMasterLocationCommand = z.infer<
  typeof ValidateMasterLocationCommandSchema
>;

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
export type ConfirmMasterLocationCommand = z.infer<
  typeof ConfirmMasterLocationCommandSchema
>;
