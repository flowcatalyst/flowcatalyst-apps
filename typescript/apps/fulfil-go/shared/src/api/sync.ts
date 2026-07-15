import { type Static, Type } from '@sinclair/typebox';
import { PickDtoSchema } from './pick.dto.js';

/**
 * SSE event types. Pick events push on the store's `store:` channel (every
 * station/picker at the store shares one stream); future per-principal
 * events push on the `user:` channel. The SSE `event:` field carries one of
 * these; `data:` carries the matching payload; `id:` carries the monotonic
 * sync-event id used for Last-Event-ID replay.
 */
export const SyncEventType = {
  PickCreated: 'pick.created',
  PickClaimed: 'pick.claimed',
  /** Non-lifecycle mutation (e.g. supervisor car flag) — payload has the pick. */
  PickUpdated: 'pick.updated',
  /** Completed = picked OR short_picked; the payload's status distinguishes. */
  PickCompleted: 'pick.completed',
  PickFailed: 'pick.failed',
} as const;
export type SyncEventType = (typeof SyncEventType)[keyof typeof SyncEventType];

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
