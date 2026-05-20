/**
 * Event type definitions Pinpoint publishes to the FlowCatalyst platform.
 *
 * Populated as use-case slices land. Each event type follows the
 * `pinpoint:<subdomain>:<aggregate>:<action>` lowercase past-tense shape.
 *
 * Sync'd to the platform via `pnpm flowcatalyst:sync`.
 */
import type { sync } from '@flowcatalyst/sdk';

export const pinpointEventTypes: readonly sync.EventTypeDefinition[] = [
  {
    code: 'pinpoint:tenancy:client:created',
    name: 'Client Created',
    description: 'A pinpoint tenancy client was created.',
  },
  {
    code: 'pinpoint:tenancy:partition:created',
    name: 'Partition Created',
    description: 'A partition was created under a tenancy client.',
  },
  {
    code: 'pinpoint:locations:location:created',
    name: 'Location Created',
    description: 'A raw-address location was captured (pending matching).',
  },
  {
    code: 'pinpoint:matching:config:updated',
    name: 'Matching Config Updated',
    description: 'A scoped matching config (client / partition) had its thresholds updated.',
  },
];
