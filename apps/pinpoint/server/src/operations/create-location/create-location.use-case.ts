/**
 * Full create-location pipeline — port of Rust `create_location.rs`.
 *
 * Replaces the Slice 3 minimal-create version. Steps:
 *   1. Validate client (+ partition if provided).
 *   2. Idempotent external_id dedup → if found, return the existing
 *      location's LocationCreated as if just created (Rust pattern).
 *   3. Normalize the free-form `address` via libpostal; retry with
 *      `country_code` appended on failure.
 *   4. Resolve matching config for (client, partition).
 *   5. Look up master by exact address_hash (VALIDATED only).
 *   6. Look up fuzzy candidates via pg_trgm (threshold 0.3, limit 50,
 *      VALIDATED only).
 *   7. Run AddressMatcher on all candidates.
 *   8. If fuzzy match: optionally call AddressVerifier (LLM) — its `null`
 *      return is "no opinion" (proceed); `match_confirmed=false` rejects.
 *   9a. Match → create Location pointing at matched master. If master
 *      is VALIDATED, also emit LocationValidated with spatial-feature
 *      payload + write location_feature_associations.
 *   9b. No match → create a new MasterLocation (PENDING) and a Location
 *      pointing at it.
 *  10. Throughout, append processing_log rows. Fire-and-forget — log
 *      failures must not block the pipeline.
 *
 * Returns Sealed<LocationCreated>. Secondary events
 * (MasterLocationCreated, LocationValidated) emit through additional
 * `commitAggregate` calls in the same outbox/tx batch.
 */
