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
    ],
    [FulfilGoRole.FieldWorker]: [
      FulfilGoPermission.AcceptJob,
      FulfilGoPermission.CompleteJob,
      FulfilGoPermission.WriteTelemetry,
    ],
    [FulfilGoRole.ReadOnly]: [],
  };
