import { type Static, Type } from '@sinclair/typebox';
import { JobDtoSchema } from './job.dto.js';

/**
 * SSE event types pushed on a principal's channel. The SSE `event:` field
 * carries one of these; `data:` carries a SyncEventPayload; `id:` carries the
 * monotonic sync-event id used for Last-Event-ID replay.
 */
export const SyncEventType = {
  JobCreated: 'job.created',
  JobAssigned: 'job.assigned',
  JobAccepted: 'job.accepted',
  JobCompleted: 'job.completed',
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
