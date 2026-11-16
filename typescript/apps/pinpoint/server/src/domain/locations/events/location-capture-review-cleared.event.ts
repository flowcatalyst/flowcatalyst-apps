import { Type, type Static } from '@sinclair/typebox';
import { BaseDomainEvent, DomainEvent } from '@pinpoint/framework';
import type { Scope } from '@pinpoint/framework';

const NullableString = Type.Union([Type.String(), Type.Null()]);

export const LocationCaptureReviewClearedDataSchema = Type.Object({
  locationId: Type.String(),
  clientId: Type.String(),
  /** The DRAFT master of the capture that was reviewed. */
  masterLocationId: NullableString,
});

export type LocationCaptureReviewClearedData = Static<typeof LocationCaptureReviewClearedDataSchema>;

/**
 * An operator dismissed a delivery-capture disagreement on a location.
 */
export class LocationCaptureReviewCleared extends BaseDomainEvent<LocationCaptureReviewClearedData> {
  constructor(scope: Scope, data: LocationCaptureReviewClearedData) {
    super(
      {
        eventType: DomainEvent.eventType('pinpoint', 'locations', 'location', 'capture_review_cleared'),
        specVersion: '1.0',
        source: 'pinpoint:locations',
        subject: DomainEvent.subject('locations', 'location', data.locationId),
        messageGroup: DomainEvent.messageGroup('locations', 'location', data.locationId),
      },
      scope as never,
      data,
    );
  }
}

export const LocationCaptureReviewClearedEventType = {
  code: 'pinpoint:locations:location:capture_review_cleared',
  name: 'Location Capture Review Cleared',
  description: "An operator dismissed a delivery-capture disagreement on a location.",
  payloadSchema: LocationCaptureReviewClearedDataSchema,
} as const;
