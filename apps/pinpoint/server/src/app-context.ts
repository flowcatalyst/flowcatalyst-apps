import { Effect, Layer, ManagedRuntime, Result } from 'effect';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import {
  AggregateRegistry,
  aggregateRegistryLayer,
  buildOutboxManager,
  createAggregateRegistry,
  createPlainUnitOfWork,
  createTransactionManager,
  DispatchJobBroker,
  dispatchJobBrokerLayer,
  TransactionStore,
  unitOfWorkLayer,
  type AggregateRegistryImpl,
  type Scope,
  type TransactionManager,
} from '@pinpoint/framework';
import type { UnitOfWork, UseCaseError } from '@pinpoint/framework';
// Non-Effect surface — pinpoint is migrating off Effect. Both surfaces ride
// the same OutboxManager + ALS tx, so converted and not-yet-converted use
// cases live happily side-by-side until the sweep finishes.
import type { Result as PlainResult, UnitOfWork as PlainUnitOfWork } from '@pinpoint/framework/plain';
import { createDrizzlePrincipalRepository } from './infrastructure/principal-repository.js';
import { createDrizzleCountryRepository } from './infrastructure/country-repository.js';
import { createDrizzleClientRepository } from './infrastructure/client-repository.js';
import { createDrizzlePartitionRepository } from './infrastructure/partition-repository.js';
import { createDrizzleLocationRepository } from './infrastructure/location-repository.js';
import { createDrizzleLayerRepository } from './infrastructure/layer-repository.js';
import { createDrizzleLayerFeatureRepository } from './infrastructure/layer-feature-repository.js';
import { createDrizzlePropertySetRepository } from './infrastructure/property-set-repository.js';
import { createDrizzleMatchingConfigRepository } from './infrastructure/matching-config-repository.js';
import { createDrizzleMasterLocationRepository } from './infrastructure/master-location-repository.js';
import { createDrizzleProcessingLogRepository } from './infrastructure/processing-log-repository.js';
import { createDrizzleLocationAttributeRepository } from './infrastructure/location-attribute-repository.js';
import { createPhotonGeocoder } from './infrastructure/services/photon-geocoder.js';
import { createRateLimitedGeocoder } from './infrastructure/services/rate-limited-geocoder.js';
import { createNoopVerifier } from './infrastructure/services/noop-verifier.js';
import { createBedrockVerifier } from './infrastructure/services/bedrock-verifier.js';
import { createOllamaVerifier } from './infrastructure/services/ollama-verifier.js';
import { createLibPostalNormalizer } from './infrastructure/services/libpostal-normalizer.js';
import { createOidcClient, type OidcClient } from './auth/oidc-client.js';
import { createTokenValidator, type TokenValidator } from './auth/token-validator.js';
import { createInMemorySessionStore, type SessionStore } from './auth/session-store.js';
import { createRedisSessionStore } from './auth/session-store-redis.js';
import { createDrizzleSessionStore } from './auth/session-store-drizzle.js';
import type { AuthConfig, SessionConfig } from './auth/auth-config.js';
import { registerClient } from './infrastructure/register-client.js';
import { registerPartition } from './infrastructure/register-partition.js';
import { registerLocation } from './infrastructure/register-location.js';
import { registerLayer } from './infrastructure/register-layer.js';
import { registerLayerFeature } from './infrastructure/register-layer-feature.js';
import { registerPropertySet } from './infrastructure/register-property-set.js';
import { registerMatchingConfig } from './infrastructure/register-matching-config.js';
import { registerMasterLocation } from './infrastructure/register-master-location.js';
import { CLIENT_ID_PREFIX, PARTITION_ID_PREFIX } from './domain/tenancy/ids.js';
import { CLIENT_TYPE } from './domain/tenancy/client.js';
import { PARTITION_TYPE } from './domain/tenancy/partition.js';
import { LOCATION_ID_PREFIX, MASTER_LOCATION_ID_PREFIX } from './domain/locations/ids.js';
import { LOCATION_TYPE } from './domain/locations/location.js';
import { MASTER_LOCATION_TYPE } from './domain/locations/master-location.js';
import {
  LAYER_ID_PREFIX,
  LAYER_FEATURE_ID_PREFIX,
  PROPERTY_SET_ID_PREFIX,
} from './domain/layers/ids.js';
import { LAYER_TYPE } from './domain/layers/layer.js';
import { LAYER_FEATURE_TYPE } from './domain/layers/layer-feature.js';
import { PROPERTY_SET_TYPE } from './domain/layers/property-set.js';
import { MATCHING_CONFIG_ID_PREFIX } from './domain/matching/ids.js';
import { MATCHING_CONFIG_TYPE } from './domain/matching/matching-config.js';
import { Principals, type PrincipalRepository } from './domain/auth/principal.repository.js';
import { Countries, type CountryRepository } from './domain/reference/country.repository.js';
import { Clients, type ClientRepository } from './domain/tenancy/client.repository.js';
import { Partitions, type PartitionRepository } from './domain/tenancy/partition.repository.js';
import { Locations, type LocationRepository } from './domain/locations/location.repository.js';
import { Layers, type LayerRepository } from './domain/layers/layer.repository.js';
import {
  LayerFeatures,
  type LayerFeatureRepository,
} from './domain/layers/layer-feature.repository.js';
import {
  PropertySets,
  type PropertySetRepository,
} from './domain/layers/property-set.repository.js';
import {
  MatchingConfigs,
  type MatchingConfigRepository,
} from './domain/matching/matching-config.repository.js';
import {
  MasterLocations,
  type MasterLocationRepository,
} from './domain/locations/master-location.repository.js';
import {
  ProcessingLogs,
  type ProcessingLogRepository,
} from './domain/locations/processing-log.repository.js';
import {
  LocationAttributes,
  type LocationAttributeRepository,
} from './domain/locations/location-attribute.repository.js';
import type { GeocoderService } from './domain/services/geocoder.js';
import type { AddressVerifier } from './domain/services/address-verifier.js';
import type { AddressNormalizer } from './domain/services/address-normalizer.js';
import { CreateClientUseCase } from './operations/create-client/create-client.use-case.js';
import { UpdateClientUseCase } from './operations/update-client/update-client.use-case.js';
import { DeleteClientUseCase } from './operations/delete-client/delete-client.use-case.js';
import { CreatePartitionUseCase } from './operations/create-partition/create-partition.use-case.js';
import { UpdatePartitionUseCase } from './operations/update-partition/update-partition.use-case.js';
import { DeletePartitionUseCase } from './operations/delete-partition/delete-partition.use-case.js';
import { CreateLocationUseCase } from './operations/create-location/create-location.use-case.js';
import { CreateLayerUseCase } from './operations/create-layer/create-layer.use-case.js';
import { UpdateLayerUseCase } from './operations/update-layer/update-layer.use-case.js';
import { DeleteLayerUseCase } from './operations/delete-layer/delete-layer.use-case.js';
import { CreateLayerFeatureUseCase } from './operations/create-layer-feature/create-layer-feature.use-case.js';
import { UpdateLayerFeatureUseCase } from './operations/update-layer-feature/update-layer-feature.use-case.js';
import { DeleteLayerFeatureUseCase } from './operations/delete-layer-feature/delete-layer-feature.use-case.js';
import { CreatePropertySetUseCase } from './operations/create-property-set/create-property-set.use-case.js';
import { UpdatePropertySetUseCase } from './operations/update-property-set/update-property-set.use-case.js';
import { DeletePropertySetUseCase } from './operations/delete-property-set/delete-property-set.use-case.js';
import { ReplacePropertySetPropertiesUseCase } from './operations/replace-property-set-properties/replace-property-set-properties.use-case.js';
import { UpdateMatchingConfigUseCase } from './operations/update-matching-config/update-matching-config.use-case.js';
import { ValidateMasterLocationUseCase } from './operations/validate-master-location/validate-master-location.use-case.js';
import { ConfirmMasterLocationUseCase } from './operations/confirm-master-location/confirm-master-location.use-case.js';
import { UpdateMasterLocationUseCase } from './operations/update-master-location/update-master-location.use-case.js';
import { RejectMasterLocationUseCase } from './operations/reject-master-location/reject-master-location.use-case.js';

