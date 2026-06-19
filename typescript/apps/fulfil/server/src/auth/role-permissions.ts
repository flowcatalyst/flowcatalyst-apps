/**
 * Role → permissions expansion for fulfil.
 *
 * Token claims carry `roles: string[]` (the principal's IdP roles). At
 * request-scope creation we expand those into a flat permission set
 * via this map so the use-case `authorize(scope)` check is a simple
 * `scope.permissions.has(...)`.
 *
 * The catalogue here intentionally mirrors the platform-side role
 * definitions in `flowcatalyst/lastmile/roles.ts` (which sync the role
 * names to the FlowCatalyst platform) and reuses `DefaultRolePermissions`
 * from `@fulfil/shared` so the in-process mapping stays in lockstep with
 * the per-tenant seed.
 *
 * Unknown roles in a token are silently ignored — adding a role to the
 * IdP without updating this map is a no-op rather than a failure. That
 * keeps deployments forward-compatible with new IdP role names.
 */
import { DefaultRolePermissions, LastMilePermission, type LastMileRole } from '@fulfil/shared';

type PermissionCode = (typeof LastMilePermission)[keyof typeof LastMilePermission];

const ALL_PERMISSIONS: readonly PermissionCode[] = Object.values(LastMilePermission);

/**
 * All known fulfil permissions, frozen as a `ReadonlySet`. Used by the
 * dev-fallback auth path so the `x-user-id` impersonator gets every
 * permission, and by `SystemIdentity.SCHEDULER` for scheduled task
 * scopes (matches pinpoint's behaviour).
 */
export const ALL_PERMISSIONS_SET: ReadonlySet<string> = new Set(ALL_PERMISSIONS);

/**
 * Expand a list of role names into a flat permission set. Roles
 * present in `DefaultRolePermissions` contribute their bundled
 * permissions; unknown roles contribute nothing.
 */
export function permissionsForRoles(roles: readonly string[]): ReadonlySet<string> {
  const out = new Set<string>();
  for (const role of roles) {
    const grants = DefaultRolePermissions[role as LastMileRole];
    if (!grants) continue;
    for (const p of grants) out.add(p);
  }
  return out;
}
