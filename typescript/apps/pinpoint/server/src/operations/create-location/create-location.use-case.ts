/**
 * Full create-location pipeline.
 *
 * Steps:
 *   1. Validate client (+ partition if provided).
 *   2. Idempotent external_id dedup.
 *   3. Tidy the raw address into the matching line + hash. No parse: the
 *      structured components arrive later, from the geocoder.
 *   4. Match against VALIDATED masters (`matchLocation`): exact hash, else the
 *      closest candidates checked by the address verifier, best confirmed
 *      match at or above the config's `overallThreshold`.
 *   5a. Match → the location copies the master's coordinates + components
 *       (`geocodeSource: MASTER_LOCATIONS`, master id kept as a reference),
 *       VALIDATED at once with features at its own point + LocationValidated.
 *   5b. No match → the location stays PENDING; it is geocoded and approved
 *       on its own (`geocode-location`, `approve-location`). No master is
 *       created — masters come only from approved, non-third-party geocodes.
 *   6. processing trail on the location (fire-and-forget).
 *   7. Persist attributes if the command carried any.
 *
 * Repo deps + UoW + registry come via constructor; the address verifier sits
 * alongside them.
 */
import { generateTsid } from '@flowcatalyst/sdk';
import {
  Result,
  ScopeStore,
  TransactionStore,
  UseCaseError,
  commitAggregate,
  isFailure,
  type AggregateRegistryImpl,
  type Scope,
  type UnitOfWork,
} from '@pinpoint/framework';
import { PinpointPermission } from '@pinpoint/shared';

import {
  asLocationAttributeId,
  asLocationId,
  LOCATION_ATTRIBUTE_ID_PREFIX,
  LOCATION_ID_PREFIX,
} from '../../domain/locations/ids.js';
import type { LocationAttribute } from '../../domain/locations/location-attribute.js';
import { asClientId, asPartitionId, PARTITION_ID_PREFIX } from '../../domain/tenancy/ids.js';
import { DEFAULT_PARTITION_CODE, Partition } from '../../domain/tenancy/partition.js';
import { PartitionCreated } from '../../domain/tenancy/events/partition-created.event.js';
import { LocationCreated } from '../../domain/locations/events/location-created.event.js';
import {
  associateLocationFeatures,
  locationValidatedEvent,
} from '../../domain/services/location-features.js';
import { recordMatchTrail } from '../../domain/services/match-trail.js';
import { UNRESOLVED_COMPONENT } from '../../domain/services/address-normalizer.js';
import { addressLineHash, tidyAddressLine } from '../../domain/services/address-line.js';
import { matchLocation } from '../../domain/services/location-matching.js';
import { Location } from '../../domain/locations/location.js';
import type { AddressVerifier } from '../../domain/services/address-verifier.js';
import type { ClientRepository } from '../../domain/tenancy/client.repository.js';
import type { PartitionRepository } from '../../domain/tenancy/partition.repository.js';
import type { LocationRepository } from '../../domain/locations/location.repository.js';
import type { MasterLocationRepository } from '../../domain/locations/master-location.repository.js';
import type { MatchingConfigRepository } from '../../domain/matching/matching-config.repository.js';
import type { LayerFeatureRepository } from '../../domain/layers/layer-feature.repository.js';
import type { LocationAttributeRepository } from '../../domain/locations/location-attribute.repository.js';
import type { ProcessingLogRepository } from '../../domain/locations/processing-log.repository.js';
import type { CreateLocationCommand } from './create-location.command.js';

export class CreateLocationUseCase {
  static readonly requiredPermission = PinpointPermission.LocationsLocationCreate;

  constructor(
    private readonly uow: UnitOfWork,
    private readonly registry: AggregateRegistryImpl,
    private readonly clients: ClientRepository,
    private readonly partitions: PartitionRepository,
    private readonly locations: LocationRepository,
    private readonly masters: MasterLocationRepository,
    private readonly matchingConfigs: MatchingConfigRepository,
    private readonly layerFeatures: LayerFeatureRepository,
    private readonly locationAttributes: LocationAttributeRepository,
    private readonly processingLog: ProcessingLogRepository,
    private readonly addressVerifier: AddressVerifier,
  ) {}