import { Effect } from 'effect';
import { generateTsid } from '@flowcatalyst/sdk';
import {
  AggregateRegistry,
  AuthorizationError,
  BusinessRuleViolation,
  commitAggregate,
  InfrastructureError,
  NotFoundError,
  ScopeStore,
  type Scope,
  ValidationError,
  type Sealed,
  type UnitOfWork,
  type UseCaseError,
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
    private readonly clients: ClientRepository,
    private readonly partitions: PartitionRepository,
    private readonly locations: LocationRepository,
    private readonly masters: MasterLocationRepository,
    private readonly matchingConfigs: MatchingConfigRepository,
    private readonly layerFeatures: LayerFeatureRepository,
    private readonly addressNormalizer: AddressNormalizer,
    private readonly addressVerifier: AddressVerifier,
    private readonly processingLog: ProcessingLogRepository,
    private readonly locationAttributes: LocationAttributeRepository,
  ) {}

  execute = (
    command: CreateLocationCommand,
  ): Effect.Effect<Sealed<LocationCreated>, UseCaseError, UnitOfWork | AggregateRegistry> => {
    const clients = this.clients;
    const partitions = this.partitions;
    const locations = this.locations;
    const masters = this.masters;
    const matchingConfigs = this.matchingConfigs;
    const layerFeatures = this.layerFeatures;
    const addressNormalizer = this.addressNormalizer;
    const addressVerifier = this.addressVerifier;
    const processingLog = this.processingLog;
    const locationAttributes = this.locationAttributes;
    const authorize = (s: Scope): boolean => this.authorize(s);

    return Effect.gen(function* () {
      const scope = ScopeStore.require();

      if (!authorize(scope)) {
        return yield* Effect.fail(
          new AuthorizationError({
            code: 'PERMISSION_DENIED',
            message: `Missing permission ${PinpointPermission.LocationsLocationCreate}.`,
          }),
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
        return yield* Effect.fail(
          new ValidationError({
            code: 'ADDRESS_REQUIRED',
            message: 'Address must not be empty.',
          }),
        );
      }

      // Validate attributes early so a bad attribute payload fails the
      // request before we hit libpostal / fuzzy matching.
      const attributeInputs = command.attributes ?? [];
      const seenAttrKeys = new Set<string>();
      for (const a of attributeInputs) {
        const key = a.key.trim();
        if (key.length === 0) {
          return yield* Effect.fail(
            new ValidationError({
              code: 'ATTRIBUTE_KEY_REQUIRED',
              message: 'Attribute keys must not be empty.',
            }),
          );
        }
        if (seenAttrKeys.has(key)) {
          return yield* Effect.fail(
            new BusinessRuleViolation({
              code: 'DUPLICATE_ATTRIBUTE_KEY',
              message: `Duplicate attribute key '${key}'.`,
            }),
          );
        }
        seenAttrKeys.add(key);
      }

      const client = yield* Effect.tryPromise({
        try: () => clients.findById(clientId),
        catch: (cause) =>
          new InfrastructureError({
            code: 'CLIENT_REPO_READ_FAILED',
            message: cause instanceof Error ? cause.message : String(cause),
          }),
      });
      if (!client) {
        return yield* Effect.fail(
          new NotFoundError({
            code: 'CLIENT_NOT_FOUND',
            message: `Client '${clientId}' not found.`,
          }),
        );
      }

      if (partitionId) {
        const partition = yield* Effect.tryPromise({
          try: () => partitions.findById(partitionId),
          catch: (cause) =>
            new InfrastructureError({
              code: 'PARTITION_REPO_READ_FAILED',
              message: cause instanceof Error ? cause.message : String(cause),
            }),
        });
        if (!partition) {
          return yield* Effect.fail(
            new NotFoundError({
              code: 'PARTITION_NOT_FOUND',
              message: `Partition '${partitionId}' not found.`,
            }),
          );
        }
      }

      // Step 2: idempotent dedup. Rust returns an existing location's
      // LocationCreated as a success; we mirror that — the caller gets a
      // 201 with the existing id rather than a 409.
      if (externalId) {
        const existing = yield* Effect.tryPromise({
          try: () => locations.findByExternalId(clientId, partitionId, externalId),
          catch: (cause) =>
            new InfrastructureError({
              code: 'LOCATION_REPO_READ_FAILED',
              message: cause instanceof Error ? cause.message : String(cause),
            }),
        });
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
          return yield* commitAggregate(existing, event, command);
        }
      }

      // Step 3: normalize, with a country-code retry on first failure.
      const normalized: NormalizedAddress = yield* Effect.tryPromise({
        try: async () => {
          try {
            return await addressNormalizer.normalize(address);
          } catch (firstErr) {
            if (countryCode === null) throw firstErr;
            return await addressNormalizer.normalize(`${address}, ${countryCode}`);
          }
        },
        catch: (cause) =>
          new InfrastructureError({
            code: 'ADDRESS_NORMALIZATION_FAILED',
            message: cause instanceof Error ? cause.message : String(cause),
          }),
      });

      const addressHash = computeAddressHash(normalized);
      const addressLine = toAddressLine(normalized);

      // Step 4: matching config (cascade fallback handled in the repo).
      const config = yield* Effect.tryPromise({
        try: () => matchingConfigs.resolve(clientId, partitionId),
        catch: (cause) =>
          new InfrastructureError({
            code: 'MATCHING_CONFIG_READ_FAILED',
            message: cause instanceof Error ? cause.message : String(cause),
          }),
      });

      // Step 5: exact hash match (only against VALIDATED masters).
      const hashHit = yield* Effect.tryPromise({
        try: () => masters.findByHash(clientId, partitionId, addressHash),
        catch: (cause) =>
          new InfrastructureError({
            code: 'MASTER_LOCATION_REPO_READ_FAILED',
            message: cause instanceof Error ? cause.message : String(cause),
          }),
      });

      const validatedHashHit = hashHit && hashHit.status === 'VALIDATED' ? hashHit : null;

      // Step 6: fuzzy candidates. Filter to VALIDATED and exclude the hash
      // hit (already at the head of the candidates list).
      const fuzzyCandidates = yield* Effect.tryPromise({
        try: () =>
          masters.findFuzzyCandidates(
            clientId,
            partitionId,
            addressLine,
            FUZZY_THRESHOLD,
            FUZZY_LIMIT,
          ),
        catch: (cause) =>
          new InfrastructureError({
            code: 'MASTER_LOCATION_FUZZY_READ_FAILED',
            message: cause instanceof Error ? cause.message : String(cause),
          }),
      });

      const candidates = [
        ...(validatedHashHit ? [validatedHashHit] : []),
        ...fuzzyCandidates.filter(
          (c) => c.status === 'VALIDATED' && (!validatedHashHit || c.id !== validatedHashHit.id),
        ),
      ];

      // Step 7: run the algorithmic matcher.
      let matchResult = findMatch(normalized, addressHash, candidates, config);

      // Step 8: optional LLM verifier for fuzzy matches (skip exact hash).
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
          const verdict = yield* Effect.promise(() =>
            addressVerifier.verify(addressLine, candidateLine),
          );
          // `null` = no verifier opinion → keep the algorithmic match.
          // `match_confirmed = false` rejects, falls through to no-match path.
          if (verdict && !verdict.match_confirmed) {
            matchResult = null;
          }
        }
      }

      const now = new Date();
      const locationId = asLocationId(`${LOCATION_ID_PREFIX}_${generateTsid()}`);

      if (matchResult !== null) {
        // ──── Match path ───────────────────────────────────────────────
        const matchedMaster = candidates.find((c) => c.id === matchResult!.masterLocationId);

        yield* Effect.promise(() =>
          processingLog
            .append(asMasterLocationId(matchResult!.masterLocationId), 'normalized', {
              input: address,
              house_number: normalized.houseNumber,
              road: normalized.road,
              suburb: normalized.suburb,
              city: normalized.city,
              state: normalized.state,
              postal_code: normalized.postalCode,
              country: normalized.country,
              address_hash: addressHash,
            })
            .catch(() => undefined),
        );
        yield* Effect.promise(() =>
          processingLog
            .append(asMasterLocationId(matchResult!.masterLocationId), 'matched', {
              method: matchResult!.method,
              confidence: matchResult!.confidence,
              location_id: locationId,
            })
            .catch(() => undefined),
        );

        const masterValidated =
          matchedMaster !== undefined && matchedMaster.status === 'VALIDATED';

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

        const primary = yield* commitAggregate(location, createdEvent, command);

        // Persist location attributes inside the same tx.
        if (attributeInputs.length > 0) {
          const attrs: LocationAttribute[] = attributeInputs.map((a) => ({
            id: asLocationAttributeId(`${LOCATION_ATTRIBUTE_ID_PREFIX}_${generateTsid()}`),
            locationId: location.id,
            key: a.key.trim(),
            value: a.value,
            createdAt: now,
            updatedAt: now,
          }));
          yield* Effect.tryPromise({
            try: () => locationAttributes.insertMany(attrs),
            catch: (cause) =>
              new InfrastructureError({
                code: 'LOCATION_ATTRIBUTE_WRITE_FAILED',
                message: cause instanceof Error ? cause.message : String(cause),
              }),
          });
        }

        // If the master is already VALIDATED, this location is too —
        // emit LocationValidated with the spatial-property payload.
        if (
          masterValidated &&
          matchedMaster &&
          matchedMaster.latitude !== null &&
          matchedMaster.longitude !== null
        ) {
          const lat = matchedMaster.latitude;
          const lon = matchedMaster.longitude;
          const hits = yield* Effect.tryPromise({
            try: () =>
              layerFeatures.spatialLookup({
                clientId,
                partitionId,
                latitude: lat,
                longitude: lon,
                layerCodes: null,
              }),
            catch: (cause) =>
              new InfrastructureError({
                code: 'SPATIAL_LOOKUP_FAILED',
                message: cause instanceof Error ? cause.message : String(cause),
              }),
          });

          yield* Effect.tryPromise({
            try: () =>
              layerFeatures.replaceLocationFeatureAssociations(
                location.id,
                hits.map(hitToAssociation),
              ),
            catch: (cause) =>
              new InfrastructureError({
                code: 'LOCATION_FEATURE_ASSOC_WRITE_FAILED',
                message: cause instanceof Error ? cause.message : String(cause),
              }),
          });

          const validatedEvent = new LocationValidated(scope, {
            locationId: location.id,
            clientId: location.clientId,
            masterLocationId: matchResult.masterLocationId,
            latitude: lat,
            longitude: lon,
            layerProperties: hits.map(hitToProperty),
          });
          yield* commitAggregate(location, validatedEvent, command);
        }

        return primary;
      }

      // ──── No-match path: create a fresh master + location ─────────────
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

      yield* Effect.promise(() =>
        processingLog
          .append(masterId, 'normalized', {
            input: address,
            house_number: normalized.houseNumber,
            road: normalized.road,
            suburb: normalized.suburb,
            city: normalized.city,
            state: normalized.state,
            postal_code: normalized.postalCode,
            country: normalized.country,
            address_hash: addressHash,
          })
          .catch(() => undefined),
      );
      yield* Effect.promise(() =>
        processingLog
          .append(masterId, 'created', {
            reason: 'no_match',
            candidates_checked: candidates.length,
          })
          .catch(() => undefined),
      );

      const masterEvent = new MasterLocationCreated(scope, {
        masterLocationId: masterId,
        clientId,
        partitionId,
        addressHash,
        normalizedCity: normalized.city,
        normalizedCountry: normalized.country,
      });
      yield* commitAggregate(master, masterEvent, command);

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

      const sealed = yield* commitAggregate(location, locationEvent, command);

      if (attributeInputs.length > 0) {
        const attrs: LocationAttribute[] = attributeInputs.map((a) => ({
          id: asLocationAttributeId(`${LOCATION_ATTRIBUTE_ID_PREFIX}_${generateTsid()}`),
          locationId: location.id,
          key: a.key.trim(),
          value: a.value,
          createdAt: now,
          updatedAt: now,
        }));
        yield* Effect.tryPromise({
          try: () => locationAttributes.insertMany(attrs),
          catch: (cause) =>
            new InfrastructureError({
              code: 'LOCATION_ATTRIBUTE_WRITE_FAILED',
              message: cause instanceof Error ? cause.message : String(cause),
            }),
        });
      }

      return sealed;
    });
  };

  private authorize(scope: Scope): boolean {
    return scope.permissions.has(
      (this.constructor as unknown as { readonly requiredPermission: string }).requiredPermission,
    );
  }
}
