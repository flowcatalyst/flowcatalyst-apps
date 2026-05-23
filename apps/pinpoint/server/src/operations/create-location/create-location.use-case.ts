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
 * Repo deps are yielded from the Effect environment via Tags. The two
 * non-repo service deps (AddressNormalizer, AddressVerifier) stay as
 * constructor args.
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
  TransactionStore,
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
import { Clients } from '../../domain/tenancy/client.repository.js';
import { Partitions } from '../../domain/tenancy/partition.repository.js';
import { Locations } from '../../domain/locations/location.repository.js';
import { MasterLocations } from '../../domain/locations/master-location.repository.js';
import { MatchingConfigs } from '../../domain/matching/matching-config.repository.js';
import { LayerFeatures } from '../../domain/layers/layer-feature.repository.js';
import { LocationAttributes } from '../../domain/locations/location-attribute.repository.js';
import { ProcessingLogs } from '../../domain/locations/processing-log.repository.js';
import type {
  LocationFeatureAssociationInput,
  SpatialLookupHit,
} from '../../domain/layers/layer-feature.repository.js';
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
    private readonly addressNormalizer: AddressNormalizer,
    private readonly addressVerifier: AddressVerifier,
  ) {}

  execute = (
    command: CreateLocationCommand,
  ): Effect.Effect<
    Sealed<LocationCreated>,
    UseCaseError,
    | UnitOfWork
    | AggregateRegistry
    | Clients
    | Partitions
    | Locations
    | MasterLocations
    | MatchingConfigs
    | LayerFeatures
    | LocationAttributes
    | ProcessingLogs
  > => {
    const addressNormalizer = this.addressNormalizer;
    const addressVerifier = this.addressVerifier;
    const authorize = (s: Scope): boolean => this.authorize(s);

    return Effect.gen(function* () {
      const scope = ScopeStore.require();
      const clients = yield* Clients;
      const partitions = yield* Partitions;
      const locations = yield* Locations;
      const masters = yield* MasterLocations;
      const matchingConfigs = yield* MatchingConfigs;
      const layerFeatures = yield* LayerFeatures;
      const locationAttributes = yield* LocationAttributes;
      const processingLog = yield* ProcessingLogs;

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

      // Validate attributes early so a bad payload fails before we hit
      // libpostal / fuzzy matching.
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

      const client = yield* clients.findById(clientId);
      if (!client) {
        return yield* Effect.fail(
          new NotFoundError({
            code: 'CLIENT_NOT_FOUND',
            message: `Client '${clientId}' not found.`,
          }),
        );
      }

      if (partitionId) {
        const partition = yield* partitions.findById(partitionId);
        if (!partition) {
          return yield* Effect.fail(
            new NotFoundError({
              code: 'PARTITION_NOT_FOUND',
              message: `Partition '${partitionId}' not found.`,
            }),
          );
        }
      }

      // Step 2: idempotent dedup.
      if (externalId) {
        const existing = yield* locations.findByExternalId(clientId, partitionId, externalId);
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
      // AddressNormalizer is the libpostal HTTP service — non-repo, no
      // Effect Tag. Wrap once with Effect.tryPromise.
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

      const config = yield* matchingConfigs.resolve(clientId, partitionId);

      const hashHit = yield* masters.findByHash(clientId, partitionId, addressHash);
      const validatedHashHit = hashHit && hashHit.status === 'VALIDATED' ? hashHit : null;

      const fuzzyCandidates = yield* masters.findFuzzyCandidates(
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

      // Step 8: optional LLM verifier for fuzzy matches. AddressVerifier is
      // the LLM service — non-repo, no Effect Tag. Wrap once.
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
        yield* Effect.ignore(
          processingLog.append(asMasterLocationId(matchResult.masterLocationId), 'normalized', {
            input: address,
            house_number: normalized.houseNumber,
            road: normalized.road,
            suburb: normalized.suburb,
            city: normalized.city,
            state: normalized.state,
            postal_code: normalized.postalCode,
            country: normalized.country,
            address_hash: addressHash,
          }),
        );
        yield* Effect.ignore(
          processingLog.append(asMasterLocationId(matchResult.masterLocationId), 'matched', {
            method: matchResult.method,
            confidence: matchResult.confidence,
            location_id: locationId,
          }),
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
          yield* locationAttributes.insertMany(attrs, tx);
        }

        if (
          masterValidated &&
          matchedMaster &&
          matchedMaster.latitude !== null &&
          matchedMaster.longitude !== null
        ) {
          const lat = matchedMaster.latitude;
          const lon = matchedMaster.longitude;
          const hits = yield* layerFeatures.spatialLookup({
            clientId,
            partitionId,
            latitude: lat,
            longitude: lon,
            layerCodes: null,
          });
          yield* layerFeatures.replaceLocationFeatureAssociations(
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
          yield* commitAggregate(location, validatedEvent, command);
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

      yield* Effect.ignore(
        processingLog.append(masterId, 'normalized', {
          input: address,
          house_number: normalized.houseNumber,
          road: normalized.road,
          suburb: normalized.suburb,
          city: normalized.city,
          state: normalized.state,
          postal_code: normalized.postalCode,
          country: normalized.country,
          address_hash: addressHash,
        }),
      );
      yield* Effect.ignore(
        processingLog.append(masterId, 'created', {
          reason: 'no_match',
          candidates_checked: candidates.length,
        }),
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
        const tx = TransactionStore.require();
        yield* locationAttributes.insertMany(attrs, tx);
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
