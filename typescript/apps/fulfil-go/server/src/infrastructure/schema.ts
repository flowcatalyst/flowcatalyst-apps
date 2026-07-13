// Drizzle table definitions for @fulfil-go/server.
//
// Shared base-entity columns and the local `audit_logs` table come from
// `@flowcatalyst-apps/app-framework` so every app uses the same shape;
// fulfil-go-specific tables are re-exported from this barrel for
// drizzle-kit consumption. The SDK-owned `outbox_messages` table is NOT
// here — it ships as a standalone .sql applied by scripts/db-init.ts.
export {
  baseEntityColumns,
  tsidColumn,
  rawTsidColumn,
  timestampColumn,
  auditLogs,
} from '@flowcatalyst-apps/app-framework';
export type {
  BaseEntity,
  NewEntity,
  NewAuditLog,
  AuditLogRow,
} from '@flowcatalyst-apps/app-framework';

export { jobs } from './schema/jobs.js';
export type { NewJob, JobRow } from './schema/jobs.js';

export { syncEvents } from './schema/sync-events.js';
export type { NewSyncEvent, SyncEventRow } from './schema/sync-events.js';

export { telemetryLocations } from './schema/telemetry-locations.js';
export type { NewTelemetryLocation, TelemetryLocationRow } from './schema/telemetry-locations.js';

export { idempotencyKeys } from './schema/idempotency-keys.js';
export type { NewIdempotencyKey, IdempotencyKeyRow } from './schema/idempotency-keys.js';

export { fulfilments } from './schema/fulfilments.js';
export type { NewFulfilment, FulfilmentRow } from './schema/fulfilments.js';

export { fulfilmentParts } from './schema/fulfilment-parts.js';
export type { NewFulfilmentPart, FulfilmentPartRow } from './schema/fulfilment-parts.js';

export { shortIdCounters } from './schema/short-id-counters.js';
export type { ShortIdCounterRow } from './schema/short-id-counters.js';

export { activityLog } from './schema/activity-log.js';
export type { NewActivityLogEntry, ActivityLogRow } from './schema/activity-log.js';

export { pickerUsers } from './schema/picker-users.js';
export type { NewPickerUser, PickerUserRow } from './schema/picker-users.js';

export { stores } from './schema/stores.js';
export type { NewStore, StoreRow } from './schema/stores.js';

export { storeProfiles } from './schema/store-profiles.js';
export type { StoreProfileRow } from './schema/store-profiles.js';

export { clientSettings } from './schema/client-settings.js';
export type { ClientSettingsRow } from './schema/client-settings.js';

export { pickSessions } from './schema/pick-sessions.js';
export type { PickSessionRow } from './schema/pick-sessions.js';

export { picks } from './schema/picks.js';
export type { NewPick, PickRow } from './schema/picks.js';

export { transportOrders, processReactions } from './schema/transport-orders.js';
export type { TransportOrderRow, ProcessReactionRow } from './schema/transport-orders.js';

export { transportPositions } from './schema/transport-positions.js';
export type { TransportPositionRow } from './schema/transport-positions.js';
