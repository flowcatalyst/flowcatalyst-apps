// Drizzle table definitions for @pinpoint/server.
//
// Shared base-entity columns and the local `audit_logs` table come from
// `@flowcatalyst-apps/app-framework` so every app uses the same shape;
// pinpoint-specific aggregate tables are re-exported from this barrel
// for drizzle-kit consumption.
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

export { principals } from './schema/principals.js';
export type { NewPrincipal, PrincipalRow } from './schema/principals.js';

export { countries } from './schema/countries.js';
export type { NewCountry, CountryRow } from './schema/countries.js';