/**
 * Composition root for the pinpoint server. Wires the repository graph, the
 * `UnitOfWork` / `DispatchJobBroker` / `AggregateRegistry` Layers, and the
 * `runWrite` boundary runner that opens a Drizzle tx, binds it on ALS, and
 * drains the Effect.
 *
 * One `OutboxManager` is built here and shared by both UoW and DispatchJobBroker
 * so events, audit logs, and dispatch jobs all ride the same `TransactionStore`-
 * bound Drizzle tx. As use-case slices land they get registered into the
 * `useCases` block and their repositories into `aggregateRegistry`.
 *
 * Keep this file dumb — wiring only, no business logic.
 */
export interface AppContextRepositories {
  readonly principals: PrincipalRepository;
  readonly countries: CountryRepository;
  readonly clients: ClientRepository;
  readonly partitions: PartitionRepository;
  readonly locations: LocationRepository;
  readonly layers: LayerRepository;
  readonly layerFeatures: LayerFeatureRepository;
  readonly propertySets: PropertySetRepository;
  readonly matchingConfigs: MatchingConfigRepository;
  readonly masterLocations: MasterLocationRepository;
  readonly processingLog: ProcessingLogRepository;
  readonly locationAttributes: LocationAttributeRepository;
}

export interface AppContextServices {
  readonly geocoder: GeocoderService;
  readonly addressVerifier: AddressVerifier;
  readonly addressNormalizer: AddressNormalizer;
}

