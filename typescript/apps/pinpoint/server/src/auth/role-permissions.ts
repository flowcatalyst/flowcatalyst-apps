/**
 * Permission resolution for pinpoint — token claims → flat permission set.
 *
 * Mirrors the Rust `pinpoint-domain/src/authorization.rs` model:
 *
 *   - **Anchor / super-admin / admin** implicitly hold EVERY permission.
 *     Detected from the FlowCatalyst token the same way the SDK does:
 *     `tier == "ANCHOR"`, `clients` contains `"*"`, `all_applications`,
 *     or a recognised super-admin role name. (Rust: `is_super_admin()` /
 *     `is_admin()` short-circuit `require_permission`.)
 *   - **Everyone else** holds exactly the `pinpoint:*` permissions the
 *     token carries. The platform expands a principal's assigned roles
 *     into the space-delimited `scope` claim; some grants also appear as
 *     permission strings in `roles`. We keep only entries that are real
 *     pinpoint permissions (unknown strings are ignored, so adding grants
 *     on the IdP is forward-compatible).
 *
 * The use-case `authorize(scope)` check then stays a simple
 * `scope.permissions.has(PinpointPermission.X)`.
 */
import { PinpointPermission } from '@pinpoint/shared';

type PermissionCode = (typeof PinpointPermission)[keyof typeof PinpointPermission];

const ALL_PERMISSIONS: readonly PermissionCode[] = Object.values(PinpointPermission);

/** Real pinpoint permission strings, for filtering token grants. */
const KNOWN_PERMISSIONS: ReadonlySet<string> = new Set(ALL_PERMISSIONS);

/**
 * Role names that grant everything. `platform:super-admin` is the
 * platform-wide anchor role; the `pinpoint:` variants mirror the Rust
 * `authorization::roles` constants so a pinpoint-scoped admin also gets a
 * blanket grant.
 */
const SUPER_ADMIN_ROLES: ReadonlySet<string> = new Set([
  'platform:super-admin',
  'pinpoint:super-admin',
  'pinpoint:admin',
]);

/** Identity claims that drive permission resolution. */
export interface PrincipalClaims {
  readonly roles: readonly string[];
  readonly tier: string | null;
  readonly clients: readonly string[];
  readonly scopes: readonly string[];
  readonly allApplications: boolean;
}

/**
 * True when the principal is an anchor / super-admin and should hold every
 * permission. Matches the SDK's anchor check (`clients` contains `"*"`)
 * plus the platform `tier`/`all_applications` signals and super-admin roles.
 */
export function isAnchor(claims: PrincipalClaims): boolean {
  return (
    claims.allApplications ||
    (claims.tier ?? '').toUpperCase() === 'ANCHOR' ||
    claims.clients.includes('*') ||
    claims.roles.some((r) => SUPER_ADMIN_ROLES.has(r))
  );
}

/**
 * Expand token claims into the flat permission set used for authorization.
 * Anchors get everything; everyone else gets the `pinpoint:*` permissions
 * present in their `scope`/`roles` claims.
 */
export function resolvePermissions(claims: PrincipalClaims): ReadonlySet<string> {
  if (isAnchor(claims)) return ALL_PERMISSIONS_SET;

  const out = new Set<string>();
  for (const candidate of claims.scopes) {
    if (KNOWN_PERMISSIONS.has(candidate)) out.add(candidate);
  }
  for (const role of claims.roles) {
    if (KNOWN_PERMISSIONS.has(role)) out.add(role);
  }
  return out;
}

/**
 * All known pinpoint permissions, frozen as a `ReadonlySet`. Used by the
 * dev-fallback (`x-user-id`) auth path and the scheduler service identity
 * to grant everything without role wiring.
 */
export const ALL_PERMISSIONS_SET: ReadonlySet<string> = new Set(ALL_PERMISSIONS);
