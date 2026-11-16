import { z } from 'zod';

/**
 * Commands for a location's own geocode + approval lifecycle
 * (PENDING → GEOCODED → VALIDATED | REJECTED), and for delivery captures.
 */

const locationRef = {
  clientId: z.string().trim().min(1),
  locationId: z.string().trim().min(1),
};

/** Geocode a PENDING location (Photon, falling back to Google Maps). */
export const GeocodeLocationCommandSchema = z.object(locationRef);
export type GeocodeLocationCommand = z.infer<typeof GeocodeLocationCommandSchema>;

/** Renew (or, past expiry, delete) a location's cached third-party geocode. */
export const RefreshLocationGeocodeCommandSchema = z.object({
  locationId: z.string().trim().min(1),
});
export type RefreshLocationGeocodeCommand = z.infer<typeof RefreshLocationGeocodeCommandSchema>;

/**
 * Approve a GEOCODED location: features at its point, VALIDATED. When its
 * coordinates are our own (Photon / operator) it also becomes a master location.
 */
export const ApproveLocationCommandSchema = z.object(locationRef);
export type ApproveLocationCommand = z.infer<typeof ApproveLocationCommandSchema>;

/** An operator supplies a location's coordinates + components (source OPERATOR). */
export const ConfirmLocationGeocodeCommandSchema = z.object({
  ...locationRef,
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
export type ConfirmLocationGeocodeCommand = z.infer<typeof ConfirmLocationGeocodeCommandSchema>;

export const RejectLocationCommandSchema = z.object({
  ...locationRef,
  reason: z.string().trim().optional().nullable(),
});
export type RejectLocationCommand = z.infer<typeof RejectLocationCommandSchema>;

/** Re-run the spatial feature lookup at a location's point. */
export const MatchLocationFeaturesCommandSchema = z.object(locationRef);
export type MatchLocationFeaturesCommand = z.infer<typeof MatchLocationFeaturesCommandSchema>;

/** Dismiss a delivery-capture disagreement after looking at it. */
export const ClearLocationCaptureReviewCommandSchema = z.object(locationRef);
export type ClearLocationCaptureReviewCommand = z.infer<
  typeof ClearLocationCaptureReviewCommandSchema
>;

/**
 * A delivery vehicle captured the coordinates of an address. Creates a DRAFT
 * master location (address reverse-geocoded by Photon, to be captured
 * properly). With `address`, the client's location for it is looked up and
 * flagged when the capture disagrees with its coordinates.
 */
export const CaptureLocationCoordinatesCommandSchema = z.object({
  clientId: z.string().trim().min(1),
  partitionId: z.string().trim().min(1).optional().nullable(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  /** GPS accuracy (metres). */
  accuracyMeters: z.number().min(0).optional().nullable(),
  /** ISO timestamp of the capture; defaults to now. */
  capturedAt: z.string().datetime({ offset: true }).optional().nullable(),
  /** The address the driver delivered to (free text). */
  address: z.string().trim().min(1).optional().nullable(),
  /** Caller's reference (e.g. delivery / trip id), kept on the trail. */
  reference: z.string().trim().max(200).optional().nullable(),
});
export type CaptureLocationCoordinatesCommand = z.infer<
  typeof CaptureLocationCoordinatesCommandSchema
>;