/**
 * Auth surface — null when no OIDC issuer is configured (local dev with
 * `PINPOINT_AUTH_DEV_FALLBACK=true` still works in that mode). When set,
 * the auth routes + the request-token extractor use it.
 */
export interface AppContextAuth {
  readonly config: AuthConfig;
  readonly oidcClient: OidcClient | null;
  readonly tokenValidator: TokenValidator | null;
  readonly sessionStore: SessionStore;
}

/**
 * LLM provider config for the address verifier. Mirrors the Rust
 * `llm_provider`/`ollama_url`/`llm_model` env vars; defaults to `'none'`
 * (Noop) so the matching pipeline runs without Bedrock creds or a local
 * Ollama instance.
 */
export type AddressVerifierConfig =
  | { readonly provider: 'none' }
  | {
      readonly provider: 'bedrock';
      /** Bedrock model id, e.g. `anthropic.claude-3-haiku-20240307-v1:0`. */
      readonly model: string;
      /** AWS region. Falls back to AWS_REGION env, then us-east-1. */
      readonly region?: string;
    }
  | {
      readonly provider: 'ollama';
      /** Base URL of the Ollama server, e.g. `http://localhost:11434`. */
      readonly baseUrl: string;
      /** Model tag, e.g. `gemma3` (Rust default). */
      readonly model: string;
    };

