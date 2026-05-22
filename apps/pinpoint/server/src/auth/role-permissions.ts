/**
 * Role → permissions expansion for pinpoint.
 *
 * Token claims carry `roles: string[]` (see TokenValidator). At
 * request-scope creation we expand those into a flat permission set
 * via this map so the use-case `authorize(scope)` check is a simple
 * `scope.permissions.has(...)`.
 *
 * The role catalogue here intentionally mirrors the platform-side
 * role definitions in `flowcatalyst/roles.ts` (which sync the role
 * names to the FlowCatalyst platform). When you add a role to one
 * file, add it to the other.
 *
 * Unknown roles in a token are silently ignored — adding a role to
 * the IdP without updating this map is a no-op rather than a failure.
 * That keeps deployments forward-compatible with new IdP role names.
 */
import { PinpointPermission } from '@pinpoint/shared';

type PermissionCode = (typeof PinpointPermission)[keyof typeof PinpointPermission];

const ALL_PERMISSIONS: readonly PermissionCode[] = Object.values(PinpointPermission);

/**
 * Read-only operator: every `*:read` permission. Used for support
 * staff that need to inspect data but not mutate it.
 */
const READ_ONLY_PERMISSIONS: readonly PermissionCode[] = ALL_PERMISSIONS.filter(
  (p) => p.endsWith(':read'),
);

/**
 * Per-role permission grants. Add roles here as the IdP grows; the
 * `unknown role` case falls through with no permissions granted.
 */
const ROLE_PERMISSIONS: Readonly<Record<string, readonly PermissionCode[]>> = {
  admin: ALL_PERMISSIONS,
  operator: ALL_PERMISSIONS,
  viewer: READ_ONLY_PERMISSIONS,
} as const;

/**
 * Expand a list of role names into a flat permission set. Unknown
 * roles contribute nothing.
 */
export function permissionsForRoles(roles: readonly string[]): ReadonlySet<string> {
  const out = new Set<string>();
  for (const role of roles) {
    const grants = ROLE_PERMISSIONS[role];
    if (!grants) continue;
    for (const p of grants) out.add(p);
  }
  return out;
}

/**
 * All known pinpoint permissions, frozen as a `ReadonlySet`. Used by
 * the dev-fallback auth path to grant everything to `x-user-id`
 * impersonators so local development isn't gated on role wiring.
 */
export const ALL_PERMISSIONS_SET: ReadonlySet<string> = new Set(ALL_PERMISSIONS);
