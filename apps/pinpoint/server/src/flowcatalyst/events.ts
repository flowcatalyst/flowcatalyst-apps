/**
 * Event type definitions Pinpoint publishes to the FlowCatalyst platform.
 *
 * Populated as use-case slices land. Each event type follows the
 * `pinpoint:<subdomain>:<aggregate>:<action>` lowercase past-tense shape.
 *
 * Sync'd to the platform via `pnpm flowcatalyst:sync`.
 */
import type { sync } from '@flowcatalyst/sdk';

export const pinpointEventTypes: readonly sync.EventTypeDefinition[] = [];
