/**
 * Role definitions registered with the FlowCatalyst platform. Permission codes
 * follow the `<domain>:<area>:<resource>:<action>` convention.
 *
 * Populated as use-case slices land. The TS-side `PinpointPermission` catalog
 * in `@pinpoint/shared` is intentionally separate from these platform-side
 * names — real authz binding (token → role → permission check) lands in a
 * later slice.
 */
import { sync } from '@flowcatalyst/sdk';

export const pinpointRoles: readonly sync.RoleDefinition[] = [];
