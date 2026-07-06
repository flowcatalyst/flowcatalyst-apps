/**
 * Rematch a location against an edited "match address".
 *
 * The location's received address (raw_address_line1) is immutable; its
 * match_address is editable. This use case sets the new match_address,
 * re-normalizes it, and re-runs the same matching pipeline create-location uses
 * (exact-hash + fuzzy + optional LLM verify against VALIDATED masters):
 *   - resolves to a VALIDATED master → re-point the location + validate it
 *     (spatial lookup → feature associations), status VALIDATED.
 *   - no match → create a fresh PENDING master + point the location at it.
 *
 * When the new master differs from the old one, the old master is deleted IFF
 * it is PENDING (auto-created) and nothing else links to it (cascade). If other
 * locations still link, it is left alone and only this association moves.
 *
 * Everything runs inside the caller's single runWrite transaction.
 */
import { generateTsid } from '@flowcatalyst/sdk';
import {
  Result,
  ScopeStore,
  UseCaseError,
  commitAggregate,
  commitDelete,
  isFailure,
  type AggregateRegistryImpl,
  type Scope,
  type UnitOfWork,
} from '@pinpoint/framework';
import { PinpointPermission } from '@pinpoint/shared';

import { MasterLocation } from '../../domain/locations/master-location.js';
import { asClientId } from '../../domain/tenancy/ids.js';
import {
  asLocationId,
  asMasterLocationId,
  MASTER_LOCATION_ID_PREFIX,
} from '../../domain/locations/ids.js';
import { LocationRematched } from '../../domain/locations/events/location-rematched.event.js';
import { LocationValidated } from '../../domain/locations/events/location-validated.event.js';
import { MasterLocationCreated } from '../../domain/locations/events/master-location-created.event.js';
import { MasterLocationDeleted } from '../../domain/locations/events/master-location-deleted.event.js';
import { findMatch } from '../../domain/services/address-matcher.js';
import { hitToAssociation, hitToProperty } from '../../domain/services/spatial-hit-mappers.js';
import {
  addressHash as computeAddressHash,
  toAddressLine,
  type AddressNormalizer,
  type NormalizedAddress,
} from '../../domain/services/address-normalizer.js';
import type { Location } from '../../domain/locations/location.js';
import type { AddressVerifier } from '../../domain/services/address-verifier.js';
import type { LocationRepository } from '../../domain/locations/location.repository.js';
import type { MasterLocationRepository } from '../../domain/locations/master-location.repository.js';
import type { MatchingConfigRepository } from '../../domain/matching/matching-config.repository.js';
import type { LayerFeatureRepository } from '../../domain/layers/layer-feature.repository.js';
import {
  ProcessingStep,
  type ProcessingLogRepository,
} from '../../domain/locations/processing-log.repository.js';
import type { RematchLocationCommand } from './rematch-location.command.js';

const FUZZY_THRESHOLD = 0.3;
const FUZZY_LIMIT = 50;

export class RematchLocationUseCase {
  static readonly requiredPermission = PinpointPermission.LocationsLocationUpdate;

  constructor(
    private readonly uow: UnitOfWork,
    private readonly registry: AggregateRegistryImpl,
    private readonly locations: LocationRepository,
    private readonly masters: MasterLocationRepository,
    private readonly matchingConfigs: MatchingConfigRepository,
    private readonly layerFeatures: LayerFeatureRepository,
    private readonly processingLog: ProcessingLogRepository,
    private readonly addressNormalizer: AddressNormalizer,
    private readonly addressVerifier: AddressVerifier,
  ) {}

