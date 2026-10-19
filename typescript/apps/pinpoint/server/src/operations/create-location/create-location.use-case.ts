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
 *   5a. Match → create Location pointing at the matched master + LocationValidated.
 *   5b. No match → create new MasterLocation (PENDING, geocoded later) + Location.
 *   6. processing_log rows throughout (fire-and-forget).
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

import { MasterLocation } from '../../domain/locations/master-location.js';
import {
  asLocationAttributeId,
  asLocationId,
  asMasterLocationId,
  LOCATION_ATTRIBUTE_ID_PREFIX,
  LOCATION_ID_PREFIX,
  MASTER_LOCATION_ID_PREFIX,
} from '../../domain/locations/ids.js';
import type { LocationAttribute } from '../../domain/locations/location-attribute.js';
import { asClientId, asPartitionId, PARTITION_ID_PREFIX } from '../../domain/tenancy/ids.js';
import { DEFAULT_PARTITION_CODE, Partition } from '../../domain/tenancy/partition.js';
import { PartitionCreated } from '../../domain/tenancy/events/partition-created.event.js';
import { LocationCreated } from '../../domain/locations/events/location-created.event.js';
import { MasterLocationCreated } from '../../domain/locations/events/master-location-created.event.js';
import { LocationValidated } from '../../domain/locations/events/location-validated.event.js';
import { addressDetailsFromMaster } from '../../domain/locations/events/address-details.js';
import { hitToAssociation, hitToProperty } from '../../domain/services/spatial-hit-mappers.js';
import { UNRESOLVED_COMPONENT } from '../../domain/services/address-normalizer.js';
import { addressLineHash, tidyAddressLine } from '../../domain/services/address-line.js';
import { matchLocation } from '../../domain/services/location-matching.js';
import type { Location } from '../../domain/locations/location.js';
import type { AddressVerifier } from '../../domain/services/address-verifier.js';
import type { ClientRepository } from '../../domain/tenancy/client.repository.js';
import type { PartitionRepository } from '../../domain/tenancy/partition.repository.js';
import type { LocationRepository } from '../../domain/locations/location.repository.js';
import type { MasterLocationRepository } from '../../domain/locations/master-location.repository.js';
import type { MatchingConfigRepository } from '../../domain/matching/matching-config.repository.js';
import type { LayerFeatureRepository } from '../../domain/layers/layer-feature.repository.js';
import type { LocationAttributeRepository } from '../../domain/locations/location-attribute.repository.js';
import {
  ProcessingStep,
  type ProcessingLogRepository,
} from '../../domain/locations/processing-log.repository.js';
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
        const event = new LocationCreated(scope, {
          locationId: existing.id,
          clientId: existing.clientId,
          partitionId: existing.partitionId,
          masterLocationId: existing.masterLocationId ?? '',
          externalId: existing.externalId,
          rawCity: existing.rawCity,
          rawCountry: existing.rawCountry,
        });
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

    // Step 4: match.
    const outcome = await matchLocation(
      {
        masters: this.masters,
        locations: this.locations,
        verifier: this.addressVerifier,
        processingLog: this.processingLog,
      },
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
    const matchResult = outcome.match;

    const unparsed = {
      rawSuburb: null,
      rawCity: UNRESOLVED_COMPONENT,
      rawState: null,
      rawPostalCode: null,
      rawCountry: country,
      normalizedHouseNumber: null,
      normalizedRoad: null,
      normalizedSuburb: null,
      normalizedCity: null,
      normalizedState: null,
      normalizedPostalCode: null,
      normalizedCountry: countryCode ? country : null,
    } as const;

    if (matchResult !== null) {
      const matchedMaster = matchResult.master;

      // processing_log writes are fire-and-forget — log failures must
      // not block the pipeline.
      try {
        await this.processingLog.append(matchedMaster.id, ProcessingStep.Matched, {
          method: matchResult.method,
          confidence: matchResult.confidence,
          location_id: locationId,
          address_line: addressLine,
        });
      } catch {
        // swallow
      }

      // Candidates are VALIDATED-only (see matchLocation).
      const masterValidated = matchedMaster.status === 'VALIDATED';

      const location: Location = {
        id: locationId,
        clientId,
        partitionId,
        masterLocationId: matchedMaster.id,
        externalId,
        name,
        rawAddressLine1: address,
        matchAddress: address,
        rawAddressLine2: null,
        ...unparsed,
        addressHash,
        matchConfidence: matchResult.confidence,
        matchMethod: matchResult.method,
        status: masterValidated ? 'VALIDATED' : 'PENDING',
        createdAt: now,
        updatedAt: now,
      };

      const createdEvent = new LocationCreated(scope, {
        locationId: location.id,
        clientId: location.clientId,
        partitionId: location.partitionId,
        masterLocationId: matchedMaster.id,
        externalId: location.externalId,
        rawCity: location.rawCity,
        rawCountry: location.rawCountry,
      });

      const primary = await commitAggregate(
        this.uow,
        this.registry,
        location,
        createdEvent,
        command,
      );
      if (isFailure(primary)) return primary;

      if (attributeInputs.length > 0) {
        const attrs: LocationAttribute[] = attributeInputs.map((a) => ({
          id: asLocationAttributeId(`${LOCATION_ATTRIBUTE_ID_PREFIX}_${generateTsid()}`),
          locationId: location.id,
          key: a.key.trim(),
          value: a.value,
          createdAt: now,
          updatedAt: now,
        }));
        // Bind the attribute write to the current UoW tx so the FK to
        // the just-created (still-uncommitted) location resolves.
        const tx = TransactionStore.require();
        await this.locationAttributes.insertMany(attrs, tx);
      }

      if (masterValidated && matchedMaster.latitude !== null && matchedMaster.longitude !== null) {
        const lat = matchedMaster.latitude;
        const lon = matchedMaster.longitude;
        const hits = await this.layerFeatures.spatialLookup({
          clientId,
          partitionId,
          latitude: lat,
          longitude: lon,
          layerCodes: null,
        });
        await this.layerFeatures.replaceLocationFeatureAssociations(
          location.id,
          hits.map(hitToAssociation),
          TransactionStore.get(),
        );

        const validatedEvent = new LocationValidated(scope, {
          locationId: location.id,
          clientId: location.clientId,
          masterLocationId: matchedMaster.id,
          latitude: lat,
          longitude: lon,
          address: addressDetailsFromMaster(matchedMaster),
          layerProperties: hits.map(hitToProperty),
        });
        const validatedResult = await commitAggregate(
          this.uow,
          this.registry,
          location,
          validatedEvent,
          command,
        );
        // Reconstruct the failure so the return type matches the outer
        // Result<LocationCreated> instead of Result<LocationValidated>.
        if (isFailure(validatedResult)) return Result.failure(validatedResult.error);
      }

      return primary;
    }

    // ──── No-match path ─────────────────────────────────────────────
    const masterId = asMasterLocationId(`${MASTER_LOCATION_ID_PREFIX}_${generateTsid()}`);
    const master = MasterLocation.create({
      id: masterId,
      clientId,
      partitionId,
      normalizedHouseNumber: null,
      normalizedRoad: null,
      normalizedSuburb: null,
      normalizedCity: UNRESOLVED_COMPONENT,
      normalizedState: null,
      normalizedPostalCode: null,
      normalizedCountry: country,
      addressHash,
      normalizedAddressLine: addressLine,
      now,
    });

    const masterEvent = new MasterLocationCreated(scope, {
      masterLocationId: masterId,
      clientId,
      partitionId,
      addressHash,
      normalizedCity: UNRESOLVED_COMPONENT,
      normalizedCountry: country,
    });
    const masterCommit = await commitAggregate(
      this.uow,
      this.registry,
      master,
      masterEvent,
      command,
    );
    // Reconstruct the failure so the return type matches the outer
    // Result<LocationCreated> instead of Result<MasterLocationCreated>.
    if (isFailure(masterCommit)) return Result.failure(masterCommit.error);

    // Trail entries append AFTER the master commit — the FK to the
    // master row is checked per-statement even inside the shared tx.
    try {
      await this.processingLog.append(masterId, ProcessingStep.Normalized, {
        input: address,
        address_line: addressLine,
        address_hash: addressHash,
        country_hint: countryCode,
      });
    } catch {
      // swallow
    }
    try {
      await this.processingLog.append(masterId, ProcessingStep.Created, {
        reason: outcome.rejectedMasterIds.length > 0 ? 'verifier_rejected' : 'no_match',
        candidates_checked: outcome.candidatesChecked,
        rejected_master_location_ids: outcome.rejectedMasterIds,
      });
    } catch {
      // swallow
    }

    const location: Location = {
      id: locationId,
      clientId,
      partitionId,
      masterLocationId: masterId,
      externalId,
      name,
      rawAddressLine1: address,
      matchAddress: address,
      rawAddressLine2: null,
      ...unparsed,
      addressHash,
      matchConfidence: null,
      matchMethod: null,
      status: 'PENDING',
      createdAt: now,
      updatedAt: now,
    };

    const locationEvent = new LocationCreated(scope, {
      locationId: location.id,
      clientId: location.clientId,
      partitionId: location.partitionId,
      masterLocationId: masterId,
      externalId: location.externalId,
      rawCity: location.rawCity,
      rawCountry: location.rawCountry,
    });

    const sealed = await commitAggregate(this.uow, this.registry, location, locationEvent, command);
    if (isFailure(sealed)) return sealed;

    if (attributeInputs.length > 0) {
      const attrs: LocationAttribute[] = attributeInputs.map((a) => ({
        id: asLocationAttributeId(`${LOCATION_ATTRIBUTE_ID_PREFIX}_${generateTsid()}`),
        locationId: location.id,
        key: a.key.trim(),
        value: a.value,
        createdAt: now,
        updatedAt: now,
      }));
      const tx = TransactionStore.require();
      await this.locationAttributes.insertMany(attrs, tx);
    }

    return sealed;
  }

  private authorize(scope: Scope): boolean {
    return scope.permissions.has(CreateLocationUseCase.requiredPermission);
  }
}
