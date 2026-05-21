import { BaseDomainEvent, DomainEvent } from '@pinpoint/framework';
import type { Scope } from '@pinpoint/framework';

export interface MasterLocationGeocodedData {
  readonly masterLocationId: string;
  readonly clientId: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly confidence: number;
  readonly formattedAddress: string | null;
}

/**
 * Emitted by `validate-master-location` (which is the geocoding step,
 * despite the name). PENDING → GEOCODED.
 */
export class MasterLocationGeocoded extends BaseDomainEvent<MasterLocationGeocodedData> {
  constructor(scope: Scope, data: MasterLocationGeocodedData) {
    super(
      {
        eventType: DomainEvent.eventType('pinpoint', 'locations', 'master_location', 'geocoded'),
        specVersion: '1.0',
        source: 'pinpoint:locations',
        subject: DomainEvent.subject('locations', 'master_location', data.masterLocationId),
        messageGroup: DomainEvent.messageGroup('locations', 'master_location', data.masterLocationId),
      },
      scope as never,
      data,
    );
  }
}
