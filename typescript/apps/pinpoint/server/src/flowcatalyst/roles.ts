/**
 * Role definitions registered with the FlowCatalyst platform via
 * `pnpm flowcatalyst:sync`. Permission codes follow the
 * `<domain>:<area>:<resource>:<action>` convention and are sourced from the
 * `PinpointPermission` catalog in `@pinpoint/shared` so the platform roles
 * and the runtime `authorize(scope)` checks can never drift apart.
 *
 * Role `name`s are SHORT (no `pinpoint:` prefix — the platform prepends the
 * application code, so `admin` is persisted as `pinpoint:admin`). When a
 * principal is assigned a role, the platform expands its `permissions` into
 * the access token's space-delimited `scope` claim; pinpoint's
 * `auth/role-permissions.ts#resolvePermissions` reads those back. Anchors
 * (tier ANCHOR / clients `*`) bypass all of this and hold every permission.
 *
 * `clientManaged: true` lets a client's own admins assign the role to their
 * users; `false` reserves assignment to platform/anchor admins.
 */
import type { sync } from '@flowcatalyst/sdk';
import { PinpointPermission } from '@pinpoint/shared';

const P = PinpointPermission;
const ALL_PERMISSIONS: string[] = Object.values(PinpointPermission);
const READ_ONLY_PERMISSIONS: string[] = ALL_PERMISSIONS.filter((p) => p.endsWith(':read'));

export const pinpointRoles: readonly sync.RoleDefinition[] = [
  {
    name: 'admin',
    displayName: 'Pinpoint Administrator',
    description: 'Full access to every pinpoint resource and operation.',
    permissions: ALL_PERMISSIONS,
    clientManaged: false,
  },
  {
    name: 'operator',
    displayName: 'Pinpoint Operator',
    description:
      'Day-to-day address and matching work: create locations and drive the ' +
      'master-location lifecycle. No tenancy, layer, or matching-config administration.',
    permissions: [
      P.ReferenceCountryRead,
      P.TenancyClientRead,
      P.TenancyPartitionRead,
      P.LocationsLocationCreate,
      P.LocationsLocationRead,
      P.LocationsMasterLocationRead,
      P.LocationsMasterLocationValidate,
      P.LocationsMasterLocationConfirm,
      P.LocationsMasterLocationUpdate,
      P.LocationsMasterLocationReject,
      P.MatchingConfigRead,
      P.MatchingSpatialLookup,
      P.LayersLayerRead,
      P.LayersFeatureRead,
      P.LayersPropertySetRead,
    ],
    clientManaged: true,
  },
  {
    name: 'layer-manager',
    displayName: 'Pinpoint Layer Manager',
    description: 'Create and maintain spatial layers, features, and property sets.',
    permissions: [
      P.ReferenceCountryRead,
      P.LayersLayerCreate,
      P.LayersLayerRead,
      P.LayersLayerUpdate,
      P.LayersLayerDelete,
      P.LayersFeatureCreate,
      P.LayersFeatureRead,
      P.LayersFeatureUpdate,
      P.LayersFeatureDelete,
      P.LayersPropertySetCreate,
      P.LayersPropertySetRead,
      P.LayersPropertySetUpdate,
      P.LayersPropertySetDelete,
      P.MatchingSpatialLookup,
    ],
    clientManaged: true,
  },
  {
    name: 'matching-admin',
    displayName: 'Pinpoint Matching Administrator',
    description: 'Manage matching configuration and run spatial lookups.',
    permissions: [
      P.ReferenceCountryRead,
      P.MatchingConfigRead,
      P.MatchingConfigManage,
      P.MatchingSpatialLookup,
      P.LayersLayerRead,
      P.LayersFeatureRead,
    ],
    clientManaged: true,
  },
  {
    name: 'tenancy-admin',
    displayName: 'Pinpoint Tenancy Administrator',
    description: 'Manage clients, partitions, and principal lookups.',
    permissions: [
      P.AuthPrincipalRead,
      P.TenancyClientCreate,
      P.TenancyClientRead,
      P.TenancyClientUpdate,
      P.TenancyClientDelete,
      P.TenancyPartitionCreate,
      P.TenancyPartitionRead,
      P.TenancyPartitionUpdate,
      P.TenancyPartitionDelete,
    ],
    clientManaged: false,
  },
  {
    name: 'viewer',
    displayName: 'Pinpoint Viewer',
    description: 'Read-only access to all pinpoint resources, plus spatial lookups.',
    permissions: [...READ_ONLY_PERMISSIONS, P.MatchingSpatialLookup],
    clientManaged: true,
  },
];