export interface AppContextUseCases {
  readonly createClient: CreateClientUseCase;
  readonly updateClient: UpdateClientUseCase;
  readonly deleteClient: DeleteClientUseCase;
  readonly createPartition: CreatePartitionUseCase;
  readonly updatePartition: UpdatePartitionUseCase;
  readonly deletePartition: DeletePartitionUseCase;
  readonly createLocation: CreateLocationUseCase;
  readonly createLayer: CreateLayerUseCase;
  readonly updateLayer: UpdateLayerUseCase;
  readonly deleteLayer: DeleteLayerUseCase;
  readonly createLayerFeature: CreateLayerFeatureUseCase;
  readonly updateLayerFeature: UpdateLayerFeatureUseCase;
  readonly deleteLayerFeature: DeleteLayerFeatureUseCase;
  readonly createPropertySet: CreatePropertySetUseCase;
  readonly updatePropertySet: UpdatePropertySetUseCase;
  readonly deletePropertySet: DeletePropertySetUseCase;
  readonly replacePropertySetProperties: ReplacePropertySetPropertiesUseCase;
  readonly updateMatchingConfig: UpdateMatchingConfigUseCase;
  readonly validateMasterLocation: ValidateMasterLocationUseCase;
  readonly confirmMasterLocation: ConfirmMasterLocationUseCase;
  readonly updateMasterLocation: UpdateMasterLocationUseCase;
  readonly rejectMasterLocation: RejectMasterLocationUseCase;
}

export interface AppContext {
  readonly db: PostgresJsDatabase;
  readonly transactionManager: TransactionManager;
  readonly aggregateRegistry: AggregateRegistryImpl;
  readonly repositories: AppContextRepositories;
  readonly services: AppContextServices;
  readonly useCases: AppContextUseCases;
  readonly auth: AppContextAuth;
  /**
   * Run a use-case Effect inside a Drizzle transaction. Provides
   * `UnitOfWork`, `DispatchJobBroker`, and `AggregateRegistry` Layers,
   * collapses the error channel via `Effect.result`, and returns the
   * resulting `Result<A, E>` as a Promise.
   *
   * Identity comes from `ScopeStore` (ALS); the program reads it directly
   * via `ScopeStore.require()` rather than through an Effect Tag.
   */
  readonly runWrite: <A>(
    program: Effect.Effect<A, UseCaseError, UseCaseRequirements>,
    scope: Scope,
  ) => Promise<Result.Result<A, UseCaseError>>;
  /**
   * Plain async/await boundary for use cases that have been migrated off
   * Effect. Opens a Drizzle tx, binds it on ALS via `TransactionStore`, and
   * invokes the thunk inside the tx — the thunk's `Result.failure(...)` is
   * returned as-is (no rollback for business errors; nothing was written),
   * and a thrown exception triggers rollback.
   *
   * Identity comes from the surrounding `ScopeStore.run(scope, ...)` (set by
   * the route boundary), same as the Effect path.
   */
  readonly runWritePlain: <A>(
    thunk: () => Promise<PlainResult<A>>,
  ) => Promise<PlainResult<A>>;
}

/**
 * The full Effect requirement set that `runWrite` provides. Every use
 * case's `execute` Effect needs at most this union — `UnitOfWork`,
 * `DispatchJobBroker`, `AggregateRegistry`, plus every repo Tag. The
 * alias keeps individual use-case signatures readable.
 */
export type UseCaseRequirements =
  | UnitOfWork
  | DispatchJobBroker
  | AggregateRegistry
  | Clients
  | Partitions
  | Principals
  | Countries
  | Locations
  | LocationAttributes
  | MasterLocations
  | ProcessingLogs
  | Layers
  | LayerFeatures
  | PropertySets
  | MatchingConfigs;

export interface AppContextConfig {
  readonly db: PostgresJsDatabase;
  /** FlowCatalyst client id — used by the outbox driver for message routing. */
  readonly clientId: string;
  /** Public base URL of this pinpoint instance — used by reactors to construct dispatch-job targets. */
  readonly publicBaseUrl: string;
  /** Dispatch-pool code used by pinpoint-emitted dispatch jobs. */
  readonly dispatchPoolCode: string;
  /** Geocoder base URL (e.g. `https://photon.komoot.io`). Photon-compatible. */
  readonly geocodingApiUrl: string;
  /** Sustained geocoder request rate (requests / second) — used by the rate-limited decorator. */
  readonly geocodingRateLimit: number;
  /** LLM-backed address-verifier configuration. Default Noop keeps the matching pipeline cred-free. */
  readonly addressVerifier: AddressVerifierConfig;
  /** Base URL of the libpostal sidecar (`pelias/libpostal-service`). Default `http://localhost:4400`. */
  readonly libpostalUrl: string;
  /**
   * Auth wiring. When `oidc` is set, the auth routes go live and the
   * request-token extractor validates JWTs / session cookies. The
   * dev-fallback flag opts the `x-user-id` header path back on for local
   * dev; should be false in production.
   */
  readonly auth: AuthConfig;
}

