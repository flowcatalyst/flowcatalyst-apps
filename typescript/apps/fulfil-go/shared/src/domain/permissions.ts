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
  // Reveal handover PINs (management + flightboard action) — EVERY grant of
  // this read is audited to the activity log (docs/handover-verification.md).
  ViewHandoverPins: 'viewHandoverPins',
  // Store-scoped picker permissions — NOT granted via platform claims; the
  // picker session token issues them after QR/PIN login (see pick-context-auth).
  ViewStorePicks: 'viewStorePicks',
  ClaimPick: 'claimPick',
  ReportPickOutcome: 'reportPickOutcome',
  // Supervisor-role pickers only (role='supervisor' at login): station
  // supervisor mode — flag picks as needing a car or bigger.
  SupervisePicks: 'supervisePicks',
  // Transport-context identity administration (platform-OIDC admins).
  ManageDrivers: 'manageDrivers',
  // Depot-scoped driver permissions — issued by the DRIVER session token
  // after staff-code/PIN login (the picker pattern; Andrew 2026-07-13).
  ViewStoreTransport: 'viewStoreTransport',
  ClaimTrip: 'claimTrip',
  ReportTransportOutcome: 'reportTransportOutcome',
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
      FulfilGoPermission.ManageDrivers,
      FulfilGoPermission.ManageStores,
      FulfilGoPermission.ViewHandoverPins,
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
  FulfilGoPermission.ReportPickOutcome,
];

/**
 * Permissions a driver holds for the duration of an app session. Granted by
 * the driver login (staff code + PIN — the picker pattern) and stamped into
 * the session token; drivers are NOT platform principals. Depot scoping
 * (which store's trips) comes from `scope.attributes.storeRef`.
 */
export const DRIVER_SESSION_PERMISSIONS: readonly FulfilGoPermission[] = [
  FulfilGoPermission.ViewStoreTransport,
  FulfilGoPermission.ClaimTrip,
  FulfilGoPermission.ReportTransportOutcome,
  FulfilGoPermission.WriteTelemetry,
];
