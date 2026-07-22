import { type Static, Type } from '@sinclair/typebox';

/**
 * The driver-app transport contract — the SINGLE SOURCE OF TRUTH for what
 * the execution app receives/sends. The server routes reference these as
 * their request/response schemas (Fastify enforces + serializes by them)
 * and the Kotlin DTOs are GENERATED from them (`pnpm gen:kotlin` here in
 * shared) — change a schema, regenerate, or the native app drifts.
 *
 * NO $id on any of these: they nest repeatedly inside a single route
 * schema (destination appears once per stop) and ajv rejects duplicate
 * inline ids within one route (same gotcha as the telemetry batch union).
 *
 * Destination/address fields are deliberately ALL OPTIONAL even where the
 * domain requires them: captured locations from older rows may miss fields
 * and a response serializer must never 500 a driver mid-route.
 */

// "Transport" prefix: the domain barrel already exports a Zod GeoPointSchema.
export const TransportGeoPointSchema = Type.Object({
  lat: Type.Number(),
  lng: Type.Number(),
});
export type TransportGeoPoint = Static<typeof TransportGeoPointSchema>;

export const TransportAddressSchema = Type.Object({
  line1: Type.Optional(Type.String()),
  line2: Type.Optional(Type.String()),
  suburb: Type.Optional(Type.String()),
  city: Type.Optional(Type.String()),
  region: Type.Optional(Type.String()),
  postalCode: Type.Optional(Type.String()),
  countryCode: Type.Optional(Type.String()),
});
export type TransportAddress = Static<typeof TransportAddressSchema>;

/** The captured stop location (TransportStop VO, defensively optional). */
export const TransportDestinationSchema = Type.Object({
  name: Type.Optional(Type.String()),
  address: Type.Optional(TransportAddressSchema),
  geo: Type.Optional(TransportGeoPointSchema),
  phone: Type.Optional(Type.String()),
  instructions: Type.Optional(Type.String()),
});
export type TransportDestination = Static<typeof TransportDestinationSchema>;

// ── Offers (claim marketplace) ──

export const OfferStopSchema = Type.Object({
  orderId: Type.String(),
  shortId: Type.String(),
  destination: TransportDestinationSchema,
  legKm: Type.Union([Type.Number(), Type.Null()]),
  legMinutes: Type.Union([Type.Number(), Type.Null()]),
});
export type OfferStopDto = Static<typeof OfferStopSchema>;

export const TransportOfferSchema = Type.Object({
  groupId: Type.String(),
  depotNames: Type.Array(Type.String()),
  partReferences: Type.Array(Type.String()),
  transportOrderRefs: Type.Array(Type.String()),
  expiresAt: Type.String(),
  originRef: Type.String(),
  stops: Type.Array(OfferStopSchema),
  routeKm: Type.Union([Type.Number(), Type.Null()]),
  routeMinutes: Type.Union([Type.Number(), Type.Null()]),
});
export type TransportOfferDto = Static<typeof TransportOfferSchema>;

export const OffersResponseSchema = Type.Object({
  offers: Type.Array(TransportOfferSchema),
  /** Why the offer list is empty (anchor unavailable, no work, …). */
  reason: Type.Optional(Type.String()),
});
export type OffersResponse = Static<typeof OffersResponseSchema>;

// ── My trips (the Work tab's persistent state) ──

export const StopParcelSchema = Type.Object({
  ref: Type.String(),
  /** bag | loose */
  kind: Type.String(),
  size: Type.Union([Type.String(), Type.Null()]),
  temperature: Type.String(),
});
export type StopParcelDto = Static<typeof StopParcelSchema>;

/**
 * Handover REQUIREMENTS (never pin values — the server verifies). All
 * optional: pre-feature rows lack newer fields; clients default safely.
 */
export const VerificationRequirementsSchema = Type.Object({
  pickupPin: Type.Optional(Type.Boolean()),
  deliveryPin: Type.Optional(Type.Boolean()),
  /** none | pin | picture | signature */
  deliveryProof: Type.Optional(Type.String()),
  minAge: Type.Optional(Type.Union([Type.Integer(), Type.Null()])),
  ageVisualOverrideAllowed: Type.Optional(Type.Boolean()),
  ageIdPhotoRequired: Type.Optional(Type.Boolean()),
});
export type VerificationRequirementsDto = Static<typeof VerificationRequirementsSchema>;

export const StopVerificationSchema = Type.Object({
  requirements: VerificationRequirementsSchema,
  collectionMethod: Type.Union([Type.String(), Type.Null()]),
  deliveryPinOutcome: Type.Union([Type.String(), Type.Null()]),
});
export type StopVerificationDto = Static<typeof StopVerificationSchema>;

