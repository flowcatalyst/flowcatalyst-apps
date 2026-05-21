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

export { layers } from './schema/layers.js';
export type { NewLayer, LayerRow } from './schema/layers.js';

export { layerFeatures } from './schema/layer-features.js';
export type { NewLayerFeature, LayerFeatureRow } from './schema/layer-features.js';

export { propertySets } from './schema/property-sets.js';
export type { NewPropertySet, PropertySetRow } from './schema/property-sets.js';

export { properties } from './schema/properties.js';
export type { NewProperty, PropertyRow } from './schema/properties.js';

export { layerPartitions } from './schema/layer-partitions.js';
export type { NewLayerPartition, LayerPartitionRow } from './schema/layer-partitions.js';

export { locationLayerAssociations } from './schema/location-layer-associations.js';
export type {
  NewLocationLayerAssociation,
  LocationLayerAssociationRow,
} from './schema/location-layer-associations.js';

export { matchingConfigs } from './schema/matching-configs.js';
export type { NewMatchingConfig, MatchingConfigRow } from './schema/matching-configs.js';

export { locationFeatureAssociations } from './schema/location-feature-associations.js';
export type {
  NewLocationFeatureAssociation,
  LocationFeatureAssociationRow,
} from './schema/location-feature-associations.js';

export { masterLocations } from './schema/master-locations.js';
export type { NewMasterLocation, MasterLocationRow } from './schema/master-locations.js';

export { processingLog } from './schema/processing-log.js';
export type { NewProcessingLogEntry, ProcessingLogRow } from './schema/processing-log.js';
