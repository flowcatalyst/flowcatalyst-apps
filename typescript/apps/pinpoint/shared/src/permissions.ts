/**
 * Pinpoint permission catalog.
 *
 * Permission codes follow the `<domain>:<area>:<resource>:<action>` shape
 * shared with the rest of the flowcatalyst platform. The tokens here are the
 * authorize-check identifiers used by use-case classes; the platform-side
 * names sync'd via `flowcatalyst/roles.ts` are separate strings (intentionally).
 *
 * Real authz binding (token → role → permission check) lands in a later
 * slice; the constants exist now so use cases can declare their
 * `static readonly requiredPermission` field consistently with fulfil.
 */
export const PinpointPermission = {
  AuthPrincipalRead: 'pinpoint:auth:principal:read',
  ReferenceCountryRead: 'pinpoint:reference:country:read',
  TenancyClientCreate: 'pinpoint:tenancy:client:create',
  TenancyClientRead: 'pinpoint:tenancy:client:read',
  TenancyClientUpdate: 'pinpoint:tenancy:client:update',
  TenancyClientDelete: 'pinpoint:tenancy:client:delete',
  TenancyPartitionCreate: 'pinpoint:tenancy:partition:create',
  TenancyPartitionRead: 'pinpoint:tenancy:partition:read',
  TenancyPartitionUpdate: 'pinpoint:tenancy:partition:update',
  TenancyPartitionDelete: 'pinpoint:tenancy:partition:delete',
  LocationsLocationCreate: 'pinpoint:locations:location:create',
  LocationsLocationRead: 'pinpoint:locations:location:read',
  LayersLayerCreate: 'pinpoint:layers:layer:create',
  LayersLayerRead: 'pinpoint:layers:layer:read',
  LayersLayerUpdate: 'pinpoint:layers:layer:update',
  LayersLayerDelete: 'pinpoint:layers:layer:delete',
  LayersFeatureCreate: 'pinpoint:layers:feature:create',
  LayersFeatureUpdate: 'pinpoint:layers:feature:update',
  LayersFeatureDelete: 'pinpoint:layers:feature:delete',
  LayersFeatureRead: 'pinpoint:layers:feature:read',
  LayersPropertySetCreate: 'pinpoint:layers:property_set:create',
  LayersPropertySetRead: 'pinpoint:layers:property_set:read',
  LayersPropertySetUpdate: 'pinpoint:layers:property_set:update',
  LayersPropertySetDelete: 'pinpoint:layers:property_set:delete',
  MatchingConfigRead: 'pinpoint:matching:config:read',
  MatchingConfigManage: 'pinpoint:matching:config:manage',
  MatchingSpatialLookup: 'pinpoint:matching:spatial:lookup',
  LocationsMasterLocationRead: 'pinpoint:locations:master_location:read',
  /** Geocode-only step (PENDING → GEOCODED). Despite the name, this is the geocoding gate. */
  LocationsMasterLocationValidate: 'pinpoint:locations:master_location:validate',
  /** Canonicalization step (GEOCODED → VALIDATED). Cascades to child locations. */
  LocationsMasterLocationConfirm: 'pinpoint:locations:master_location:confirm',
  /** Manually edit normalized components of a master location (BFF). */
  LocationsMasterLocationUpdate: 'pinpoint:locations:master_location:update',
  /** Manually mark a master location as REJECTED (junk, duplicate, etc.). */
  LocationsMasterLocationReject: 'pinpoint:locations:master_location:reject',
} as const;

export type PinpointPermission = (typeof PinpointPermission)[keyof typeof PinpointPermission];
