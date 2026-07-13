/**
 * Event type definitions fulfil-go publishes to the FlowCatalyst platform.
 *
 * Each event file in `domain/<subdomain>/events/` exports an `XEventType`
 * const with `{ code, name, description, payloadSchema }`. Collected here so
 * `pnpm flowcatalyst:sync` has one place to register event types AND push
 * their payload JSON schemas.
 *
 * The throwaway `jobs` demo vertical's events are deliberately NOT
 * registered — only real domain events go to the platform.
 *
 * Adding a new event:
 *   1. Define the schema + class + EventType in the .event.ts file.
 *   2. Add the EventType import to the list below.
 *   3. Run `pnpm flowcatalyst:sync` against the platform.
 */
import type { TSchema } from '@sinclair/typebox';
import type { sync } from '@flowcatalyst/sdk';

import { FulfilmentCreatedEventType } from '../domain/fulfilments/events/fulfilment-created.event.js';
import { FulfilmentCancelledEventType } from '../domain/fulfilments/events/fulfilment-cancelled.event.js';
import { FulfilmentEpodProvisionRequestedEventType } from '../domain/fulfilments/events/fulfilment-epod-provision-requested.event.js';
import { FulfilmentPartPickRequestedEventType } from '../domain/fulfilments/events/fulfilment-part-pick-requested.event.js';
import {
  FulfilmentFailedEventType,
  FulfilmentPartFailedEventType,
  FulfilmentPartPickedEventType,
  FulfilmentPartPickingEventType,
  FulfilmentPickedEventType,
} from '../domain/fulfilments/events/fulfilment-pick-progress.events.js';
import { PickCreatedEventType } from '../domain/picks/events/pick-created.event.js';
import { PickClaimedEventType } from '../domain/picks/events/pick-claimed.event.js';
import {
  PickFailedEventType,
  PickPickedEventType,
  PickShortPickedEventType,
} from '../domain/picks/events/pick-outcome.events.js';

export interface FulfilGoEventType extends sync.EventTypeDefinition {
  readonly payloadSchema: TSchema;
}

export const fulfilGoEventTypes: readonly FulfilGoEventType[] = [
  // Fulfilment context
  FulfilmentCreatedEventType,
  FulfilmentCancelledEventType,
  FulfilmentPartPickRequestedEventType,
  FulfilmentPartPickingEventType,
  FulfilmentPartPickedEventType,
  FulfilmentPartFailedEventType,
  FulfilmentPickedEventType,
  FulfilmentFailedEventType,
  FulfilmentEpodProvisionRequestedEventType,
  // Pick context (the fulfilment process manager subscribes to these)
  PickCreatedEventType,
  PickClaimedEventType,
  PickPickedEventType,
  PickShortPickedEventType,
  PickFailedEventType,
];
