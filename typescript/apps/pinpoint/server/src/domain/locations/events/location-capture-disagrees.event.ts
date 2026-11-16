import { Type, type Static } from '@sinclair/typebox';
import { BaseDomainEvent, DomainEvent } from '@pinpoint/framework';
import type { Scope } from '@pinpoint/framework';

export const LocationCaptureDisagreesDataSchema = Type.Object({
  locationId: Type.String(),
  clientId: Type.String(),
  /** The DRAFT master the delivery capture created. */
  masterLocationId: Type.String(),
  /** How far the capture landed from the location's coordinates. */
  distanceMeters: Type.Number(),
  capturedLatitude: Type.Number(),
  capturedLongitude: Type.Number(),
});

export type LocationCaptureDisagreesData = Static<typeof LocationCaptureDisagreesDataSchema>;

/**
 * A delivery capture for this location's address landed further from its coordinates than the
 * capture's accuracy allows. The location is flagged for review; its coordinates are unchanged.
 */
export class LocationCaptureDisagrees extends BaseDomainEvent<LocationCaptureDisagreesData> {
  constructor(scope: Scope, data: LocationCaptureDisagreesData) {
    super(
      {
        eventType: DomainEvent.eventType('pinpoint', 'locations', 'location', 'capture_disagrees'),
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

export const LocationCaptureDisagreesEventType = {
  code: 'pinpoint:locations:location:capture_disagrees',
  name: 'Location Capture Disagrees',
  description: "A delivery capture disagreed with the coordinates of a location.",
  payloadSchema: LocationCaptureDisagreesDataSchema,
} as const;
