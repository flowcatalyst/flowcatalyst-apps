/**
 * Permission resolution for fulfil-go — token claims → flat permission set.
 *
 * - **Anchor / super-admin** implicitly hold EVERY permission. Detected from
 *   the FlowCatalyst token the same way the SDK does: `tier == "ANCHOR"`,
 *   `clients` contains `"*"`, `all_applications`, or a recognised
 *   super-admin role name.
 * - **Everyone else** holds exactly the fulfil-go permissions the token
 *   carries. The platform expands a principal's assigned roles into the
 *   space-delimited `scope` claim; some grants also appear in `roles`.
 *   Unknown strings are ignored, so adding grants on the IdP is
 *   forward-compatible.
 */
import { FulfilGoPermission } from '@fulfil-go/shared';

type PermissionCode = (typeof FulfilGoPermission)[keyof typeof FulfilGoPermission];

const ALL_PERMISSIONS: readonly PermissionCode[] = Object.values(FulfilGoPermission);

/** Real fulfil-go permission strings, for filtering token grants. */
const KNOWN_PERMISSIONS: ReadonlySet<string> = new Set(ALL_PERMISSIONS);

const SUPER_ADMIN_ROLES: ReadonlySet<string> = new Set([
  'platform:super-admin',
  'fulfil-go:super-admin',
  'fulfil-go:admin',
]);

/** Identity claims that drive permission resolution. */
export interface PrincipalClaims {
  readonly roles: readonly string[];
  readonly tier: string | null;
  readonly clients: readonly string[];
  readonly scopes: readonly string[];
  readonly allApplications: boolean;
}

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
 * Anchors get everything; everyone else gets the fulfil-go permissions
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
 * All known fulfil-go permissions, frozen as a `ReadonlySet`. Used by the
 * dev-fallback (`x-user-id`) auth path to grant everything without role
 * wiring.
 */
export const ALL_PERMISSIONS_SET: ReadonlySet<string> = new Set(ALL_PERMISSIONS);
