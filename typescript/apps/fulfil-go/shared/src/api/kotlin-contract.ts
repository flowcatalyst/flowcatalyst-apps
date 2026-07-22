import type { TSchema } from '@sinclair/typebox';
import {
  AuthorizeUrlResponseSchema,
  DriverMeResponseSchema,
  MobileTokenResponseSchema,
  PickerTokenResponseSchema,
} from './auth.js';
import {
  MyTripSchema,
  MyTripStopSchema,
  MyTripsResponseSchema,
  OfferStopSchema,
  OffersResponseSchema,
  PodPhotoUploadSchema,
  StopParcelSchema,
  StopVerificationSchema,
  TransportAddressSchema,
  TransportDestinationSchema,
  TransportGeoPointSchema,
  TransportOfferSchema,
  TripAgeCheckSchema,
  TripReportBodySchema,
  TripReportResponseSchema,
  VerificationRequirementsSchema,
  VerifyPinResponseSchema,
} from './transport.dto.js';

/**
 * The schemas the native execution app consumes, keyed by their KOTLIN
 * class name (`pnpm gen:kotlin` emits Generated.kt from this registry).
 * Nested schemas resolve by object identity — list a schema here to give
 * it a stable name; unlisted nested objects get synthesized names.
 */
export const KOTLIN_CONTRACT: Readonly<Record<string, TSchema>> = {
  // auth
  PickerTokenResponse: PickerTokenResponseSchema,
  MobileTokenResponse: MobileTokenResponseSchema,
  AuthorizeUrlResponse: AuthorizeUrlResponseSchema,
  DriverMe: DriverMeResponseSchema,
  // transport
  Geo: TransportGeoPointSchema,
  Address: TransportAddressSchema,
  Destination: TransportDestinationSchema,
  OfferStop: OfferStopSchema,
  Offer: TransportOfferSchema,
  OffersResponse: OffersResponseSchema,
  StopParcel: StopParcelSchema,
  VerificationRequirements: VerificationRequirementsSchema,
  StopVerification: StopVerificationSchema,
  MyTripStop: MyTripStopSchema,
  MyTrip: MyTripSchema,
  TripsResponse: MyTripsResponseSchema,
  AgeCheck: TripAgeCheckSchema,
  ReportBody: TripReportBodySchema,
  TripReportResponse: TripReportResponseSchema,
  VerifyPinResponse: VerifyPinResponseSchema,
  BlobUpload: PodPhotoUploadSchema,
};

/**
 * Per-field Kotlin type overrides where JSON Schema is too loose —
 * `Type.Number()` maps to Double, but epoch-ms fields must be Long.
 */
export const KOTLIN_TYPE_OVERRIDES: Readonly<Record<string, string>> = {
  'MobileTokenResponse.expiresAt': 'Long',
};
