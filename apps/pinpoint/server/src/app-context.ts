import { Effect, Layer, ManagedRuntime, Result } from 'effect';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import {
  AggregateRegistry,
  aggregateRegistryLayer,
  buildOutboxManager,
  createAggregateRegistry,
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
import { createDrizzlePrincipalRepository } from './infrastructure/principal-repository.js';
import { createDrizzleCountryRepository } from './infrastructure/country-repository.js';
import { createDrizzleClientRepository } from './infrastructure/client-repository.js';
import { createDrizzlePartitionRepository } from './infrastructure/partition-repository.js';
import { createDrizzleLocationRepository } from './infrastructure/location-repository.js';
import { createDrizzleLayerRepository } from './infrastructure/layer-repository.js';
import { createDrizzleLayerFeatureRepository } from './infrastructure/layer-feature-repository.js';
import { createDrizzleMatchingConfigRepository } from './infrastructure/matching-config-repository.js';
import { createDrizzleMasterLocationRepository } from './infrastructure/master-location-repository.js';
import { createDrizzleProcessingLogRepository } from './infrastructure/processing-log-repository.js';
import { createPhotonGeocoder } from './infrastructure/services/photon-geocoder.js';
import { createRateLimitedGeocoder } from './infrastructure/services/rate-limited-geocoder.js';
import { createNoopVerifier } from './infrastructure/services/noop-verifier.js';
import { createBedrockVerifier } from './infrastructure/services/bedrock-verifier.js';
import { createOllamaVerifier } from './infrastructure/services/ollama-verifier.js';
import { createLibPostalNormalizer } from './infrastructure/services/libpostal-normalizer.js';
import { registerClient } from './infrastructure/register-client.js';
import { registerPartition } from './infrastructure/register-partition.js';
import { registerLocation } from './infrastructure/register-location.js';
import { registerLayer } from './infrastructure/register-layer.js';
import { registerLayerFeature } from './infrastructure/register-layer-feature.js';
import { registerMatchingConfig } from './infrastructure/register-matching-config.js';
import { registerMasterLocation } from './infrastructure/register-master-location.js';
import { CLIENT_ID_PREFIX, PARTITION_ID_PREFIX } from './domain/tenancy/ids.js';
import { CLIENT_TYPE } from './domain/tenancy/client.js';
import { PARTITION_TYPE } from './domain/tenancy/partition.js';
import { LOCATION_ID_PREFIX, MASTER_LOCATION_ID_PREFIX } from './domain/locations/ids.js';
import { LOCATION_TYPE } from './domain/locations/location.js';
import { MASTER_LOCATION_TYPE } from './domain/locations/master-location.js';
import { LAYER_ID_PREFIX, LAYER_FEATURE_ID_PREFIX } from './domain/layers/ids.js';
import { LAYER_TYPE } from './domain/layers/layer.js';
import { LAYER_FEATURE_TYPE } from './domain/layers/layer-feature.js';
import { MATCHING_CONFIG_ID_PREFIX } from './domain/matching/ids.js';
import { MATCHING_CONFIG_TYPE } from './domain/matching/matching-config.js';
import type { PrincipalRepository } from './domain/auth/principal.repository.js';
import type { CountryRepository } from './domain/reference/country.repository.js';
import type { ClientRepository } from './domain/tenancy/client.repository.js';
import type { PartitionRepository } from './domain/tenancy/partition.repository.js';
import type { LocationRepository } from './domain/locations/location.repository.js';
import type { LayerRepository } from './domain/layers/layer.repository.js';
import type { LayerFeatureRepository } from './domain/layers/layer-feature.repository.js';
import type { MatchingConfigRepository } from './domain/matching/matching-config.repository.js';
import type { MasterLocationRepository } from './domain/locations/master-location.repository.js';
import type { ProcessingLogRepository } from './domain/locations/processing-log.repository.js';
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
  readonly matchingConfigs: MatchingConfigRepository;
  readonly masterLocations: MasterLocationRepository;
  readonly processingLog: ProcessingLogRepository;
}

