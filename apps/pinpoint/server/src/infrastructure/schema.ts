// Drizzle table definitions for @pinpoint/server.
//
// Shared base-entity columns and the local `audit_logs` table come from
// `@flowcatalyst-apps/app-framework` so every app uses the same shape;
// pinpoint-specific aggregate tables get added here as later slices land.
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
