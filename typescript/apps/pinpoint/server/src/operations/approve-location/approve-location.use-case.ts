/**
 * Approve a GEOCODED location: associate the layer features at its point,
 * GEOCODED → VALIDATED, emit `location:validated`.
 *
 * When the coordinates are our own — Photon (our OSM index) or an operator —
 * the location also becomes one of our master locations (VALIDATED, origin
 * LOCATION_APPROVAL), so later locations for the same address match it and
 * copy its data. Google Maps coordinates never do: they may only be cached.
 * No master is created when one with the same address hash already exists
 * in the client + partition.
 *
 * Run by an operator, or by the auto-approval batch when the geocode is on
 * the requested road, at the house, and confident enough
 * (`approve-geocoded-locations.ts`).
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

import { isOwnGeocode, Location } from '../../domain/locations/location.js';
import { MasterLocation, masterAddressFrom } from '../../domain/locations/master-location.js';
import { asMasterLocationId, MASTER_LOCATION_ID_PREFIX } from '../../domain/locations/ids.js';
import { addressDetailsFromLocation } from '../../domain/locations/events/address-details.js';
import { MasterLocationCreated } from '../../domain/locations/events/master-location-created.event.js';
import type { LocationValidated } from '../../domain/locations/events/location-validated.event.js';
import type { LocationRepository } from '../../domain/locations/location.repository.js';
import type { MasterLocationRepository } from '../../domain/locations/master-location.repository.js';
import type { LayerFeatureRepository } from '../../domain/layers/layer-feature.repository.js';
import {
  ProcessingStep,
  type ProcessingLogRepository,
} from '../../domain/locations/processing-log.repository.js';
import {
  associateLocationFeatures,
  locationValidatedEvent,
} from '../../domain/services/location-features.js';
import { addressLineHash, tidyAddressLine } from '../../domain/services/address-line.js';
import { loadClientLocation, trail } from '../_shared/load-location.js';
import type { ApproveLocationCommand } from './approve-location.command.js';

export class ApproveLocationUseCase {
  static readonly requiredPermission = PinpointPermission.LocationsLocationApprove;

  constructor(
    private readonly uow: UnitOfWork,
    private readonly registry: AggregateRegistryImpl,
    private readonly locations: LocationRepository,
    private readonly masters: MasterLocationRepository,
    private readonly layerFeatures: LayerFeatureRepository,
    private readonly processingLog: ProcessingLogRepository,
  ) {}

  async execute(command: ApproveLocationCommand): Promise<Result<LocationValidated>> {
    const scope = ScopeStore.require();
    if (!this.authorize(scope)) {
      return Result.failure(
        UseCaseError.authorization(
          'PERMISSION_DENIED',
          `Missing permission ${ApproveLocationUseCase.requiredPermission}.`,
        ),
      );
    }

    const loaded = await loadClientLocation(this.locations, command.clientId, command.locationId);
    if (!loaded.ok) return Result.failure(loaded.error);
    const location = loaded.location;
    if (location.status !== 'GEOCODED') {
      return Result.failure(
        UseCaseError.businessRule(
          'LOCATION_NOT_GEOCODED',
          `Location is ${location.status}; only a GEOCODED location can be approved.`,
        ),
      );
    }
    if (location.latitude === null || location.longitude === null) {
      return Result.failure(
        UseCaseError.businessRule('LOCATION_HAS_NO_COORDINATES', 'Location has no coordinates.'),
      );
    }

    const now = new Date();
    const approved = Location.approved(location, now);
    const hits = await associateLocationFeatures(this.layerFeatures, approved, TransactionStore.get());
    const validated = await commitAggregate(
      this.uow,
      this.registry,
      approved,
      locationValidatedEvent(scope, approved, hits),
      command,
    );
    if (isFailure(validated)) return validated;

    await trail(() =>
      this.processingLog.append({ locationId: location.id }, ProcessingStep.Approved, {
        geocode_source: location.geocodeSource,
        features: hits.length,
      }),
    );

    const master = await this.masterFrom(approved, now);
    if (master) {
      const created = await commitAggregate(
        this.uow,
        this.registry,
        master,
        new MasterLocationCreated(scope, {
          masterLocationId: master.id,
          clientId: master.clientId,
          partitionId: master.partitionId,
          addressHash: master.addressHash,
          normalizedCity: master.normalizedCity,
          normalizedCountry: master.normalizedCountry,
          origin: master.origin,
          originLocationId: master.originLocationId,
          latitude: master.latitude!,
          longitude: master.longitude!,
          geocodeSource: master.geocodeSource!,
        }),
        command,
      );
      if (isFailure(created)) return Result.failure(created.error);
      await trail(() =>
        this.processingLog.append({ locationId: location.id }, ProcessingStep.MasterCreated, {
          master_location_id: master.id,
        }),
      );
      await trail(() =>
        this.processingLog.append({ masterLocationId: master.id }, ProcessingStep.Created, {
          origin: 'LOCATION_APPROVAL',
          location_id: location.id,
          geocode_source: master.geocodeSource,
        }),
      );
    }

    return validated;
  }

  /** The master this approval contributes, or null (third-party data, or a duplicate). */
  private async masterFrom(location: Location, now: Date): Promise<MasterLocation | null> {
    if (!isOwnGeocode(location)) return null;
    const line = tidyAddressLine(location.matchAddress);
    const hash = location.addressHash ?? addressLineHash(line);
    const existing = await this.masters.findByHash(location.clientId, location.partitionId, hash);
    if (existing && existing.status !== 'REJECTED') return null;
    return MasterLocation.fromApprovedLocation(location, {
      id: asMasterLocationId(`${MASTER_LOCATION_ID_PREFIX}_${generateTsid()}`),
      address: masterAddressFrom(addressDetailsFromLocation(location), {
        addressHash: hash,
        normalizedAddressLine: line,
      }),
      now,
    });
  }

  private authorize(scope: Scope): boolean {
    return scope.permissions.has(ApproveLocationUseCase.requiredPermission);
  }
}
