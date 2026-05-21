import { BaseDomainEvent, DomainEvent } from '@pinpoint/framework';
import type { Scope } from '@pinpoint/framework';

export interface MasterLocationValidatedData {
  readonly masterLocationId: string;
  readonly clientId: string;
  readonly latitude: number;
  readonly longitude: number;
  /** Locations cascaded to VALIDATED by this confirmation. */
  readonly locationsValidated: number;
  /** Spatial feature matches found at this coordinate. */
  readonly featuresMatched: number;
}

/**
 * Emitted by `confirm-master-location`. * → VALIDATED. Triggers the
 * LocationValidated cascade for child locations.
 */
export class MasterLocationValidated extends BaseDomainEvent<MasterLocationValidatedData> {
  constructor(scope: Scope, data: MasterLocationValidatedData) {
    super(
      {
        eventType: DomainEvent.eventType('pinpoint', 'locations', 'master_location', 'validated'),
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
