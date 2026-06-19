/**
 * Full create-location pipeline — port of Rust `create_location.rs`.
 *
 * Steps (unchanged from the slice-8 rewrite):
 *   1. Validate client (+ partition if provided).
 *   2. Idempotent external_id dedup.
 *   3. Normalize via libpostal; retry with country_code on failure.
 *   4. Resolve matching config for (client, partition).
 *   5. Exact hash match against VALIDATED masters.
 *   6. Fuzzy candidates via pg_trgm.
 *   7. Algorithmic matcher.
 *   8. Optional LLM verifier on fuzzy matches.
 *   9a. Match → create Location pointing at matched master (+ optional
 *       LocationValidated if master is VALIDATED).
 *   9b. No match → create new MasterLocation (PENDING) + Location.
 *  10. processing_log rows throughout (fire-and-forget).
 *  11. Persist attributes if the command carried any.
 *
 * Repo deps + UoW + registry come via constructor; the two non-repo
 * service deps (AddressNormalizer, AddressVerifier) sit alongside them.
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
import { asClientId, asPartitionId } from '../../domain/tenancy/ids.js';
import { LocationCreated } from '../../domain/locations/events/location-created.event.js';
import { MasterLocationCreated } from '../../domain/locations/events/master-location-created.event.js';
import {
  LocationValidated,
  type LayerPropertyAssignment,
} from '../../domain/locations/events/location-validated.event.js';
import { findMatch } from '../../domain/services/address-matcher.js';
import {
  addressHash as computeAddressHash,
  toAddressLine,
  type AddressNormalizer,
  type NormalizedAddress,
} from '../../domain/services/address-normalizer.js';
import type { Location } from '../../domain/locations/location.js';
import type { AddressVerifier } from '../../domain/services/address-verifier.js';
import type { ClientRepository } from '../../domain/tenancy/client.repository.js';
import type { PartitionRepository } from '../../domain/tenancy/partition.repository.js';
import type { LocationRepository } from '../../domain/locations/location.repository.js';
import type { MasterLocationRepository } from '../../domain/locations/master-location.repository.js';
import type { MatchingConfigRepository } from '../../domain/matching/matching-config.repository.js';
import type {
  LayerFeatureRepository,
  LocationFeatureAssociationInput,
  SpatialLookupHit,
} from '../../domain/layers/layer-feature.repository.js';
import type { LocationAttributeRepository } from '../../domain/locations/location-attribute.repository.js';
import type { ProcessingLogRepository } from '../../domain/locations/processing-log.repository.js';
import type { CreateLocationCommand } from './create-location.command.js';

const FUZZY_THRESHOLD = 0.3;
const FUZZY_LIMIT = 50;

function hitToProperty(hit: SpatialLookupHit): LayerPropertyAssignment {
  return {
    layerId: hit.layerId,
    layerCode: hit.layerCode,
    layerName: hit.layerName,
    layerType: hit.layerType,
    featureId: hit.featureId,
    featureLabel: hit.featureLabel,
    distanceMeters: hit.distanceMeters,
    geometry: {
      geometryType: hit.layerType,
      longitude: hit.centerLon,
      latitude: hit.centerLat,
      radiusMeters: hit.radiusMeters,
      polygonPoints:
        hit.polygonPoints !== null
          ? hit.polygonPoints
              .split(';')
              .map((p) => p.split(','))
              .filter((parts) => parts.length === 2)
              .map((parts): [number, number] => [Number(parts[0]), Number(parts[1])])
          : null,
    },
    properties: Object.entries(hit.propertyValues).map(([key, value]) => ({ key, value })),
  };
}

function hitToAssociation(hit: SpatialLookupHit): LocationFeatureAssociationInput {
  return {
    layerId: hit.layerId,
    featureId: hit.featureId,
    distanceMeters: hit.distanceMeters,
  };
}

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
    private readonly addressNormalizer: AddressNormalizer,
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
    const partitionId =
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

    // Validate attributes early so a bad payload fails before we hit
    // libpostal / fuzzy matching.
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

    if (partitionId) {
      const partition = await this.partitions.findById(partitionId);
      if (!partition) {
        return Result.failure(
          UseCaseError.notFound('PARTITION_NOT_FOUND', `Partition '${partitionId}' not found.`),
        );
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

    // Step 3: normalize, with a country-code retry on first failure.
    let normalized: NormalizedAddress;
    try {
      try {
        normalized = await this.addressNormalizer.normalize(address);
      } catch (firstErr) {
        if (countryCode === null) throw firstErr;
        normalized = await this.addressNormalizer.normalize(`${address}, ${countryCode}`);
      }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      return Result.failure(UseCaseError.infrastructure('ADDRESS_NORMALIZATION_FAILED', message));
    }

    const addressHash = computeAddressHash(normalized);
    const addressLine = toAddressLine(normalized);

    const config = await this.matchingConfigs.resolve(clientId, partitionId);

    const hashHit = await this.masters.findByHash(clientId, partitionId, addressHash);
    const validatedHashHit = hashHit && hashHit.status === 'VALIDATED' ? hashHit : null;

    const fuzzyCandidates = await this.masters.findFuzzyCandidates(
      clientId,
      partitionId,
      addressLine,
      FUZZY_THRESHOLD,
      FUZZY_LIMIT,
    );

    const candidates = [
      ...(validatedHashHit ? [validatedHashHit] : []),
      ...fuzzyCandidates.filter(
        (c) => c.status === 'VALIDATED' && (!validatedHashHit || c.id !== validatedHashHit.id),
      ),
    ];

    let matchResult = findMatch(normalized, addressHash, candidates, config);

    // Step 8: optional LLM verifier for fuzzy matches.
    if (matchResult !== null && matchResult.method === 'FUZZY') {
      const candidate = candidates.find((c) => c.id === matchResult!.masterLocationId);
      if (candidate) {
        const candidateLine =
          candidate.normalizedAddressLine !== null
            ? candidate.normalizedAddressLine
            : toAddressLine({
                houseNumber: candidate.normalizedHouseNumber,
                road: candidate.normalizedRoad,
                suburb: candidate.normalizedSuburb,
                city: candidate.normalizedCity,
                state: candidate.normalizedState,
                postalCode: candidate.normalizedPostalCode,
                country: candidate.normalizedCountry,
              });
        const verdict = await this.addressVerifier.verify(addressLine, candidateLine);
        if (verdict && !verdict.match_confirmed) {
          matchResult = null;
        }
      }
    }

    const now = new Date();
    const locationId = asLocationId(`${LOCATION_ID_PREFIX}_${generateTsid()}`);

    if (matchResult !== null) {
      const matchedMaster = candidates.find((c) => c.id === matchResult!.masterLocationId);

      // processing_log writes are fire-and-forget — log failures must
      // not block the pipeline.
      try {
        await this.processingLog.append(
          asMasterLocationId(matchResult.masterLocationId),
          'normalized',
          {
            input: address,
            house_number: normalized.houseNumber,
            road: normalized.road,
            suburb: normalized.suburb,
            city: normalized.city,
            state: normalized.state,
            postal_code: normalized.postalCode,
            country: normalized.country,
            address_hash: addressHash,
          },
        );
      } catch {
        // swallow
      }
      try {
        await this.processingLog.append(
          asMasterLocationId(matchResult.masterLocationId),
          'matched',
          {
            method: matchResult.method,
            confidence: matchResult.confidence,
            location_id: locationId,
          },
        );
      } catch {
        // swallow
      }

      const masterValidated = matchedMaster !== undefined && matchedMaster.status === 'VALIDATED';

      const location: Location = {
        id: locationId,
        clientId,
        partitionId,
        masterLocationId: asMasterLocationId(matchResult.masterLocationId),
        externalId,
        name,
        rawAddressLine1: address,
        rawAddressLine2: null,
        rawSuburb: normalized.suburb,
        rawCity: normalized.city,
        rawState: normalized.state,
        rawPostalCode: normalized.postalCode,
        rawCountry: normalized.country,
        normalizedHouseNumber: normalized.houseNumber,
        normalizedRoad: normalized.road,
        normalizedSuburb: normalized.suburb,
        normalizedCity: normalized.city,
        normalizedState: normalized.state,
        normalizedPostalCode: normalized.postalCode,
        normalizedCountry: normalized.country,
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
        masterLocationId: matchResult.masterLocationId,
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

      if (
        masterValidated &&
        matchedMaster &&
        matchedMaster.latitude !== null &&
        matchedMaster.longitude !== null
      ) {
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
        );

        const validatedEvent = new LocationValidated(scope, {
          locationId: location.id,
          clientId: location.clientId,
          masterLocationId: matchResult.masterLocationId,
          latitude: lat,
          longitude: lon,
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
      normalizedHouseNumber: normalized.houseNumber,
      normalizedRoad: normalized.road,
      normalizedSuburb: normalized.suburb,
      normalizedCity: normalized.city,
      normalizedState: normalized.state,
      normalizedPostalCode: normalized.postalCode,
      normalizedCountry: normalized.country,
      addressHash,
      normalizedAddressLine: addressLine,
      now,
    });

    try {
      await this.processingLog.append(masterId, 'normalized', {
        input: address,
        house_number: normalized.houseNumber,
        road: normalized.road,
        suburb: normalized.suburb,
        city: normalized.city,
        state: normalized.state,
        postal_code: normalized.postalCode,
        country: normalized.country,
        address_hash: addressHash,
      });
    } catch {
      // swallow
    }
    try {
      await this.processingLog.append(masterId, 'created', {
        reason: 'no_match',
        candidates_checked: candidates.length,
      });
    } catch {
      // swallow
    }

    const masterEvent = new MasterLocationCreated(scope, {
      masterLocationId: masterId,
      clientId,
      partitionId,
      addressHash,
      normalizedCity: normalized.city,
      normalizedCountry: normalized.country,
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

    const location: Location = {
      id: locationId,
      clientId,
      partitionId,
      masterLocationId: masterId,
      externalId,
      name,
      rawAddressLine1: address,
      rawAddressLine2: null,
      rawSuburb: normalized.suburb,
      rawCity: normalized.city,
      rawState: normalized.state,
      rawPostalCode: normalized.postalCode,
      rawCountry: normalized.country,
      normalizedHouseNumber: normalized.houseNumber,
      normalizedRoad: normalized.road,
      normalizedSuburb: normalized.suburb,
      normalizedCity: normalized.city,
      normalizedState: normalized.state,
      normalizedPostalCode: normalized.postalCode,
      normalizedCountry: normalized.country,
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