  async execute(command: CreateLocationCommand): Promise<Result<LocationCreated>> {
    const scope = ScopeStore.require();

    if (!this.authorize(scope)) {
      return Result.failure(
        UseCaseError.authorization(
          'PERMISSION_DENIED',
          `Missing permission ${PinpointPermission.LocationsLocationCreate}.`,
        ),
      );
    }

    const clientId = asClientId(command.clientId.trim());
    const requestedPartitionId =
      command.partitionId && command.partitionId.trim().length > 0
        ? asPartitionId(command.partitionId.trim())
        : null;
    const externalId = command.externalId?.trim() || null;
    const name = command.name?.trim() || null;
    const address = command.address.trim();
    const countryCode = command.countryCode?.trim() || null;

    if (address.length === 0) {
      return Result.failure(
        UseCaseError.validation('ADDRESS_REQUIRED', 'Address must not be empty.'),
      );
    }

    // Validate attributes early so a bad payload fails before matching.
    const attributeInputs = command.attributes ?? [];
    const seenAttrKeys = new Set<string>();
    for (const a of attributeInputs) {
      const key = a.key.trim();
      if (key.length === 0) {
        return Result.failure(
          UseCaseError.validation('ATTRIBUTE_KEY_REQUIRED', 'Attribute keys must not be empty.'),
        );
      }
      if (seenAttrKeys.has(key)) {
        return Result.failure(
          UseCaseError.businessRule('DUPLICATE_ATTRIBUTE_KEY', `Duplicate attribute key '${key}'.`),
        );
      }
      seenAttrKeys.add(key);
    }

    const client = await this.clients.findById(clientId);
    if (!client) {
      return Result.failure(
        UseCaseError.notFound('CLIENT_NOT_FOUND', `Client '${clientId}' not found.`),
      );
    }

    if (requestedPartitionId) {
      const partition = await this.partitions.findById(requestedPartitionId);
      if (!partition) {
        return Result.failure(
          UseCaseError.notFound(
            'PARTITION_NOT_FOUND',
            `Partition '${requestedPartitionId}' not found.`,
          ),
        );
      }
    }

    // Locations always land in a partition: no explicit partition → the
    // client's 'default' one, lazily created in this tx for legacy clients
    // that predate default-partition seeding (client create cascades it now).
    let partitionId = requestedPartitionId;
    if (!partitionId) {
      const fallback = await this.partitions.findByClientAndCode(clientId, DEFAULT_PARTITION_CODE);
      if (fallback) {
        partitionId = fallback.id;
      } else {
        const newPartitionId = asPartitionId(`${PARTITION_ID_PREFIX}_${generateTsid()}`);
        const partition = Partition.create({
          id: newPartitionId,
          clientId,
          code: DEFAULT_PARTITION_CODE,
          name: 'Default',
          description: 'Seeded default partition.',
          now: new Date(),
        });
        const partitionEvent = new PartitionCreated(scope, {
          partitionId: newPartitionId,
          clientId,
          code: DEFAULT_PARTITION_CODE,
          name: 'Default',
        });
        const seeded = await commitAggregate(
          this.uow,
          this.registry,
          partition,
          partitionEvent,
          command,
        );
        if (isFailure(seeded)) return seeded;
        partitionId = newPartitionId;
      }
    }

    // Step 2: idempotent dedup.
    if (externalId) {
      const existing = await this.locations.findByExternalId(clientId, partitionId, externalId);
      if (existing) {
        const event = createdEvent(scope, existing);
        return commitAggregate(this.uow, this.registry, existing, event, command);
      }
    }

    // Step 3: the tidied line is the matching key. City is unknown until the
    // geocoder resolves it; the country comes from the hint when there is one.
    const addressLine = tidyAddressLine(address);
    const addressHash = addressLineHash(addressLine);
    const country = countryCode ? countryCode.toUpperCase() : UNRESOLVED_COMPONENT;

    const config = await this.matchingConfigs.resolve(clientId, partitionId);

    const now = new Date();
    const locationId = asLocationId(`${LOCATION_ID_PREFIX}_${generateTsid()}`);

    // Step 4: match against our VALIDATED master locations.
    const outcome = await matchLocation(
      { masters: this.masters, verifier: this.addressVerifier },
      {
        clientId,
        partitionId,
        addressLine,
        addressHash,
        name,
        locationId,
        threshold: config.overallThreshold,
      },
    );

    const received: Location = {
      ...Location.create({
        id: locationId,
        clientId,
        partitionId,
        externalId,
        name,
        rawAddressLine1: address,
        rawAddressLine2: null,
        rawSuburb: null,
        rawCity: UNRESOLVED_COMPONENT,
        rawState: null,
        rawPostalCode: null,
        rawCountry: country,
        now,
      }),
      addressHash,
      normalizedCountry: countryCode ? country : null,
    };
    // A match copies the master's data onto the location (VALIDATED at once);
    // no match leaves it PENDING, to be geocoded and approved on its own.
    const location = outcome.match
      ? Location.matchedFrom(received, outcome.match.master, outcome.match, now)
      : received;

    const created = await commitAggregate(
      this.uow,
      this.registry,
      location,
      createdEvent(scope, location),
      command,
    );
    if (isFailure(created)) return created;

    if (attributeInputs.length > 0) {
      const attrs: LocationAttribute[] = attributeInputs.map((a) => ({
        id: asLocationAttributeId(`${LOCATION_ATTRIBUTE_ID_PREFIX}_${generateTsid()}`),
        locationId: location.id,
        key: a.key.trim(),
        value: a.value,
        createdAt: now,
        updatedAt: now,
      }));
      // Bind the attribute write to the current UoW tx so the FK to the
      // just-created (still-uncommitted) location resolves.
      await this.locationAttributes.insertMany(attrs, TransactionStore.require());
    }

    // Trail entries go on the location, after its row exists.
    await recordMatchTrail(this.processingLog, location.id, {
      addressLine,
      addressHash,
      countryHint: countryCode,
      outcome,
    });

    if (outcome.match) {
      const hits = await associateLocationFeatures(
        this.layerFeatures,
        location,
        TransactionStore.get(),
      );
      const validated = await commitAggregate(
        this.uow,
        this.registry,
        location,
        locationValidatedEvent(scope, location, hits),
        command,
      );
      // Reconstruct the failure so the return type stays Result<LocationCreated>.
      if (isFailure(validated)) return Result.failure(validated.error);
    }

    return created;
  }

  private authorize(scope: Scope): boolean {
    return scope.permissions.has(CreateLocationUseCase.requiredPermission);
  }
}

function createdEvent(scope: Scope, location: Location): LocationCreated {
  return new LocationCreated(scope, {
    locationId: location.id,
    clientId: location.clientId,
    partitionId: location.partitionId,
    sourceMasterLocationId: location.sourceMasterLocationId,
    status: location.status,
    externalId: location.externalId,
    rawCity: location.rawCity,
    rawCountry: location.rawCountry,
  });
}