export async function createAppContext(config: AppContextConfig): Promise<AppContext> {
  const { db, clientId } = config;

  const transactionManager = createTransactionManager(db);

  // Prefix-map lets plain-object aggregates resolve to the correct repository
  // handler at persist time. Principals carry an OIDC-shaped id (no TSID
  // prefix), so they don't register here.
  const aggregateRegistry = createAggregateRegistry({
    [CLIENT_ID_PREFIX]: CLIENT_TYPE,
    [PARTITION_ID_PREFIX]: PARTITION_TYPE,
    [LOCATION_ID_PREFIX]: LOCATION_TYPE,
    [LAYER_ID_PREFIX]: LAYER_TYPE,
    [LAYER_FEATURE_ID_PREFIX]: LAYER_FEATURE_TYPE,
    [PROPERTY_SET_ID_PREFIX]: PROPERTY_SET_TYPE,
    [MATCHING_CONFIG_ID_PREFIX]: MATCHING_CONFIG_TYPE,
    [MASTER_LOCATION_ID_PREFIX]: MASTER_LOCATION_TYPE,
  });

  const principalRepo = createDrizzlePrincipalRepository(db);
  const countryRepo = createDrizzleCountryRepository(db);
  const clientRepo = createDrizzleClientRepository(db);
  const partitionRepo = createDrizzlePartitionRepository(db);
  const locationRepo = createDrizzleLocationRepository(db);
  const layerRepo = createDrizzleLayerRepository(db);
  const layerFeatureRepo = createDrizzleLayerFeatureRepository(db);
  const propertySetRepo = createDrizzlePropertySetRepository(db);
  const matchingConfigRepo = createDrizzleMatchingConfigRepository(db);
  const masterLocationRepo = createDrizzleMasterLocationRepository(db);
  const processingLogRepo = createDrizzleProcessingLogRepository(db);
  const locationAttributeRepo = createDrizzleLocationAttributeRepository(db);

  const rawGeocoder = createPhotonGeocoder({ baseUrl: config.geocodingApiUrl });
  const geocoder = createRateLimitedGeocoder(rawGeocoder, {
    requestsPerSecond: config.geocodingRateLimit,
  });
  const addressVerifier = buildAddressVerifier(config.addressVerifier);
  const addressNormalizer = createLibPostalNormalizer({ baseUrl: config.libpostalUrl });
  console.info(`[address-normalizer] provider=libpostal baseUrl=${config.libpostalUrl}`);
  registerClient(aggregateRegistry, clientRepo);
  registerPartition(aggregateRegistry, partitionRepo);
  registerLocation(aggregateRegistry, locationRepo);
  registerLayer(aggregateRegistry, layerRepo);
  registerLayerFeature(aggregateRegistry, layerFeatureRepo);
  registerPropertySet(aggregateRegistry, propertySetRepo);
  registerMatchingConfig(aggregateRegistry, matchingConfigRepo);
  registerMasterLocation(aggregateRegistry, masterLocationRepo);

  // One OutboxManager backs both UoW and DispatchJobBroker.
  const outboxManager = buildOutboxManager({ clientId });

  // Repo Tags. Every use case yields these from the Effect environment
  // instead of receiving the underlying Promise repo via constructor
  // injection. Each Tag wraps its Promise port once at the boundary
  // (see <repo>.repository.ts → `XTag.layer(port)`), so call sites
  // get pre-typed `Effect<T, InfrastructureError>` and skip per-call
  // `Effect.tryPromise` boilerplate.
  const repoLayer = Layer.mergeAll(
    Clients.layer(clientRepo),
    Partitions.layer(partitionRepo),
    Principals.layer(principalRepo),
    Countries.layer(countryRepo),
    Locations.layer(locationRepo),
    LocationAttributes.layer(locationAttributeRepo),
    MasterLocations.layer(masterLocationRepo),
    ProcessingLogs.layer(processingLogRepo),
    Layers.layer(layerRepo),
    LayerFeatures.layer(layerFeatureRepo),
    PropertySets.layer(propertySetRepo),
    MatchingConfigs.layer(matchingConfigRepo),
  );

  const baseLayer = Layer.mergeAll(
    unitOfWorkLayer(outboxManager),
    dispatchJobBrokerLayer(outboxManager),
    aggregateRegistryLayer(aggregateRegistry),
    repoLayer,
  );
  const runtime = ManagedRuntime.make(baseLayer);

  const runWrite = async <A>(
    program: Effect.Effect<A, UseCaseError, UseCaseRequirements>,
    _scope: Scope,
  ): Promise<Result.Result<A, UseCaseError>> => {
    const collected = Effect.result(program);
    return transactionManager.inTransaction((tx) =>
      TransactionStore.run(tx, () => runtime.runPromise(collected)),
    );
  };

  // Non-Effect UoW shares the OutboxManager with the Effect path, so events
  // emitted by converted use cases ride the same outbox table + the same
  // ALS-bound Drizzle tx.
  const plainUow: PlainUnitOfWork = createPlainUnitOfWork(outboxManager);

  const runWritePlain = async <A>(
    thunk: () => Promise<PlainResult<A>>,
  ): Promise<PlainResult<A>> =>
    transactionManager.inTransaction((tx) => TransactionStore.run(tx, thunk));

  // Build auth services lazily: OIDC discovery is only attempted when the
  // issuer is configured, so a no-IdP local dev run with the dev fallback
  // still boots fine. Discovery failures throw — startup blocks on the
  // IdP being reachable, matching the Rust pinpoint's behaviour.
  const sessionStore = await buildSessionStore(config.auth.session, db);
  const oidcClient = config.auth.oidc !== null ? await createOidcClient(config.auth.oidc) : null;
  const tokenValidator =
    config.auth.oidc !== null ? createTokenValidator(config.auth.oidc) : null;

  return {
    db,
    transactionManager,
    aggregateRegistry,
    repositories: {
      principals: principalRepo,
      countries: countryRepo,
      clients: clientRepo,
      partitions: partitionRepo,
      locations: locationRepo,
      layers: layerRepo,
      layerFeatures: layerFeatureRepo,
      propertySets: propertySetRepo,
      matchingConfigs: matchingConfigRepo,
      masterLocations: masterLocationRepo,
      processingLog: processingLogRepo,
      locationAttributes: locationAttributeRepo,
    },
    services: {
      geocoder,
      addressVerifier,
      addressNormalizer,
    },
    useCases: {
      // Effect-based use cases yield their repo deps from the Effect
      // environment (see the `repoLayer` above) and use an empty constructor.
      // Migrated use cases take their deps (uow, registry, repos) via
      // constructor injection — `createClient` is the first one converted.
      createClient: new CreateClientUseCase(plainUow, aggregateRegistry, clientRepo),
      updateClient: new UpdateClientUseCase(),
      deleteClient: new DeleteClientUseCase(),
      createPartition: new CreatePartitionUseCase(),
      updatePartition: new UpdatePartitionUseCase(),
      deletePartition: new DeletePartitionUseCase(),
      // create-location keeps the two service deps (libpostal,
      // LLM verifier) via constructor; all 8 repo deps come from the
      // Effect environment via Tags.
      createLocation: new CreateLocationUseCase(addressNormalizer, addressVerifier),
      createLayer: new CreateLayerUseCase(),
      updateLayer: new UpdateLayerUseCase(),
      deleteLayer: new DeleteLayerUseCase(),
      createLayerFeature: new CreateLayerFeatureUseCase(),
      updateLayerFeature: new UpdateLayerFeatureUseCase(),
      deleteLayerFeature: new DeleteLayerFeatureUseCase(),
      createPropertySet: new CreatePropertySetUseCase(),
      updatePropertySet: new UpdatePropertySetUseCase(),
      deletePropertySet: new DeletePropertySetUseCase(),
      replacePropertySetProperties: new ReplacePropertySetPropertiesUseCase(),
      updateMatchingConfig: new UpdateMatchingConfigUseCase(),
      // ValidateMasterLocationUseCase still injects the geocoder (an
      // external service, not a DB repo). Repo deps come from the
      // Effect environment.
      validateMasterLocation: new ValidateMasterLocationUseCase(geocoder),
      confirmMasterLocation: new ConfirmMasterLocationUseCase(),
      updateMasterLocation: new UpdateMasterLocationUseCase(),
      rejectMasterLocation: new RejectMasterLocationUseCase(),
    },
    auth: {
      config: config.auth,
      oidcClient,
      tokenValidator,
      sessionStore,
    },
    runWrite,
    runWritePlain,
  };
}

