// Drizzle table definitions — re-exports from schema modules.
//
// Shared base-entity column primitives and the local `audit_logs` table live
// in `@flowcatalyst-apps/app-framework` so every app in the monorepo uses the
// same definitions; Fulfil's app-specific tables stay local.
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
export { notices } from './schema/notices.js';
export type { NewNotice, NoticeRow } from './schema/notices.js';
export { slaSamples } from './schema/sla-samples.js';
export type { NewSlaSample, SlaSampleRow } from './schema/sla-samples.js';
export { lastMileFulfilments } from './schema/last-mile-fulfilments.js';
export type {
  NewLastMileFulfilmentRow,
  LastMileFulfilmentRow,
} from './schema/last-mile-fulfilments.js';
export { lastMileShipments } from './schema/last-mile-shipments.js';
export type { NewLastMileShipmentRow, LastMileShipmentRow } from './schema/last-mile-shipments.js';
