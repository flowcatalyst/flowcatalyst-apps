import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import {
  buildOutboxManager,
  createAggregateRegistry,
  createUnitOfWork,
  createTransactionManager,
  TransactionStore,
  type AggregateRegistryImpl,
  type TransactionManager,
} from '@fulfil-go/framework';
import type { Result, UnitOfWork } from '@fulfil-go/framework';
import { createDrizzleJobRepository } from './infrastructure/job-repository.js';
import { createDrizzleTelemetryRepository } from './infrastructure/telemetry-repository.js';
import type { TelemetryRepository } from './infrastructure/telemetry-repository.js';
import { createDrizzleIdempotencyRepository } from './infrastructure/idempotency-repository.js';
import type { IdempotencyRepository } from './infrastructure/idempotency-repository.js';
import { createDrizzleSyncEventRepository } from './infrastructure/sync-event-repository.js';
import type { SyncEventRepository } from './infrastructure/sync-event-repository.js';
import { registerJob } from './infrastructure/register-job.js';
import { createDrizzleFulfilmentRepository } from './infrastructure/fulfilment-repository.js';
import { registerFulfilment } from './infrastructure/register-fulfilment.js';
import { createShortIdAllocator } from './infrastructure/short-id-allocator.js';
import type { ShortIdAllocator } from './infrastructure/short-id-allocator.js';
import { createDrizzleFulfilmentProcessingLogRepository } from './infrastructure/fulfilment-processing-log-repository.js';
import type { FulfilmentProcessingLogRepository } from './infrastructure/fulfilment-processing-log-repository.js';
import { FULFILMENT_ID_PREFIX } from './domain/fulfilments/ids.js';
import { FULFILMENT_TYPE } from './domain/fulfilments/fulfilment.js';
import type { FulfilmentRepository } from './domain/fulfilments/fulfilment.repository.js';
import { createDrizzlePickerUserRepository } from './infrastructure/picker-user-repository.js';
import { registerPickerUser } from './infrastructure/register-picker-user.js';
import { PICKER_USER_ID_PREFIX } from './domain/pick-identity/ids.js';
import { PICKER_USER_TYPE } from './domain/pick-identity/picker-user.js';
import type { PickerUserRepository } from './domain/pick-identity/picker-user.repository.js';
import { createDrizzleStoreRepository } from './infrastructure/store-repository.js';
import type { StoreRepository } from './infrastructure/store-repository.js';
import { createDrizzlePickRepository } from './infrastructure/pick-repository.js';
import { registerPick } from './infrastructure/register-pick.js';
import { PICK_ID_PREFIX } from './domain/picks/ids.js';
import { PICK_TYPE } from './domain/picks/pick.js';
import type { PickRepository } from './domain/picks/pick.repository.js';
import { CreateFulfilmentUseCase } from './operations/create-fulfilment/create-fulfilment.use-case.js';
import { CancelFulfilmentUseCase } from './operations/cancel-fulfilment/cancel-fulfilment.use-case.js';
import { ReleasePartForPickUseCase } from './operations/release-part-for-pick/release-part-for-pick.use-case.js';
import { CreatePickerUseCase } from './operations/create-picker/create-picker.use-case.js';
import {
  DeletePickerUseCase,
  ReactivatePickerUseCase,
  ReassignPickerUseCase,
  SuspendPickerUseCase,
} from './operations/manage-picker/manage-picker.use-cases.js';
import { ReceivePickUseCase } from './operations/receive-pick/receive-pick.use-case.js';
import { ClaimPickUseCase } from './operations/claim-pick/claim-pick.use-case.js';
import {
  CompletePickUseCase,
  FailPickUseCase,
} from './operations/report-pick-outcome/report-pick-outcome.use-cases.js';
import { JOB_ID_PREFIX } from './domain/jobs/ids.js';
import { JOB_TYPE } from './domain/jobs/job.js';
import type { JobRepository } from './domain/jobs/job.repository.js';
import { createSseBroker, type SseBroker } from './sse/sse-broker.js';
import { createTokenValidator, type TokenValidator } from './auth/token-validator.js';
import { createMobileOidcBroker, type MobileOidcBroker } from './auth/oidc-client.js';
import { createPickerTokenService, type PickerTokenService } from './auth/picker-token.js';
import { createPickerAuthService, type PickerAuthService } from './auth/picker-auth-service.js';
import type { AuthConfig } from './auth/auth-config.js';
import { CreateJobUseCase } from './operations/create-job/create-job.use-case.js';
import { AssignJobUseCase } from './operations/assign-job/assign-job.use-case.js';
import { AcceptJobUseCase } from './operations/accept-job/accept-job.use-case.js';
import { CompleteJobUseCase } from './operations/complete-job/complete-job.use-case.js';