export interface AppContextServices {
  readonly geocoder: GeocoderService;
  readonly addressVerifier: AddressVerifier;
  readonly addressNormalizer: AddressNormalizer;
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
    program: Effect.Effect<A, UseCaseError, UnitOfWork | DispatchJobBroker | AggregateRegistry>,
    scope: Scope,
  ) => Promise<Result.Result<A, UseCaseError>>;
}

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
}

export function createAppContext(config: AppContextConfig): AppContext {
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
  const matchingConfigRepo = createDrizzleMatchingConfigRepository(db);
  const masterLocationRepo = createDrizzleMasterLocationRepository(db);
  const processingLogRepo = createDrizzleProcessingLogRepository(db);

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
  registerMatchingConfig(aggregateRegistry, matchingConfigRepo);
  registerMasterLocation(aggregateRegistry, masterLocationRepo);

  // One OutboxManager backs both UoW and DispatchJobBroker.
  const outboxManager = buildOutboxManager({ clientId });

  const baseLayer = Layer.mergeAll(
    unitOfWorkLayer(outboxManager),
    dispatchJobBrokerLayer(outboxManager),
    aggregateRegistryLayer(aggregateRegistry),
  );
  const runtime = ManagedRuntime.make(baseLayer);

  const runWrite = async <A>(
    program: Effect.Effect<A, UseCaseError, UnitOfWork | DispatchJobBroker | AggregateRegistry>,
    _scope: Scope,
  ): Promise<Result.Result<A, UseCaseError>> => {
    const collected = Effect.result(program);
    return transactionManager.inTransaction((tx) =>
      TransactionStore.run(tx, () => runtime.runPromise(collected)),
    );
  };

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
      matchingConfigs: matchingConfigRepo,
      masterLocations: masterLocationRepo,
      processingLog: processingLogRepo,
    },
    services: {
      geocoder,
      addressVerifier,
      addressNormalizer,
    },
    useCases: {
      createClient: new CreateClientUseCase(clientRepo),
      updateClient: new UpdateClientUseCase(clientRepo),
      deleteClient: new DeleteClientUseCase(clientRepo),
      createPartition: new CreatePartitionUseCase(clientRepo, partitionRepo),
      updatePartition: new UpdatePartitionUseCase(partitionRepo),
      deletePartition: new DeletePartitionUseCase(partitionRepo),
      createLocation: new CreateLocationUseCase(
        clientRepo,
        partitionRepo,
        locationRepo,
        masterLocationRepo,
        matchingConfigRepo,
        layerFeatureRepo,
        addressNormalizer,
        addressVerifier,
        processingLogRepo,
      ),
      createLayer: new CreateLayerUseCase(clientRepo, layerRepo),
      updateLayer: new UpdateLayerUseCase(layerRepo),
      deleteLayer: new DeleteLayerUseCase(layerRepo),
      createLayerFeature: new CreateLayerFeatureUseCase(layerRepo, layerFeatureRepo),
      updateLayerFeature: new UpdateLayerFeatureUseCase(layerFeatureRepo),
      deleteLayerFeature: new DeleteLayerFeatureUseCase(layerFeatureRepo),
      updateMatchingConfig: new UpdateMatchingConfigUseCase(
        clientRepo,
        partitionRepo,
        matchingConfigRepo,
      ),
      validateMasterLocation: new ValidateMasterLocationUseCase(masterLocationRepo, geocoder),
      confirmMasterLocation: new ConfirmMasterLocationUseCase(
        masterLocationRepo,
        locationRepo,
        layerFeatureRepo,
        processingLogRepo,
      ),
      updateMasterLocation: new UpdateMasterLocationUseCase(masterLocationRepo),
      rejectMasterLocation: new RejectMasterLocationUseCase(masterLocationRepo),
    },
    runWrite,
  };
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
