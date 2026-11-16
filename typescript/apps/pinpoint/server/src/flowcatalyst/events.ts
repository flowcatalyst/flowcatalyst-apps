/**
 * Event type definitions Pinpoint publishes to the FlowCatalyst platform.
 *
 * Each event file in `domain/<subdomain>/events/` exports an
 * `XEventType` const with `{ code, name, description, payloadSchema }`.
 * We collect them here so the `flowcatalyst:sync` script has one place
 * to register event types AND push their payload JSON schemas.
 *
 * Adding a new event:
 *   1. Define the schema + class + EventType in the .event.ts file.
 *   2. Add the EventType import to the list below.
 *   3. Run `pnpm flowcatalyst:sync` against the platform.
 */
import type { TSchema } from '@sinclair/typebox';
import type { sync } from '@flowcatalyst/sdk';

import { ClientCreatedEventType } from '../domain/tenancy/events/client-created.event.js';
import { ClientUpdatedEventType } from '../domain/tenancy/events/client-updated.event.js';
import { ClientDeletedEventType } from '../domain/tenancy/events/client-deleted.event.js';
import { PartitionCreatedEventType } from '../domain/tenancy/events/partition-created.event.js';
import { PartitionUpdatedEventType } from '../domain/tenancy/events/partition-updated.event.js';
import { PartitionDeletedEventType } from '../domain/tenancy/events/partition-deleted.event.js';

import { LayerCreatedEventType } from '../domain/layers/events/layer-created.event.js';
import { LayerUpdatedEventType } from '../domain/layers/events/layer-updated.event.js';
import { LayerDeletedEventType } from '../domain/layers/events/layer-deleted.event.js';
import { LayerFeatureCreatedEventType } from '../domain/layers/events/layer-feature-created.event.js';
import { LayerFeatureUpdatedEventType } from '../domain/layers/events/layer-feature-updated.event.js';
import { LayerFeatureDeletedEventType } from '../domain/layers/events/layer-feature-deleted.event.js';
import { PropertySetCreatedEventType } from '../domain/layers/events/property-set-created.event.js';
import { PropertySetUpdatedEventType } from '../domain/layers/events/property-set-updated.event.js';
import { PropertySetDeletedEventType } from '../domain/layers/events/property-set-deleted.event.js';
import { PropertySetPropertiesReplacedEventType } from '../domain/layers/events/property-set-properties-replaced.event.js';

import { LocationCreatedEventType } from '../domain/locations/events/location-created.event.js';
import { LocationValidatedEventType } from '../domain/locations/events/location-validated.event.js';
import { LocationDeletedEventType } from '../domain/locations/events/location-deleted.event.js';
import { LocationRematchedEventType } from '../domain/locations/events/location-rematched.event.js';
import { LocationGeocodedEventType } from '../domain/locations/events/location-geocoded.event.js';
import { LocationGeocodeRefreshedEventType } from '../domain/locations/events/location-geocode-refreshed.event.js';
import { LocationGeocodeExpiredEventType } from '../domain/locations/events/location-geocode-expired.event.js';
import { LocationGeocodeConfirmedEventType } from '../domain/locations/events/location-geocode-confirmed.event.js';
import { LocationRejectedEventType } from '../domain/locations/events/location-rejected.event.js';
import { LocationCaptureDisagreesEventType } from '../domain/locations/events/location-capture-disagrees.event.js';
import { LocationCaptureReviewClearedEventType } from '../domain/locations/events/location-capture-review-cleared.event.js';
import { MasterLocationCapturedEventType } from '../domain/locations/events/master-location-captured.event.js';
import { MasterLocationCompletedEventType } from '../domain/locations/events/master-location-completed.event.js';
import { MasterLocationCreatedEventType } from '../domain/locations/events/master-location-created.event.js';
import { MasterLocationUpdatedEventType } from '../domain/locations/events/master-location-updated.event.js';
import { MasterLocationRejectedEventType } from '../domain/locations/events/master-location-rejected.event.js';
import { MasterLocationDeletedEventType } from '../domain/locations/events/master-location-deleted.event.js';

import { MatchingConfigUpdatedEventType } from '../domain/matching/events/matching-config-updated.event.js';
import { LayerFeatureStatusChangedEventType } from '../domain/layers/events/layer-feature-status-changed.event.js';
import { LayerPartitionsSetEventType } from '../domain/layers/events/layer-partitions-set.event.js';
import { PartitionAccessGrantedEventType } from '../domain/tenancy/events/partition-access-granted.event.js';
import { PartitionAccessRevokedEventType } from '../domain/tenancy/events/partition-access-revoked.event.js';

/**
 * A pinpoint event type — the SDK's `EventTypeDefinition` shape plus a
 * `payloadSchema` carrying the TypeBox JSON Schema. The schema is
 * pushed to FlowCatalyst via `eventTypes.addSchemaVersion(...)` after
 * the main `definitions().sync(...)` call.
 */
export interface PinpointEventTypeDefinition extends sync.EventTypeDefinition {
  readonly payloadSchema: TSchema;
}

/**
 * All pinpoint event types. Order is preserved when listed in the
 * admin UI; keep subdomains grouped (tenancy, layers, locations, matching).
 */
export const pinpointEventTypes: readonly PinpointEventTypeDefinition[] = [
  ClientCreatedEventType,
  ClientUpdatedEventType,
  ClientDeletedEventType,
  PartitionCreatedEventType,
  PartitionUpdatedEventType,
  PartitionDeletedEventType,
  LayerCreatedEventType,
  LayerUpdatedEventType,
  LayerDeletedEventType,
  LayerFeatureCreatedEventType,
  LayerFeatureUpdatedEventType,
  LayerFeatureDeletedEventType,
  PropertySetCreatedEventType,
  PropertySetUpdatedEventType,
  PropertySetDeletedEventType,
  PropertySetPropertiesReplacedEventType,
  LocationCreatedEventType,
  LocationValidatedEventType,
  LocationDeletedEventType,
  LocationRematchedEventType,
  LocationGeocodedEventType,
  LocationGeocodeRefreshedEventType,
  LocationGeocodeExpiredEventType,
  LocationGeocodeConfirmedEventType,
  LocationRejectedEventType,
  LocationCaptureDisagreesEventType,
  LocationCaptureReviewClearedEventType,
  MasterLocationCapturedEventType,
  MasterLocationCompletedEventType,
  MasterLocationCreatedEventType,
  MasterLocationUpdatedEventType,
  MasterLocationRejectedEventType,
  MasterLocationDeletedEventType,
  MatchingConfigUpdatedEventType,
  // Operator actions that used to be direct repository writes (2026-08-22)
  PartitionAccessGrantedEventType,
  PartitionAccessRevokedEventType,
  LayerPartitionsSetEventType,
  LayerFeatureStatusChangedEventType,
];
