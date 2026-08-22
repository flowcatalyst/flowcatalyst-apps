import {
  Result,
  ScopeStore,
  UseCaseError,
  commitAggregate,
  type AggregateRegistryImpl,
  type Scope,
  type UnitOfWork,
} from '@pinpoint/framework';
import { PinpointPermission } from '@pinpoint/shared';
import { MasterLocation } from '../../domain/locations/master-location.js';
import { asClientId } from '../../domain/tenancy/ids.js';
import { asMasterLocationId } from '../../domain/locations/ids.js';
import {
  addressHash as computeAddressHash,
  toAddressLine,
  type NormalizedAddress,
} from '../../domain/services/address-normalizer.js';
import { ProcessingStep } from '../../domain/locations/processing-log.repository.js';
import { MasterLocationGeocodeConfirmed } from '../../domain/locations/events/master-location-geocode-confirmed.event.js';
import type { MasterLocationRepository } from '../../domain/locations/master-location.repository.js';
import type { ProcessingLogRepository } from '../../domain/locations/processing-log.repository.js';
import type { ConfirmMasterLocationGeocodeCommand } from './confirm-master-location-geocode.command.js';

/**
 * Operator-confirmed geocode: the address components (typically from a
 * reverse-geocode suggestion, possibly edited) and the coordinates are
 * applied to the master in one step — hash + address line recomputed, status
 * → GEOCODED — so `confirm-master-location` can canonicalise it next.
 */
export class ConfirmMasterLocationGeocodeUseCase {
  static readonly requiredPermission = PinpointPermission.LocationsMasterLocationValidate;

  constructor(
    private readonly uow: UnitOfWork,
    private readonly registry: AggregateRegistryImpl,
    private readonly masters: MasterLocationRepository,
    private readonly processingLog: ProcessingLogRepository,
  ) {}

  async execute(
    command: ConfirmMasterLocationGeocodeCommand,
  ): Promise<Result<MasterLocationGeocodeConfirmed>> {
    const scope = ScopeStore.require();
    if (!this.authorize(scope)) {
      return Result.failure(
        UseCaseError.authorization(
          'PERMISSION_DENIED',
          `Missing permission ${ConfirmMasterLocationGeocodeUseCase.requiredPermission}.`,
        ),
      );
    }
    const clientId = asClientId(command.clientId.trim());
    const masterLocationId = asMasterLocationId(command.masterLocationId.trim());

    const existing = await this.masters.findById(masterLocationId);
    if (!existing || existing.clientId !== clientId) {
      return Result.failure(
        UseCaseError.notFound(
          'MASTER_LOCATION_NOT_FOUND',
          `Master location '${masterLocationId}' not found.`,
        ),
      );
    }

    const normalized: NormalizedAddress = {
      houseNumber: command.houseNumber ?? null,
      road: command.road ?? null,
      suburb: command.suburb ?? null,
      city: command.city,
      state: command.state ?? null,
      postalCode: command.postalCode ?? null,
      country: command.country,
    };
    const addressHash = computeAddressHash(normalized);
    const normalizedAddressLine = toAddressLine(normalized);
    const now = new Date();
    const updated = MasterLocation.geocoded(
      MasterLocation.updated(existing, {
        normalizedHouseNumber: normalized.houseNumber,
        normalizedRoad: normalized.road,
        normalizedSuburb: normalized.suburb,
        normalizedCity: normalized.city,
        normalizedState: normalized.state,
        normalizedPostalCode: normalized.postalCode,
        normalizedCountry: normalized.country,
        addressHash,
        normalizedAddressLine,
        now,
      }),
      { latitude: command.latitude, longitude: command.longitude },
      now,
    );

    try {
      await this.processingLog.append(masterLocationId, ProcessingStep.ConfirmGeocode, {
        ...normalized,
        latitude: command.latitude,
        longitude: command.longitude,
        source: 'operator:confirm-geocode',
      });
    } catch {
      // The processing log is a best-effort trail; never fail the operation on it.
    }

    const event = new MasterLocationGeocodeConfirmed(scope, {
      masterLocationId,
      clientId,
      ...normalized,
      latitude: command.latitude,
      longitude: command.longitude,
      addressHash,
      normalizedAddressLine,
    });
    return commitAggregate(this.uow, this.registry, updated, event, command);
  }

  private authorize(scope: Scope): boolean {
    return scope.permissions.has(ConfirmMasterLocationGeocodeUseCase.requiredPermission);
  }
}
