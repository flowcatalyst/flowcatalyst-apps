import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { FlowCatalystClient } from '@flowcatalyst/sdk';
import { resolveClientSettings, type ResolvedPickStoreSettings } from '@fulfil-go/shared';
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
import { createDrizzleTelemetryRepository } from './infrastructure/telemetry-repository.js';
import type { TelemetryRepository } from './infrastructure/telemetry-repository.js';
import { createDrizzleIdempotencyRepository } from './infrastructure/idempotency-repository.js';
import type { IdempotencyRepository } from './infrastructure/idempotency-repository.js';
import { createDrizzleSyncEventRepository } from './infrastructure/sync-event-repository.js';
import {
  loadPickSettingsResolver,
  loadTransportSettingsResolver,
} from './infrastructure/store-settings-resolver.js';
import { createBlobStore, type ScopedBlobStore } from './infrastructure/blob-store.js';
import { createPickSessionProjection } from './infrastructure/pick-session-projection.js';
import type { SyncEventRepository } from './infrastructure/sync-event-repository.js';
import { createDrizzleFulfilmentRepository } from './infrastructure/fulfilment-repository.js';
import { registerFulfilment } from './infrastructure/register-fulfilment.js';
import { createShortIdAllocator } from './infrastructure/short-id-allocator.js';
import type { ShortIdAllocator } from './infrastructure/short-id-allocator.js';
import { createDrizzleActivityLogRepository } from './infrastructure/activity-log-repository.js';
import type { ActivityLogRepository } from './infrastructure/activity-log-repository.js';
import { createDrizzleClientSettingsRepository } from './infrastructure/client-settings-repository.js';
import type { ClientSettingsRepository } from './infrastructure/client-settings-repository.js';
import { createProcessRegistry, type ProcessRegistry } from './processes/process-registry.js';
import { standardDefinition } from './processes/standard-definition.js';
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
import { createDrizzlePrinterRepository } from './infrastructure/printer-repository.js';
import type { PrinterRepository } from './infrastructure/printer-repository.js';
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
import { FlagPickVehicleUseCase } from './operations/flag-pick-vehicle/flag-pick-vehicle.use-case.js';
import {
  AllocatePickLabelsUseCase,
  ReprintPickLabelUseCase,
} from './operations/print-pick-labels/print-pick-labels.use-cases.js';
import {
  CompletePickUseCase,
  FailPickUseCase,
} from './operations/report-pick-outcome/report-pick-outcome.use-cases.js';
import {
  RegisterPartCarFlagUseCase,
  RegisterPartFailedUseCase,
  RegisterPartPickedUseCase,
  RegisterPartPickingUseCase,
} from './operations/fulfilment-pick-process/fulfilment-pick-process.use-cases.js';
import { RegisterPartDeliveryUseCase } from './operations/fulfilment-transport-process/fulfilment-transport-process.use-case.js';
import {
  ProvisionEpodUseCase,
  RequestEpodProvisioningUseCase,
} from './operations/epod-provisioning/epod-provisioning.use-cases.js';
import { createEpodClient, type EpodClientConfig } from './transport/epod/client.js';
import { createDrizzleTransportOrderRepository } from './infrastructure/transport-order-repository.js';
import { registerTransportOrder } from './infrastructure/register-transport-order.js';
import { createDrizzleProcessReactionRepository } from './infrastructure/process-reaction-repository.js';
import type { ProcessReactionRepository } from './infrastructure/process-reaction-repository.js';
import { TRANSPORT_ORDER_ID_PREFIX } from './domain/transport-orders/ids.js';
import { TRANSPORT_ORDER_TYPE } from './domain/transport-orders/transport-order.js';
import type { TransportOrderRepository } from './domain/transport-orders/transport-order.repository.js';
import {
  EPOD_CHANNEL,
  OWN_CHANNEL,
  createProviderRegistry,
  type ProviderChannel,
  type ProviderRegistry,
} from './transport/adapter-registry.js';
import { createUberAdapter, type UberAdapterConfig } from './transport/uber/adapter.js';
import {
  RequestTransportUseCase,
  ScheduleTransportRequestUseCase,
} from './operations/request-transport/request-transport.use-cases.js';
import { BookTransportOrderUseCase } from './operations/book-transport-order/book-transport-order.use-case.js';
import { ApplyTransportStatusUseCase } from './operations/apply-transport-status/apply-transport-status.use-case.js';
import { createDrizzleTransportPositionRepository } from './infrastructure/transport-position-repository.js';
import type { TransportPositionRepository } from './infrastructure/transport-position-repository.js';
import {
  createRouterClient,
  type RouterClient,
  type RouterClientConfig,
} from './transport/router/client.js';
import { createDrizzleTripRepository } from './infrastructure/trip-repository.js';
import { createDrizzleDriverUserRepository } from './infrastructure/driver-user-repository.js';
import { createDrizzleDepotRepository } from './infrastructure/depot-repository.js';
import type { DepotRepository } from './infrastructure/depot-repository.js';
import { registerDriverUser } from './infrastructure/register-driver-user.js';
import { DRIVER_USER_ID_PREFIX } from './domain/driver-identity/ids.js';
import { DRIVER_USER_TYPE } from './domain/driver-identity/driver-user.js';
import type { DriverUserRepository } from './domain/driver-identity/driver-user.repository.js';
import { CreateDriverUseCase } from './operations/create-driver/create-driver.use-case.js';
import {
  DeleteDriverUseCase,
  ReactivateDriverUseCase,
  ReassignDriverUseCase,
  SuspendDriverUseCase,
} from './operations/manage-driver/manage-driver.use-cases.js';
import { createDriverAuthService, type DriverAuthService } from './auth/driver-auth-service.js';
import { registerTrip } from './infrastructure/register-trip.js';
import { TRIP_ID_PREFIX } from './domain/trips/ids.js';
import { TRIP_TYPE } from './domain/trips/trip.js';
import type { TripRepository } from './domain/trips/trip.repository.js';
import { ComposeTransportOfferUseCase } from './operations/transport-planning/compose-transport-offer.use-case.js';
import { ClaimTransportTripUseCase } from './operations/transport-planning/claim-transport-trip.use-case.js';
import {
  ReportTripProgressUseCase,
  VerifyHandoverPinUseCase,
} from './operations/report-trip-progress/report-trip-progress.use-case.js';
import { createSseBroker, type SseBroker } from './sse/sse-broker.js';
import { createTokenValidator, type TokenValidator } from './auth/token-validator.js';
import { createMobileOidcBroker, type MobileOidcBroker } from './auth/oidc-client.js';
import { createPickerTokenService, type PickerTokenService } from './auth/picker-token.js';
import { createPickerAuthService, type PickerAuthService } from './auth/picker-auth-service.js';
import type { AuthConfig } from './auth/auth-config.js';

