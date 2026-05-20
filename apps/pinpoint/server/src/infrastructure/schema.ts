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

export { clients } from './schema/clients.js';
export type { NewClient, ClientRow } from './schema/clients.js';

export { partitions } from './schema/partitions.js';
export type { NewPartition, PartitionRow } from './schema/partitions.js';

export { principalPartitions } from './schema/principal-partitions.js';
export type {
  NewPrincipalPartition,
  PrincipalPartitionRow,
} from './schema/principal-partitions.js';

export { locations } from './schema/locations.js';
export type { NewLocation, LocationRow } from './schema/locations.js';

export { locationAttributes } from './schema/location-attributes.js';
export type {
  NewLocationAttribute,
  LocationAttributeRow,
} from './schema/location-attributes.js';