/**
 * Build the configured session store. Driver selection is env-driven via
 * `PINPOINT_SESSION_DRIVER` (`memory` / `redis` / `postgres`). The Redis
 * driver lazily imports `ioredis` so the dep isn't required for memory or
 * postgres deploys.
 */
async function buildSessionStore(
  config: SessionConfig,
  db: PostgresJsDatabase,
): Promise<SessionStore> {
  switch (config.driver) {
    case 'redis': {
      // Should have been validated at config load; defensive.
      if (config.redisUrl === null) {
        throw new Error('PINPOINT_SESSION_DRIVER=redis requires PINPOINT_SESSION_REDIS_URL.');
      }
      const { Redis } = await import('ioredis');
      const client = new Redis(config.redisUrl);
      console.info(`[session-store] driver=redis url=${redactRedisUrl(config.redisUrl)}`);
      return createRedisSessionStore({ client });
    }
    case 'postgres': {
      console.info('[session-store] driver=postgres');
      return createDrizzleSessionStore(db);
    }
    case 'memory':
    default:
      console.info('[session-store] driver=memory (sessions lost on restart)');
      return createInMemorySessionStore();
  }
}

function redactRedisUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.password) u.password = '***';
    return u.toString();
  } catch {
    return '<redacted>';
  }
}

/**
 * Pick + construct the configured address verifier. Logging is at the
 * info level so a fresh boot tells you which provider you're talking to
 * (or that you're running Noop) — matches the Rust state.rs log lines.
 */
function buildAddressVerifier(config: AddressVerifierConfig): AddressVerifier {
  const onError = (err: unknown): void => {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[address-verifier] verification failed: ${message}`);
  };

  switch (config.provider) {
    case 'bedrock':
      console.info(
        `[address-verifier] provider=bedrock model=${config.model} region=${config.region ?? process.env['AWS_REGION'] ?? 'us-east-1'}`,
      );
      return createBedrockVerifier({
        model: config.model,
        ...(config.region ? { region: config.region } : {}),
        onError,
      });
    case 'ollama':
      console.info(
        `[address-verifier] provider=ollama model=${config.model} baseUrl=${config.baseUrl}`,
      );
      return createOllamaVerifier({
        baseUrl: config.baseUrl,
        model: config.model,
        onError,
      });
    case 'none':
    default:
      console.info('[address-verifier] provider=none (verification disabled)');
      return createNoopVerifier();
  }
}