/**
 * Composition root for the fulfil-go server. Wires the repository graph, a
 * Promise-typed UnitOfWork backed by the SDK's non-Effect surface, and a
 * `runWrite` boundary that opens a Drizzle tx, binds it on ALS via
 * `TransactionStore`, and invokes the use-case thunk.
 *
 * Keep this file dumb — wiring only, no business logic.
 */
export interface AppContextRepositories {
  readonly fulfilments: FulfilmentRepository;
  readonly activityLog: ActivityLogRepository;
  readonly shortIds: ShortIdAllocator;
  readonly syncEvents: SyncEventRepository;
  readonly telemetry: TelemetryRepository;
  readonly idempotency: IdempotencyRepository;
  readonly pickerUsers: PickerUserRepository;
  readonly stores: StoreRepository;
  readonly picks: PickRepository;
  readonly printers: PrinterRepository;
  readonly clientSettings: ClientSettingsRepository;
  readonly transportOrders: TransportOrderRepository;
  readonly processReactions: ProcessReactionRepository;
  readonly transportPositions: TransportPositionRepository;
  readonly trips: TripRepository;
  readonly driverUsers: DriverUserRepository;
  readonly depots: DepotRepository;
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
  readonly flagPickVehicle: FlagPickVehicleUseCase;
  readonly completePick: CompletePickUseCase;
  readonly failPick: FailPickUseCase;
  readonly allocatePickLabels: AllocatePickLabelsUseCase;
  readonly reprintPickLabel: ReprintPickLabelUseCase;
  readonly registerPartPicking: RegisterPartPickingUseCase;
  readonly registerPartPicked: RegisterPartPickedUseCase;
  readonly registerPartCarFlag: RegisterPartCarFlagUseCase;
  readonly registerPartFailed: RegisterPartFailedUseCase;
  readonly registerPartDelivery: RegisterPartDeliveryUseCase;
  readonly requestEpodProvisioning: RequestEpodProvisioningUseCase;
  readonly provisionEpod: ProvisionEpodUseCase;
  readonly requestTransport: RequestTransportUseCase;
  readonly scheduleTransportRequest: ScheduleTransportRequestUseCase;
  readonly bookTransportOrder: BookTransportOrderUseCase;
  readonly applyTransportStatus: ApplyTransportStatusUseCase;
  readonly composeTransportOffer: ComposeTransportOfferUseCase;
  readonly claimTransportTrip: ClaimTransportTripUseCase;
  readonly reportTripProgress: ReportTripProgressUseCase;
  readonly verifyHandoverPin: VerifyHandoverPinUseCase;
  readonly createDriver: CreateDriverUseCase;
  readonly suspendDriver: SuspendDriverUseCase;
  readonly reactivateDriver: ReactivateDriverUseCase;
  readonly reassignDriver: ReassignDriverUseCase;
  readonly deleteDriver: DeleteDriverUseCase;
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
  /** Driver session tokens — same machinery, issuer `fulfilgo-drive`. */
  readonly driverTokenService: PickerTokenService;
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
  /** Driver app login (staff code + PIN → depot-scoped session token). */
  readonly driverAuth: DriverAuthService;
  /** Ownership-stamp → coordinator module (docs/process-definitions.md). */
  readonly processRegistry: ProcessRegistry;
  /** Router service client — null when unconfigured (planning features off). */
  readonly router: RouterClient | null;
  /**
   * Platform API client (service account) — client registry lookups for the
   * management chrome. Null when the FLOWCATALYST_* creds are unset.
   */
  readonly platform: FlowCatalystClient | null;
  /** Started by server.ts on boot; routes nudge it after successful writes. */
  readonly sseBroker: SseBroker;
  /**
   * Resolved PICK settings for one store — client bagSpecs as the base
   * layer under the pick profiles (docs/bag-sizing.md). Used by completion
   * stamping and the station-settings endpoint.
   */
  readonly pickSettingsForStore: (
    clientId: string,
    storeRef: string,
  ) => Promise<ResolvedPickStoreSettings>;
  /** Client-scoped blob store (POD photos) — driver selected by config. */
  readonly blobStore: ScopedBlobStore;
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
  /**
   * EPOD (Integral) integration client config — null when
   * FULFILGO_EPOD_BASE_URL / FULFILGO_EPOD_TENANT_CODE (or the platform
   * service-account creds) are unset; provisioning then logs + skips.
   */
  readonly epod: EpodClientConfig | null;
  /**
   * Uber Direct adapter config — null when the FULFILGO_UBER_* creds are
   * unset; 'uber' then simply isn't a registered provider.
   */
  readonly uber: UberAdapterConfig | null;
  /**
   * Router service (VROOM/OSRM — planning + map legs) — null when the
   * FULFILGO_ROUTER_* creds are unset.
   */
  readonly router: RouterClientConfig | null;
  /** Platform API creds (FLOWCATALYST_URL + API client) — null when unset. */
  readonly platformApi: {
    readonly baseUrl: string;
    readonly clientId: string;
    readonly clientSecret: string;
  } | null;
  /** Blob driver config: 'db' (default) or 's3://bucket/prefix'. */
  readonly blobStoreUrl?: string | undefined;
}

