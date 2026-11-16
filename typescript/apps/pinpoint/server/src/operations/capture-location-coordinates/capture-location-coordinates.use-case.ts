/**
 * A delivery vehicle captured the coordinates of an address.
 *
 *   1. Reverse-geocode the point with Photon only — never Google: this is
 *      becoming our own reference data.
 *   2. Create a DRAFT master location there (source DELIVERY_CAPTURE). Its
 *      address is the driver's line when given, else Photon's; someone must
 *      capture it properly (`complete-master-location`) before it is used for
 *      matching.
 *   3. With an address, find the client's location for it (exact address
 *      hash, else the closest locations checked by the address verifier).
 *      When the capture lands further from that location than its accuracy
 *      allows (`capture-tolerance.ts`), flag the location for review. The
 *      location's coordinates are not changed.
 */
import { generateTsid } from '@flowcatalyst/sdk';
import {
  Result,
  ScopeStore,
  UseCaseError,
  commitAggregate,
  isFailure,
  type AggregateRegistryImpl,
  type Scope,
  type UnitOfWork,
} from '@pinpoint/framework';
import { PinpointPermission } from '@pinpoint/shared';

import { Location } from '../../domain/locations/location.js';
import { MasterLocation, masterAddressFrom } from '../../domain/locations/master-location.js';
import { asMasterLocationId, MASTER_LOCATION_ID_PREFIX } from '../../domain/locations/ids.js';
import { asClientId, asPartitionId } from '../../domain/tenancy/ids.js';
import { MasterLocationCaptured } from '../../domain/locations/events/master-location-captured.event.js';
import { LocationCaptureDisagrees } from '../../domain/locations/events/location-capture-disagrees.event.js';
import type { LocationRepository } from '../../domain/locations/location.repository.js';
import type { ClientRepository } from '../../domain/tenancy/client.repository.js';
import type { PartitionRepository } from '../../domain/tenancy/partition.repository.js';
import type { MatchingConfigRepository } from '../../domain/matching/matching-config.repository.js';
import {
  ProcessingStep,
  type ProcessingLogRepository,
} from '../../domain/locations/processing-log.repository.js';
import type { AddressVerifier } from '../../domain/services/address-verifier.js';
import type { GeocoderService } from '../../domain/services/geocoder.js';
import {
  UNRESOLVED_COMPONENT,
  type NormalizedAddress,
} from '../../domain/services/address-normalizer.js';
import { addressLineHash, tidyAddressLine } from '../../domain/services/address-line.js';
import { captureDisagrees, distanceM } from '../../domain/services/capture-tolerance.js';
import { trail } from '../_shared/load-location.js';
import type { CaptureLocationCoordinatesCommand } from './capture-location-coordinates.command.js';

/** Minimum trigram similarity / candidates checked when finding the location. */
const CANDIDATE_SIMILARITY = 0.3;
const CANDIDATES_VERIFIED = 5;

export class CaptureLocationCoordinatesUseCase {
  static readonly requiredPermission = PinpointPermission.LocationsCaptureCreate;

  constructor(
    private readonly uow: UnitOfWork,
    private readonly registry: AggregateRegistryImpl,
    private readonly clients: ClientRepository,
    private readonly partitions: PartitionRepository,
    private readonly locations: LocationRepository,
    private readonly matchingConfigs: MatchingConfigRepository,
    private readonly processingLog: ProcessingLogRepository,
    private readonly verifier: AddressVerifier,
    /** Photon — our own index. Never a third-party geocoder here. */
    private readonly reverseGeocoder: GeocoderService,
  ) {}

