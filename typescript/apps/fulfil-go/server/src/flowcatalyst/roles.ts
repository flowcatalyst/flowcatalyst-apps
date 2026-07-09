/**
 * Role definitions registered with the FlowCatalyst platform via
 * `pnpm flowcatalyst:sync`. Permission codes come from the `FulfilGoPermission`
 * catalog in `@fulfil-go/shared` so the platform roles and the runtime
 * `authorize(scope)` checks can never drift apart.
 *
 * Role `name`s are SHORT — the platform prepends the application code, so
 * `admin` persists as `fulfil-go:admin`. When a principal is assigned a
 * role, the platform expands its `permissions` into the access token's
 * space-delimited `scope` claim; `auth/role-permissions.ts` reads those
 * back. Anchors bypass all of this and hold every permission.
 */
import type { sync } from '@flowcatalyst/sdk';
import { DefaultRolePermissions, FulfilGoPermission, FulfilGoRole } from '@fulfil-go/shared';

const ALL_PERMISSIONS: string[] = Object.values(FulfilGoPermission);

export const fulfilGoRoles: readonly sync.RoleDefinition[] = [
  {
    name: 'admin',
    displayName: 'FulfilGo Administrator',
    description: 'Full access to every fulfil-go resource and operation.',
    permissions: ALL_PERMISSIONS,
    clientManaged: false,
  },
  {
    name: 'dispatcher',
    displayName: 'FulfilGo Dispatcher',
    description: 'Back-office fulfilment coordination: create and cancel fulfilments.',
    permissions: [...DefaultRolePermissions[FulfilGoRole.Dispatcher]],
    clientManaged: true,
  },
  {
    name: 'field-worker',
    displayName: 'FulfilGo Field Worker',
    description: 'Drivers and pickers: work jobs and stream telemetry from the mobile apps.',
    permissions: [...DefaultRolePermissions[FulfilGoRole.FieldWorker]],
    clientManaged: true,
  },
  {
    name: 'read-only',
    displayName: 'FulfilGo Read Only',
    description: 'View-only access.',
    permissions: [...DefaultRolePermissions[FulfilGoRole.ReadOnly]],
    clientManaged: true,
  },
];
