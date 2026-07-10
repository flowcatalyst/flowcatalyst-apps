// Atomic permissions for fulfil-go. Each use case checks exactly one of
// these; the list grows as new use cases earn permissions.
export const FulfilGoPermission = {
  CreateFulfilment: 'createFulfilment',
  CancelFulfilment: 'cancelFulfilment',
  CreateJob: 'createJob',
  AssignJob: 'assignJob',
  AcceptJob: 'acceptJob',
  CompleteJob: 'completeJob',
  WriteTelemetry: 'writeTelemetry',
  // Pick-context identity administration (platform-OIDC admins).
  ManagePickers: 'managePickers',
  // Store registry administration (sync/list reference stores).
  ManageStores: 'manageStores',
  // Store-scoped picker permissions — NOT granted via platform claims; the
  // picker session token issues them after QR/PIN login (see pick-context-auth).
  ViewStorePicks: 'viewStorePicks',
  ClaimPick: 'claimPick',
} as const;
export type FulfilGoPermission = (typeof FulfilGoPermission)[keyof typeof FulfilGoPermission];

// Role names are conventional bundles, not a code-enforced hierarchy.
// Dispatchers create/assign work from the back office; field workers
// (drivers and pickers) accept/complete jobs and stream telemetry.
export const FulfilGoRole = {
  Dispatcher: 'fulfilgoDispatcher',
  FieldWorker: 'fulfilgoFieldWorker',
  ReadOnly: 'fulfilgoReadOnly',
} as const;
export type FulfilGoRole = (typeof FulfilGoRole)[keyof typeof FulfilGoRole];

// Default role → permission mapping. Seeded on tenant provisioning; not
// treated as source of truth at authorization time.
export const DefaultRolePermissions: Readonly<Record<FulfilGoRole, readonly FulfilGoPermission[]>> =
  {
    [FulfilGoRole.Dispatcher]: [
      FulfilGoPermission.CreateFulfilment,
      FulfilGoPermission.CancelFulfilment,
      FulfilGoPermission.CreateJob,
      FulfilGoPermission.AssignJob,
      FulfilGoPermission.ManagePickers,
      FulfilGoPermission.ManageStores,
    ],
    [FulfilGoRole.FieldWorker]: [
      FulfilGoPermission.AcceptJob,
      FulfilGoPermission.CompleteJob,
      FulfilGoPermission.WriteTelemetry,
    ],
    [FulfilGoRole.ReadOnly]: [],
  };

/**
 * Permissions a picker holds for the duration of a station session. Granted by
 * the picker login use case and stamped into the session token — pickers are
 * NOT platform principals, so these never flow through `resolvePermissions`.
 * Store scoping (which store's picks) is enforced separately from
 * `scope.attributes.storeRef`, not by permission membership.
 */
export const PICKER_SESSION_PERMISSIONS: readonly FulfilGoPermission[] = [
  FulfilGoPermission.ViewStorePicks,
  FulfilGoPermission.ClaimPick,
];