export const MyTripStopSchema = Type.Object({
  orderId: Type.String(),
  shortId: Type.String(),
  destination: TransportDestinationSchema,
  legKm: Type.Union([Type.Number(), Type.Null()]),
  legMinutes: Type.Union([Type.Number(), Type.Null()]),
  /** requested | booked | assigned | collected | delivered | failed | cancelled */
  status: Type.String(),
  parcels: Type.Array(StopParcelSchema),
  verification: Type.Union([StopVerificationSchema, Type.Null()]),
});
export type MyTripStopDto = Static<typeof MyTripStopSchema>;

export const MyTripSchema = Type.Object({
  tripId: Type.String(),
  originRef: Type.String(),
  claimedAt: Type.String(),
  routeKm: Type.Union([Type.Number(), Type.Null()]),
  routeMinutes: Type.Union([Type.Number(), Type.Null()]),
  stops: Type.Array(MyTripStopSchema),
});
export type MyTripDto = Static<typeof MyTripSchema>;

export const MyTripsResponseSchema = Type.Object({
  trips: Type.Array(MyTripSchema),
});
export type MyTripsResponse = Static<typeof MyTripsResponseSchema>;

// ── Driver progress reports (handover evidence, offline-first) ──

export const TripAgeCheckSchema = Type.Object(
  {
    /** id-attestation | visual-override */
    method: Type.Union([Type.Literal('id-attestation'), Type.Literal('visual-override')]),
    docType: Type.Optional(Type.String({ maxLength: 40 })),
    /** Government-ID photo (blob ref) when the policy requires it. */
    idPhotoRef: Type.Optional(Type.String({ maxLength: 64 })),
  },
  { additionalProperties: false },
);
export type TripAgeCheck = Static<typeof TripAgeCheckSchema>;

export const TripReportBodySchema = Type.Object(
  {
    reason: Type.Optional(Type.String({ maxLength: 300 })),
    /** Collection confirm method: 'scan' | 'pin' (absent = bulk). */
    method: Type.Optional(Type.Union([Type.Literal('scan'), Type.Literal('pin')])),
    scannedRefs: Type.Optional(Type.Array(Type.String({ maxLength: 64 }), { maxItems: 100 })),
    /** Entered pin (pickup override at collection; delivery pin at the door). */
    pinEntered: Type.Optional(Type.String({ maxLength: 8 })),
    /** Age-restricted delivery: how the age was checked. */
    ageCheck: Type.Optional(TripAgeCheckSchema),
    /** Proof-of-delivery photo (blob ref, client-generated pod_…). */
    photoRef: Type.Optional(Type.String({ maxLength: 64 })),
    /** Customer signature image (blob ref, client-generated sig_…). */
    signatureRef: Type.Optional(Type.String({ maxLength: 64 })),
    /** The driver's "I've arrived" tap (ISO) — arrival-to-handover timing. */
    arrivedAt: Type.Optional(Type.String({ maxLength: 40 })),
  },
  { additionalProperties: false },
);
export type TripReportBody = Static<typeof TripReportBodySchema>;

export const TripReportResponseSchema = Type.Object({
  updatedOrders: Type.Array(Type.String()),
  allCollected: Type.Boolean(),
  tripCompleted: Type.Boolean(),
  pinOutcome: Type.Optional(Type.String()),
  note: Type.Optional(Type.String()),
});
export type TripReportResponse = Static<typeof TripReportResponseSchema>;

// ── Interactive pin verification (verify BEFORE handover when online) ──

export const VerifyPinRequestSchema = Type.Object(
  {
    kind: Type.Union([Type.Literal('pickup'), Type.Literal('delivery')]),
    pin: Type.String({ minLength: 1, maxLength: 8 }),
  },
  { additionalProperties: false },
);
export type VerifyPinRequest = Static<typeof VerifyPinRequestSchema>;

export const VerifyPinResponseSchema = Type.Object({
  verified: Type.Boolean(),
});
export type VerifyPinResponse = Static<typeof VerifyPinResponseSchema>;

// ── Proof-of-delivery photo upload (client-generated refs) ──

export const PodPhotoUploadSchema = Type.Object(
  {
    /** JPEG/PNG, base64 (no data: prefix). App compresses ≤~350KB. */
    imageBase64: Type.String({ maxLength: 700_000 }),
    contentType: Type.Union([Type.Literal('image/jpeg'), Type.Literal('image/png')]),
  },
  { additionalProperties: false },
);
export type PodPhotoUpload = Static<typeof PodPhotoUploadSchema>;
