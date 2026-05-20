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
  TenancyPartitionCreate: 'pinpoint:tenancy:partition:create',
  TenancyPartitionRead: 'pinpoint:tenancy:partition:read',
  LocationsLocationCreate: 'pinpoint:locations:location:create',
  LocationsLocationRead: 'pinpoint:locations:location:read',
  LayersLayerCreate: 'pinpoint:layers:layer:create',
  LayersLayerRead: 'pinpoint:layers:layer:read',
  LayersFeatureCreate: 'pinpoint:layers:feature:create',
  LayersFeatureUpdate: 'pinpoint:layers:feature:update',
  LayersFeatureDelete: 'pinpoint:layers:feature:delete',
  LayersFeatureRead: 'pinpoint:layers:feature:read',
} as const;

export type PinpointPermission = (typeof PinpointPermission)[keyof typeof PinpointPermission];
