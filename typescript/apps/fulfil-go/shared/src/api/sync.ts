import { type Static, Type } from '@sinclair/typebox';
import { JobDtoSchema } from './job.dto.js';
import { PickDtoSchema } from './pick.dto.js';

/**
 * SSE event types. Job events push on a principal's `user:` channel; pick
 * events push on the store's `store:` channel (every station/picker at the
 * store shares one stream). The SSE `event:` field carries one of these;
 * `data:` carries the matching payload; `id:` carries the monotonic
 * sync-event id used for Last-Event-ID replay.
 */
export const SyncEventType = {
  JobCreated: 'job.created',
  JobAssigned: 'job.assigned',
  JobAccepted: 'job.accepted',
  JobCompleted: 'job.completed',
  PickCreated: 'pick.created',
  PickClaimed: 'pick.claimed',
  /** Completed = picked OR short_picked; the payload's status distinguishes. */
  PickCompleted: 'pick.completed',
  PickFailed: 'pick.failed',
} as const;
export type SyncEventType = (typeof SyncEventType)[keyof typeof SyncEventType];

export const SyncEventPayloadSchema = Type.Object(
  {
    job: JobDtoSchema,
  },
  { $id: 'SyncEventPayload' },
);
export type SyncEventPayload = Static<typeof SyncEventPayloadSchema>;

/**
 * Delta-sync catch-up response. Clients hydrate their local state from
 * `jobs`, then attach SSE with `Last-Event-ID: latestEventId` — closing the
 * gap between snapshot and stream.
 *
 * `latestEventId` is a stringified bigint (sync_events.id is bigserial).
 */
export const DeltaSyncResponseSchema = Type.Object(
  {
    latestEventId: Type.String(),
    jobs: Type.Array(JobDtoSchema),
  },
  { $id: 'DeltaSyncResponse' },
);
export type DeltaSyncResponse = Static<typeof DeltaSyncResponseSchema>;

/** `data:` payload of pick.* SSE events. */
export const PickSyncEventPayloadSchema = Type.Object(
  {
    pick: PickDtoSchema,
  },
  { $id: 'PickSyncEventPayload' },
);
export type PickSyncEventPayload = Static<typeof PickSyncEventPayloadSchema>;

/**
 * Snapshot-then-stream for the picking station: hydrate from `picks`, then
 * attach SSE with `Last-Event-ID: latestEventId` (the STORE channel's high
 * water) — closing the snapshot→stream gap race.
 */
export const PickDeltaSyncResponseSchema = Type.Object(
  {
    latestEventId: Type.String(),
    picks: Type.Array(PickDtoSchema),
  },
  { $id: 'PickDeltaSyncResponse' },
);
export type PickDeltaSyncResponse = Static<typeof PickDeltaSyncResponseSchema>;
