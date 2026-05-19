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
} as const;

export type PinpointPermission = (typeof PinpointPermission)[keyof typeof PinpointPermission];