/**
 * Composition root for the fulfil-go server. Wires the repository graph, a
 * Promise-typed UnitOfWork backed by the SDK's non-Effect surface, and a
 * `runWrite` boundary that opens a Drizzle tx, binds it on ALS via
 * `TransactionStore`, and invokes the use-case thunk.
 *
 * Keep this file dumb — wiring only, no business logic.
 */
export interface AppContextRepositories {
  readonly jobs: JobRepository;
  readonly fulfilments: FulfilmentRepository;
  readonly fulfilmentLog: FulfilmentProcessingLogRepository;
  readonly shortIds: ShortIdAllocator;
  readonly syncEvents: SyncEventRepository;
  readonly telemetry: TelemetryRepository;
  readonly idempotency: IdempotencyRepository;
  readonly pickerUsers: PickerUserRepository;
  readonly stores: StoreRepository;
  readonly picks: PickRepository;
}

export interface AppContextUseCases {
  readonly createFulfilment: CreateFulfilmentUseCase;
  readonly cancelFulfilment: CancelFulfilmentUseCase;
  readonly releasePartForPick: ReleasePartForPickUseCase;
  readonly createPicker: CreatePickerUseCase;
  readonly suspendPicker: SuspendPickerUseCase;
  readonly reactivatePicker: ReactivatePickerUseCase;
  readonly reassignPicker: ReassignPickerUseCase;
  readonly deletePicker: DeletePickerUseCase;
  readonly receivePick: ReceivePickUseCase;
  readonly claimPick: ClaimPickUseCase;
  readonly completePick: CompletePickUseCase;
  readonly failPick: FailPickUseCase;
  readonly createJob: CreateJobUseCase;
  readonly assignJob: AssignJobUseCase;
  readonly acceptJob: AcceptJobUseCase;
  readonly completeJob: CompleteJobUseCase;
}

/**
 * Auth surface — tokenValidator is null when no OIDC issuer is configured
 * (local dev with `FULFILGO_AUTH_DEV_FALLBACK=true` still works then).
 */
export interface AppContextAuth {
  readonly config: AuthConfig;
  readonly tokenValidator: TokenValidator | null;
  /** Mobile PKCE brokering (per-app OAuth clients) — null when no OIDC issuer is configured. */
  readonly oidcBroker: MobileOidcBroker | null;
  /** Fulfil-go-issued picker session tokens (shared-station picking app). */
  readonly pickerTokenService: PickerTokenService;
}

export interface AppContext {
  readonly db: PostgresJsDatabase;
  readonly transactionManager: TransactionManager;
  readonly aggregateRegistry: AggregateRegistryImpl;
  readonly repositories: AppContextRepositories;
  readonly useCases: AppContextUseCases;
  readonly auth: AppContextAuth;
  /** Picker station login (PIN/QR → session token). */
  readonly pickAuth: PickerAuthService;
  /** Started by server.ts on boot; routes nudge it after successful writes. */
  readonly sseBroker: SseBroker;
  /**
   * Plain async/await boundary for use cases. Opens a Drizzle tx, binds it
   * on ALS via `TransactionStore`, and invokes the thunk inside the tx.
   * Identity comes from the surrounding `ScopeStore.run(scope, ...)` (set
   * by the route boundary).
   */
  readonly runWrite: <A>(thunk: () => Promise<Result<A>>) => Promise<Result<A>>;
}

export interface AppContextConfig {
  readonly db: PostgresJsDatabase;
  /** Local outbox-row tag (application code; never sent to the platform). */
  readonly clientId: string;
  /** Base URL the platform's dispatcher/scheduler calls back into. */
  readonly publicBaseUrl: string;
  /** Dispatch pool for fulfil-go-emitted dispatch jobs. */
  readonly dispatchPoolCode: string;
  readonly auth: AuthConfig;
}