  async execute(command: RematchLocationCommand): Promise<Result<LocationRematched>> {
    const scope = ScopeStore.require();

    if (!this.authorize(scope)) {
      return Result.failure(
        UseCaseError.authorization(
          'PERMISSION_DENIED',
          `Missing permission ${PinpointPermission.LocationsLocationUpdate}.`,
        ),
      );
    }

    const clientId = asClientId(command.clientId.trim());
    const locationId = asLocationId(command.locationId.trim());
    const matchAddress = command.matchAddress.trim();
    if (matchAddress.length === 0) {
      return Result.failure(
        UseCaseError.validation('MATCH_ADDRESS_REQUIRED', 'Match address must not be empty.'),
      );
    }

    const location = await this.locations.findById(locationId);
    if (!location) {
      return Result.failure(
        UseCaseError.notFound('LOCATION_NOT_FOUND', `Location '${locationId}' not found.`),
      );
    }
    if (location.clientId !== clientId) {
      return Result.failure(
        UseCaseError.businessRule(
          'LOCATION_CLIENT_MISMATCH',
          'Location belongs to a different client.',
        ),
      );
    }

    const partitionId = location.partitionId;
    const previousMasterId = location.masterLocationId;
    const now = new Date();

    // Normalize the new match address: strict, then best-effort so an
    // unparseable address still resolves (lands PENDING) rather than blocking.
    let normalized: NormalizedAddress;
    let normalizationBestEffort = false;
    try {
      normalized = await this.addressNormalizer.normalize(matchAddress);
    } catch {
      try {
        normalized = await this.addressNormalizer.normalize(matchAddress, { strict: false });
        normalizationBestEffort = true;
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        return Result.failure(
          UseCaseError.infrastructure('ADDRESS_NORMALIZATION_FAILED', message),
        );
      }
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

    // Optional LLM verifier for fuzzy matches — the verdict lands on the
    // candidate master's processing log (step `llm_verified`) whether it
    // confirms, rejects, or abstains, same as create-location.
    let llmRejectedMasterId: string | null = null;
    if (matchResult !== null && matchResult.method === 'FUZZY') {
      const candidate = candidates.find((c) => c.id === matchResult!.masterLocationId);
      if (candidate) {
        const candidateLine =
          candidate.normalizedAddressLine ??
          toAddressLine({
            houseNumber: candidate.normalizedHouseNumber,
            road: candidate.normalizedRoad,
            suburb: candidate.normalizedSuburb,
            city: candidate.normalizedCity,
            state: candidate.normalizedState,
            postalCode: candidate.normalizedPostalCode,
            country: candidate.normalizedCountry,
          });
        const verdict = await this.addressVerifier.verify(addressLine, candidateLine);
        try {
          await this.processingLog.append(candidate.id, ProcessingStep.LlmVerified, {
            input_address: addressLine,
            candidate_address: candidateLine,
            location_id: locationId,
            trigger: 'rematch',
            algorithmic_confidence: matchResult.confidence,
            outcome:
              verdict === null ? 'no_opinion' : verdict.match_confirmed ? 'confirmed' : 'rejected',
            match_confirmed: verdict?.match_confirmed ?? null,
            confidence: verdict?.confidence ?? null,
            reasoning: verdict?.reasoning ?? null,
          });
        } catch {
          // swallow
        }
        if (verdict && !verdict.match_confirmed) {
          llmRejectedMasterId = candidate.id;
          matchResult = null;
        }
      }
    }

    // Resolve the new master: a matched VALIDATED master, or a fresh PENDING one.
    let newMasterId: string;
    let matchedValidated = false;
    if (matchResult !== null) {
      newMasterId = matchResult.masterLocationId;
      matchedValidated = true; // candidates are VALIDATED-only
      try {
        await this.processingLog.append(asMasterLocationId(newMasterId), ProcessingStep.Matched, {
          method: matchResult.method,
          confidence: matchResult.confidence,
          location_id: locationId,
          trigger: 'rematch',
        });
      } catch {
        // swallow
      }
    } else {
      const created = asMasterLocationId(`${MASTER_LOCATION_ID_PREFIX}_${generateTsid()}`);
      const master = MasterLocation.create({
        id: created,
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
      const masterEvent = new MasterLocationCreated(scope, {
        masterLocationId: created,
        clientId,
        partitionId,
        addressHash,
        normalizedCity: normalized.city,
        normalizedCountry: normalized.country,
      });
      const masterCommit = await commitAggregate(this.uow, this.registry, master, masterEvent, command);
      if (isFailure(masterCommit)) return Result.failure(masterCommit.error);
      newMasterId = created;

      // Trail entries append AFTER the master commit — the FK to the
      // master row is checked per-statement even inside the shared tx.
      try {
        await this.processingLog.append(created, ProcessingStep.Normalized, {
          input: matchAddress,
          house_number: normalized.houseNumber,
          road: normalized.road,
          suburb: normalized.suburb,
          city: normalized.city,
          state: normalized.state,
          postal_code: normalized.postalCode,
          country: normalized.country,
          address_hash: addressHash,
          best_effort: normalizationBestEffort,
          trigger: 'rematch',
        });
      } catch {
        // swallow
      }
      try {
        await this.processingLog.append(created, ProcessingStep.Created, {
          reason: llmRejectedMasterId !== null ? 'llm_rejected' : 'no_match',
          candidates_checked: candidates.length,
          location_id: locationId,
          trigger: 'rematch',
          ...(llmRejectedMasterId !== null
            ? { rejected_master_location_id: llmRejectedMasterId }
            : {}),
        });
      } catch {
        // swallow
      }
    }

    // Re-point + re-normalize the location.
    const updated: Location = {
      ...location,
      masterLocationId: asMasterLocationId(newMasterId),
      matchAddress,
      normalizedHouseNumber: normalized.houseNumber,
      normalizedRoad: normalized.road,
      normalizedSuburb: normalized.suburb,
      normalizedCity: normalized.city,
      normalizedState: normalized.state,
      normalizedPostalCode: normalized.postalCode,
      normalizedCountry: normalized.country,
      addressHash,
      matchConfidence: matchResult?.confidence ?? null,
      matchMethod: matchResult?.method ?? null,
      status: matchedValidated ? 'VALIDATED' : 'PENDING',
      updatedAt: now,
    };

    // Decide old-master cleanup BEFORE committing the re-point, so listByMaster
    // reflects the pre-move state; we exclude this location explicitly.
    let previousMasterDeleted = false;
    let oldMaster = null as Awaited<ReturnType<MasterLocationRepository['findById']>> | null;
    if (previousMasterId !== null && previousMasterId !== newMasterId) {
      oldMaster = await this.masters.findById(asMasterLocationId(previousMasterId));
      if (oldMaster && oldMaster.status === 'PENDING') {
        const stillLinked = (await this.locations.listByMaster(asMasterLocationId(previousMasterId)))
          .filter((l) => l.id !== location.id);
        previousMasterDeleted = stillLinked.length === 0;
      }
    }

    const event = new LocationRematched(scope, {
      locationId: location.id,
      clientId: location.clientId,
      matchAddress,
      previousMasterLocationId: previousMasterId,
      masterLocationId: newMasterId,
      status: updated.status,
      previousMasterDeleted,
    });

    const primary = await commitAggregate(this.uow, this.registry, updated, event, command);
    if (isFailure(primary)) return primary;

    // Validated match → refresh feature associations + emit LocationValidated.
    if (matchedValidated) {
      const matchedMaster = candidates.find((c) => c.id === newMasterId);
      if (matchedMaster && matchedMaster.latitude !== null && matchedMaster.longitude !== null) {
        const hits = await this.layerFeatures.spatialLookup({
          clientId,
          partitionId,
          latitude: matchedMaster.latitude,
          longitude: matchedMaster.longitude,
          layerCodes: null,
        });
        await this.layerFeatures.replaceLocationFeatureAssociations(
          location.id,
          hits.map(hitToAssociation),
        );
        const validatedEvent = new LocationValidated(scope, {
          locationId: location.id,
          clientId: location.clientId,
          masterLocationId: newMasterId,
          latitude: matchedMaster.latitude,
          longitude: matchedMaster.longitude,
          layerProperties: hits.map(hitToProperty),
        });
        const validatedResult = await commitAggregate(
          this.uow,
          this.registry,
          updated,
          validatedEvent,
          command,
        );
        if (isFailure(validatedResult)) return Result.failure(validatedResult.error);
      }
    }

    // Cull the old orphaned PENDING master (cascade — it has no other links).
    if (previousMasterDeleted && oldMaster) {
      const deletedEvent = new MasterLocationDeleted(scope, {
        masterLocationId: oldMaster.id,
        clientId: oldMaster.clientId,
        locationsDeleted: 0,
      });
      const deleteResult = await commitDelete(this.uow, this.registry, oldMaster, deletedEvent, command);
      if (isFailure(deleteResult)) return Result.failure(deleteResult.error);
    }

    return primary;
  }

  private authorize(scope: Scope): boolean {
    return scope.permissions.has(RematchLocationUseCase.requiredPermission);
  }
}
