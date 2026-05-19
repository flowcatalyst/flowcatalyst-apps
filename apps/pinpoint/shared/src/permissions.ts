/**
 * Pinpoint permission catalog.
 *
 * Permission codes follow the `<domain>:<area>:<resource>:<action>` shape
 * shared with the rest of the flowcatalyst platform. The tokens here are the
 * authorize-check identifiers used by use-case classes; the platform-side
 * names sync'd via `flowcatalyst/roles.ts` are separate strings (intentionally).
 *
 * Real authz binding (token → role → permission check) lands in a later
 * slice; for now these constants exist so use cases can declare their
 * `static readonly requiredPermission` field consistently with fulfil.
 */
export const PinpointPermission = {
  // populated as slices land — see MIGRATION_PLAN.md
} as const;

export type PinpointPermission = (typeof PinpointPermission)[keyof typeof PinpointPermission];