export async function createAppContext(config: AppContextConfig): Promise<AppContext> {
  const { db, clientId } = config;

  const transactionManager = createTransactionManager(db);

  const aggregateRegistry = createAggregateRegistry({
    [JOB_ID_PREFIX]: JOB_TYPE,
    [FULFILMENT_ID_PREFIX]: FULFILMENT_TYPE,
    [PICKER_USER_ID_PREFIX]: PICKER_USER_TYPE,
    [PICK_ID_PREFIX]: PICK_TYPE,
  });

  const jobRepo = createDrizzleJobRepository(db);
  const syncEventRepo = createDrizzleSyncEventRepository(db);
  const telemetryRepo = createDrizzleTelemetryRepository(db);
  const idempotencyRepo = createDrizzleIdempotencyRepository(db);

  const fulfilmentRepo = createDrizzleFulfilmentRepository(db);
  const fulfilmentLogRepo = createDrizzleFulfilmentProcessingLogRepository(db);
  const shortIdAllocator = createShortIdAllocator(db);
  const pickerUserRepo = createDrizzlePickerUserRepository(db);
  const storeRepo = createDrizzleStoreRepository(db);
  const pickRepo = createDrizzlePickRepository(db);

  registerJob(aggregateRegistry, jobRepo);
  registerFulfilment(aggregateRegistry, fulfilmentRepo);
  registerPickerUser(aggregateRegistry, pickerUserRepo);
  registerPick(aggregateRegistry, pickRepo);

  // One OutboxManager backs the UoW so events + local audit logs ride the
  // same ALS-bound Drizzle tx as the aggregate writes.
  const outboxManager = buildOutboxManager({ clientId });
  const uow: UnitOfWork = createUnitOfWork(outboxManager);

  const runWrite = async <A>(thunk: () => Promise<Result<A>>): Promise<Result<A>> =>
    transactionManager.inTransaction((tx) => TransactionStore.run(tx, thunk));

  // Discovery is only attempted when the issuer is configured, so a no-IdP
  // local dev run with the dev fallback still boots fine. Discovery failures
  // throw — startup blocks on the IdP being reachable.
  const tokenValidator = config.auth.oidc !== null ? createTokenValidator(config.auth.oidc) : null;
  const oidcBroker =
    config.auth.oidc !== null ? await createMobileOidcBroker(config.auth.oidc) : null;
  const pickerTokenService = createPickerTokenService(config.auth.picker);
  const pickerAuthService = createPickerAuthService(
    pickerUserRepo,
    pickerTokenService,
    config.auth.picker,
  );

  const sseBroker = createSseBroker(syncEventRepo, console);

  return {
    db,
    transactionManager,
    aggregateRegistry,
    repositories: {
      jobs: jobRepo,
      fulfilments: fulfilmentRepo,
      fulfilmentLog: fulfilmentLogRepo,
      shortIds: shortIdAllocator,
      syncEvents: syncEventRepo,
      telemetry: telemetryRepo,
      idempotency: idempotencyRepo,
      pickerUsers: pickerUserRepo,
      stores: storeRepo,
      picks: pickRepo,
    },
    useCases: {
      createFulfilment: new CreateFulfilmentUseCase(
        uow,
        aggregateRegistry,
        fulfilmentRepo,
        shortIdAllocator,
        fulfilmentLogRepo,
      ),
      cancelFulfilment: new CancelFulfilmentUseCase(
        uow,
        aggregateRegistry,
        fulfilmentRepo,
        fulfilmentLogRepo,
      ),
      releasePartForPick: new ReleasePartForPickUseCase(
        uow,
        aggregateRegistry,
        fulfilmentRepo,
        fulfilmentLogRepo,
        outboxManager,
        { publicBaseUrl: config.publicBaseUrl, dispatchPoolCode: config.dispatchPoolCode },
      ),
      createPicker: new CreatePickerUseCase(uow, aggregateRegistry, pickerUserRepo, storeRepo),
      suspendPicker: new SuspendPickerUseCase(uow, aggregateRegistry, pickerUserRepo),
      reactivatePicker: new ReactivatePickerUseCase(uow, aggregateRegistry, pickerUserRepo),
      reassignPicker: new ReassignPickerUseCase(uow, aggregateRegistry, pickerUserRepo, storeRepo),
      deletePicker: new DeletePickerUseCase(uow, aggregateRegistry, pickerUserRepo),
      receivePick: new ReceivePickUseCase(
        uow,
        aggregateRegistry,
        pickRepo,
        fulfilmentLogRepo,
        syncEventRepo,
      ),
      claimPick: new ClaimPickUseCase(
        uow,
        aggregateRegistry,
        pickRepo,
        fulfilmentLogRepo,
        syncEventRepo,
      ),
      completePick: new CompletePickUseCase(
        uow,
        aggregateRegistry,
        pickRepo,
        fulfilmentLogRepo,
        syncEventRepo,
      ),
      failPick: new FailPickUseCase(
        uow,
        aggregateRegistry,
        pickRepo,
        fulfilmentLogRepo,
        syncEventRepo,
      ),
      createJob: new CreateJobUseCase(uow, aggregateRegistry),
      assignJob: new AssignJobUseCase(uow, aggregateRegistry, jobRepo, syncEventRepo),
      acceptJob: new AcceptJobUseCase(uow, aggregateRegistry, jobRepo, syncEventRepo),
      completeJob: new CompleteJobUseCase(uow, aggregateRegistry, jobRepo, syncEventRepo),
    },
    auth: {
      config: config.auth,
      tokenValidator,
      oidcBroker,
      pickerTokenService,
    },
    pickAuth: pickerAuthService,
    sseBroker,
    runWrite,
  };
}