  async execute(command: CaptureLocationCoordinatesCommand): Promise<Result<MasterLocationCaptured>> {
    const scope = ScopeStore.require();
    if (!this.authorize(scope)) {
      return Result.failure(
        UseCaseError.authorization(
          'PERMISSION_DENIED',
          `Missing permission ${CaptureLocationCoordinatesUseCase.requiredPermission}.`,
        ),
      );
    }

    const clientId = asClientId(command.clientId.trim());
    if (!(await this.clients.findById(clientId))) {
      return Result.failure(UseCaseError.notFound('CLIENT_NOT_FOUND', `Client '${clientId}' not found.`));
    }
    const partitionId = command.partitionId ? asPartitionId(command.partitionId.trim()) : null;
    if (partitionId) {
      const partition = await this.partitions.findById(partitionId);
      if (!partition || partition.clientId !== clientId) {
        return Result.failure(
          UseCaseError.notFound('PARTITION_NOT_FOUND', `Partition '${partitionId}' not found.`),
        );
      }
    }

    const now = new Date();
    const capturedAt = command.capturedAt ? new Date(command.capturedAt) : now;
    const accuracyM = command.accuracyMeters ?? null;
    const point = { latitude: command.latitude, longitude: command.longitude };
    const givenLine = command.address ? tidyAddressLine(command.address) : null;

    // 1. Photon reverse geocode — a suggestion for whoever completes the draft.
    let reverse: { address: NormalizedAddress; formatted: string } | null = null;
    try {
      const r = await this.reverseGeocoder.reverseGeocode(point.latitude, point.longitude);
      reverse = { address: r.address, formatted: r.formattedAddress };
    } catch {
      // A DRAFT is still worth having: the coordinates are the valuable part.
    }

    // 2. The DRAFT master.
    const line = givenLine ?? tidyAddressLine(reverse?.formatted ?? '');
    const components: NormalizedAddress = reverse?.address ?? {
      houseNumber: null,
      road: null,
      suburb: null,
      city: UNRESOLVED_COMPONENT,
      state: null,
      postalCode: null,
      country: UNRESOLVED_COMPONENT,
    };
    const master = MasterLocation.fromCapture({
      id: asMasterLocationId(`${MASTER_LOCATION_ID_PREFIX}_${generateTsid()}`),
      clientId,
      partitionId,
      latitude: point.latitude,
      longitude: point.longitude,
      accuracyM,
      capturedAt,
      address: masterAddressFrom(
        { ...components, city: components.city || UNRESOLVED_COMPONENT, country: components.country || UNRESOLVED_COMPONENT },
        { addressHash: addressLineHash(line), normalizedAddressLine: line },
      ),
      now,
    });

    // 3. The client's location for the address, and whether the capture agrees.
    const location = givenLine ? await this.findLocation(clientId, partitionId, givenLine) : null;
    const distance =
      location && location.latitude !== null && location.longitude !== null
        ? distanceM(point, { latitude: location.latitude, longitude: location.longitude })
        : null;
    const disagrees = distance !== null && captureDisagrees(distance, accuracyM);

    const captured = await commitAggregate(
      this.uow,
      this.registry,
      master,
      new MasterLocationCaptured(scope, {
        masterLocationId: master.id,
        clientId,
        partitionId,
        latitude: point.latitude,
        longitude: point.longitude,
        accuracyMeters: accuracyM,
        capturedAt: capturedAt.toISOString(),
        locationId: location?.id ?? null,
        distanceMeters: distance === null ? null : Math.round(distance),
        disagrees,
      }),
      command,
    );
    if (isFailure(captured)) return captured;

    await trail(() =>
      this.processingLog.append({ masterLocationId: master.id }, ProcessingStep.Captured, {
        reference: command.reference ?? null,
        accuracy_m: accuracyM,
        given_address: command.address ?? null,
        reverse_geocoded: reverse?.formatted ?? null,
        location_id: location?.id ?? null,
        distance_m: distance === null ? null : Math.round(distance),
      }),
    );

    if (location && disagrees) {
      const flagged = await commitAggregate(
        this.uow,
        this.registry,
        Location.captureDisagrees(
          location,
          { masterLocationId: master.id, distanceM: Math.round(distance!) },
          now,
        ),
        new LocationCaptureDisagrees(scope, {
          locationId: location.id,
          clientId,
          masterLocationId: master.id,
          distanceMeters: Math.round(distance!),
          capturedLatitude: point.latitude,
          capturedLongitude: point.longitude,
        }),
        command,
      );
      if (isFailure(flagged)) return Result.failure(flagged.error);
      await trail(() =>
        this.processingLog.append({ locationId: location.id }, ProcessingStep.CaptureDisagrees, {
          master_location_id: master.id,
          distance_m: Math.round(distance!),
          accuracy_m: accuracyM,
        }),
      );
    }

    return captured;
  }

  /** Exact address hash first, else the closest locations the verifier confirms. */
  private async findLocation(
    clientId: ReturnType<typeof asClientId>,
    partitionId: ReturnType<typeof asPartitionId> | null,
    line: string,
  ): Promise<Location | null> {
    const scopePartition = partitionId ?? undefined;
    const exact = await this.locations.findByHash(clientId, scopePartition, addressLineHash(line));
    if (exact) return exact;
    const config = await this.matchingConfigs.resolve(clientId, partitionId);
    const candidates = await this.locations.findFuzzyCandidates(
      clientId,
      scopePartition,
      line,
      CANDIDATE_SIMILARITY,
      CANDIDATES_VERIFIED,
    );
    const verdicts = await Promise.all(
      candidates.map(async (candidate) => ({
        candidate,
        verdict: await this.verifier.verify(line, tidyAddressLine(candidate.matchAddress), {
          inputName: null,
          candidateNames: candidate.name ? [candidate.name] : [],
        }),
      })),
    );
    const best = verdicts
      .filter((v) => v.verdict?.match_confirmed && v.verdict.confidence >= config.overallThreshold)
      .toSorted((a, b) => b.verdict!.confidence - a.verdict!.confidence)[0];
    return best?.candidate ?? null;
  }

  private authorize(scope: Scope): boolean {
    return scope.permissions.has(CaptureLocationCoordinatesUseCase.requiredPermission);
  }
}