export async function createAppContext(config: AppContextConfig): Promise<AppContext> {
  const { db, clientId } = config;

  const transactionManager = createTransactionManager(db);

  const aggregateRegistry = createAggregateRegistry({
    [FULFILMENT_ID_PREFIX]: FULFILMENT_TYPE,
    [PICKER_USER_ID_PREFIX]: PICKER_USER_TYPE,
    [PICK_ID_PREFIX]: PICK_TYPE,
    [TRANSPORT_ORDER_ID_PREFIX]: TRANSPORT_ORDER_TYPE,
    [TRIP_ID_PREFIX]: TRIP_TYPE,
    [DRIVER_USER_ID_PREFIX]: DRIVER_USER_TYPE,
  });

  const syncEventRepo = createDrizzleSyncEventRepository(db);
  const telemetryRepo = createDrizzleTelemetryRepository(db);
  const idempotencyRepo = createDrizzleIdempotencyRepository(db);

  const fulfilmentRepo = createDrizzleFulfilmentRepository(db);
  const activityLogRepo = createDrizzleActivityLogRepository(db);
  const shortIdAllocator = createShortIdAllocator(db);
  const pickerUserRepo = createDrizzlePickerUserRepository(db);
  const storeRepo = createDrizzleStoreRepository(db);
  const pickRepo = createDrizzlePickRepository(db);
  const printerRepo = createDrizzlePrinterRepository(db);
  const clientSettingsRepo = createDrizzleClientSettingsRepository(db);
  const processRegistry = createProcessRegistry([standardDefinition]);
  const transportOrderRepo = createDrizzleTransportOrderRepository(db);
  const processReactionRepo = createDrizzleProcessReactionRepository(db);
  const transportPositionRepo = createDrizzleTransportPositionRepository(db);
  const tripRepo = createDrizzleTripRepository(db);
  const driverUserRepo = createDrizzleDriverUserRepository(db);
  const depotRepo = createDrizzleDepotRepository(db);
  const routerClient = config.router ? createRouterClient(config.router) : null;
  // ONE EPOD client (token cache shared by provisioning + the claim flow).
  const epodClient = config.epod ? createEpodClient(config.epod) : null;
  const platformClient = config.platformApi ? new FlowCatalystClient(config.platformApi) : null;

  // Transport provider registry: our-planned channels are always available;
  // 'uber' registers only when credentials are configured.
  const providerChannels: ProviderChannel[] = [OWN_CHANNEL, EPOD_CHANNEL];
  if (config.uber) {
    const uberAdapter = createUberAdapter(config.uber);
    providerChannels.push({
      code: uberAdapter.code,
      kind: 'provider-planned',
      capabilities: uberAdapter.capabilities,
      adapter: uberAdapter,
    });
  }
  const providerRegistry: ProviderRegistry = createProviderRegistry(providerChannels);

  registerFulfilment(aggregateRegistry, fulfilmentRepo);
  registerPickerUser(aggregateRegistry, pickerUserRepo);
  registerPick(aggregateRegistry, pickRepo);
  registerTransportOrder(aggregateRegistry, transportOrderRepo);
  registerTrip(aggregateRegistry, tripRepo);
  registerDriverUser(aggregateRegistry, driverUserRepo);

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
  // Same signing machinery, distinct issuer — extractRequestToken routes a
  // driver token to the driver verifier and stamps driver attributes.
  const driverAuthConfig = { ...config.auth.picker, issuer: 'fulfilgo-drive' };
  const driverTokenService = createPickerTokenService(driverAuthConfig);
  const driverAuthService = createDriverAuthService(
    driverUserRepo,
    driverTokenService,
    driverAuthConfig,
  );
  const pickerAuthService = createPickerAuthService(
    pickerUserRepo,
    pickerTokenService,
    config.auth.picker,
  );

  const sseBroker = createSseBroker(syncEventRepo, console);
  // pick_sessions projection (docs/projections.md) — rides the pick txs.
  const pickSessionProjection = createPickSessionProjection(db);

  // Blob store (POD photos) — driver from config: db locally, S3 deployed.
  const blobStore = createBlobStore(db, config.blobStoreUrl);

  // Bag catalog + construction map, resolved per store: client bagSpecs as
  // the base layer under the pick profiles (docs/bag-sizing.md).
  const pickSettingsForStore = async (cId: string, storeRef: string) => {
    const client = resolveClientSettings(await clientSettingsRepo.get(cId));
    const resolver = await loadPickSettingsResolver(db, cId, [storeRef], {
      bagSpecs: client.bagSpecs,
    });
    return resolver.resolve(storeRef);
  };

  return {
    db,
    transactionManager,
    aggregateRegistry,
    repositories: {
      fulfilments: fulfilmentRepo,
      activityLog: activityLogRepo,
      shortIds: shortIdAllocator,
      syncEvents: syncEventRepo,
      telemetry: telemetryRepo,
      idempotency: idempotencyRepo,
      pickerUsers: pickerUserRepo,
      stores: storeRepo,
      picks: pickRepo,
      printers: printerRepo,
      clientSettings: clientSettingsRepo,
      transportOrders: transportOrderRepo,
      processReactions: processReactionRepo,
      transportPositions: transportPositionRepo,
      trips: tripRepo,
      driverUsers: driverUserRepo,
      depots: depotRepo,
    },
    useCases: {
      createFulfilment: new CreateFulfilmentUseCase(
        uow,
        aggregateRegistry,
        fulfilmentRepo,
        shortIdAllocator,
        activityLogRepo,
        // Lead-time hydration from store profiles (only consulted when the
        // command doesn't carry pickLeadTimeMinutes — explicit values win).
        async (cId, storeRef, type) => {
          const resolver = await loadPickSettingsResolver(db, cId, [storeRef]);
          const settings = resolver.resolve(storeRef);
          return type === 'delivery'
            ? settings.pickLeadTimeMinutesDelivery
            : settings.pickLeadTimeMinutesCollect;
        },
        // Ownership stamps (docs/process-definitions.md + handover-
        // verification.md): the client's settings, resolved once at creation.
        async (cId) => resolveClientSettings(await clientSettingsRepo.get(cId)),
      ),
      cancelFulfilment: new CancelFulfilmentUseCase(
        uow,
        aggregateRegistry,
        fulfilmentRepo,
        activityLogRepo,
      ),
      releasePartForPick: new ReleasePartForPickUseCase(
        uow,
        aggregateRegistry,
        fulfilmentRepo,
        activityLogRepo,
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
        activityLogRepo,
        syncEventRepo,
        pickSessionProjection,
        // Sort-algorithm hydration from store profiles, captured onto the
        // pick at intake (same shape as create-fulfilment's lead times).
        // loadPickSettingsResolver joins the ambient tx — pool-safe here.
        async (cId, storeRef) => {
          const resolver = await loadPickSettingsResolver(db, cId, [storeRef]);
          return resolver.resolve(storeRef).pickSortAlgorithm;
        },
      ),
      claimPick: new ClaimPickUseCase(
        uow,
        aggregateRegistry,
        pickRepo,
        activityLogRepo,
        syncEventRepo,
        pickSessionProjection,
      ),
      flagPickVehicle: new FlagPickVehicleUseCase(
        uow,
        aggregateRegistry,
        pickRepo,
        activityLogRepo,
        syncEventRepo,
      ),
      completePick: new CompletePickUseCase(
        uow,
        aggregateRegistry,
        pickRepo,
        activityLogRepo,
        syncEventRepo,
        pickSessionProjection,
        pickSettingsForStore,
      ),
      failPick: new FailPickUseCase(
        uow,
        aggregateRegistry,
        pickRepo,
        activityLogRepo,
        syncEventRepo,
        pickSessionProjection,
      ),
      allocatePickLabels: new AllocatePickLabelsUseCase(
        uow,
        aggregateRegistry,
        pickRepo,
        printerRepo,
        activityLogRepo,
        pickSessionProjection,
      ),
      reprintPickLabel: new ReprintPickLabelUseCase(
        uow,
        aggregateRegistry,
        pickRepo,
        printerRepo,
        activityLogRepo,
        pickSessionProjection,
      ),
      registerPartPicking: new RegisterPartPickingUseCase(
        uow,
        aggregateRegistry,
        fulfilmentRepo,
        activityLogRepo,
      ),
      registerPartPicked: new RegisterPartPickedUseCase(
        uow,
        aggregateRegistry,
        fulfilmentRepo,
        activityLogRepo,
      ),
      registerPartCarFlag: new RegisterPartCarFlagUseCase(
        uow,
        aggregateRegistry,
        fulfilmentRepo,
        transportOrderRepo,
        activityLogRepo,
      ),
      registerPartFailed: new RegisterPartFailedUseCase(
        uow,
        aggregateRegistry,
        fulfilmentRepo,
        activityLogRepo,
      ),
      registerPartDelivery: new RegisterPartDeliveryUseCase(
        uow,
        aggregateRegistry,
        fulfilmentRepo,
        activityLogRepo,
      ),
      requestEpodProvisioning: new RequestEpodProvisioningUseCase(
        uow,
        db,
        fulfilmentRepo,
        activityLogRepo,
        outboxManager,
        { publicBaseUrl: config.publicBaseUrl, dispatchPoolCode: config.dispatchPoolCode },
      ),
      provisionEpod: new ProvisionEpodUseCase(fulfilmentRepo, activityLogRepo, epodClient),
      requestTransport: new RequestTransportUseCase(
        uow,
        aggregateRegistry,
        db,
        fulfilmentRepo,
        transportOrderRepo,
        storeRepo,
        activityLogRepo,
        providerRegistry,
        outboxManager,
        { publicBaseUrl: config.publicBaseUrl, dispatchPoolCode: config.dispatchPoolCode },
      ),
      scheduleTransportRequest: new ScheduleTransportRequestUseCase(
        uow,
        db,
        fulfilmentRepo,
        processReactionRepo,
        activityLogRepo,
      ),
      bookTransportOrder: new BookTransportOrderUseCase(
        uow,
        aggregateRegistry,
        transportOrderRepo,
        activityLogRepo,
        providerRegistry,
        runWrite,
        // Provider entry configs (sizeMap overrides) for the origin store.
        async (cId, storeRef) =>
          (await loadTransportSettingsResolver(db, cId, [storeRef])).resolve(storeRef),
      ),
      applyTransportStatus: new ApplyTransportStatusUseCase(
        uow,
        aggregateRegistry,
        transportOrderRepo,
        activityLogRepo,
      ),
      composeTransportOffer: new ComposeTransportOfferUseCase(
        uow,
        aggregateRegistry,
        db,
        transportOrderRepo,
        tripRepo,
        storeRepo,
        depotRepo,
        clientSettingsRepo,
        activityLogRepo,
        routerClient,
        runWrite,
      ),
      claimTransportTrip: new ClaimTransportTripUseCase(
        uow,
        aggregateRegistry,
        db,
        tripRepo,
        transportOrderRepo,
        fulfilmentRepo,
        activityLogRepo,
        epodClient,
        { tenantCode: config.epod?.tenantCode ?? null },
        runWrite,
      ),
      reportTripProgress: new ReportTripProgressUseCase(
        uow,
        aggregateRegistry,
        tripRepo,
        transportOrderRepo,
        fulfilmentRepo,
        activityLogRepo,
      ),
      verifyHandoverPin: new VerifyHandoverPinUseCase(
        tripRepo,
        transportOrderRepo,
        fulfilmentRepo,
        activityLogRepo,
      ),
      createDriver: new CreateDriverUseCase(uow, aggregateRegistry, driverUserRepo, depotRepo),
      suspendDriver: new SuspendDriverUseCase(uow, aggregateRegistry, driverUserRepo),
      reactivateDriver: new ReactivateDriverUseCase(uow, aggregateRegistry, driverUserRepo),
      reassignDriver: new ReassignDriverUseCase(uow, aggregateRegistry, driverUserRepo, depotRepo),
      deleteDriver: new DeleteDriverUseCase(uow, aggregateRegistry, driverUserRepo),
    },
    auth: {
      config: config.auth,
      tokenValidator,
      oidcBroker,
      pickerTokenService,
      driverTokenService,
    },
    pickAuth: pickerAuthService,
    driverAuth: driverAuthService,
    processRegistry,
    router: routerClient,
    platform: platformClient,
    sseBroker,
    pickSettingsForStore,
    blobStore,
    runWrite,
  };
}
