/**
 * Renew a master's cached third-party geocode before it expires — or, once it
 * has expired without a successful renewal, delete it. Google Maps' terms
 * allow caching its coordinates for 30 days (see `geocode-retention.ts`); the
 * daily `pinpoint-refresh-cached-geocodes` job runs this for every master
 * expiring within the refresh margin.
 *
 *   - Geocodes the master again (Photon first, Google as the fallback). A
 *     Photon result replaces the Google one for good (no expiry); a Google
 *     result restarts the 30 days. Status is unchanged.
 *   - If that fails and the expiry has passed, the coordinates are dropped and
 *     the master returns to PENDING (`MasterLocationGeocodeExpired`), so it is
 *     geocoded and reviewed again. Before expiry a failure is just reported —
 *     the next day's run retries.
 */
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
import { asMasterLocationId } from '../../domain/locations/ids.js';
import { addressDetailsFromMaster } from '../../domain/locations/events/address-details.js';
import { MasterLocationGeocodeRefreshed } from '../../domain/locations/events/master-location-geocode-refreshed.event.js';
import { MasterLocationGeocodeExpired } from '../../domain/locations/events/master-location-geocode-expired.event.js';
import type { MasterLocationRepository } from '../../domain/locations/master-location.repository.js';
import type { GeocoderService, GeocodingResult } from '../../domain/services/geocoder.js';
import { geocodeExpiry } from '../../domain/services/geocode-retention.js';
import { isUnresolved } from '../../domain/services/address-normalizer.js';
import type { RefreshMasterLocationGeocodeCommand } from './refresh-master-location-geocode.command.js';

export class RefreshMasterLocationGeocodeUseCase {
  static readonly requiredPermission = PinpointPermission.LocationsMasterLocationValidate;

  constructor(
    private readonly uow: UnitOfWork,
    private readonly registry: AggregateRegistryImpl,
    private readonly masters: MasterLocationRepository,
    private readonly geocoder: GeocoderService,
    /** Days a Google geocode may be kept (≤ 30). */
    private readonly googleCacheDays: number,
  ) {}

  async execute(
    command: RefreshMasterLocationGeocodeCommand,
  ): Promise<Result<MasterLocationGeocodeRefreshed | MasterLocationGeocodeExpired>> {
    const scope = ScopeStore.require();
    if (!this.authorize(scope)) {
      return Result.failure(
        UseCaseError.authorization(
          'PERMISSION_DENIED',
          `Missing permission ${RefreshMasterLocationGeocodeUseCase.requiredPermission}.`,
        ),
      );
    }

    const masterId = asMasterLocationId(command.masterLocationId.trim());
    const master = await this.masters.findById(masterId);
    if (!master) {
      return Result.failure(
        UseCaseError.notFound('MASTER_LOCATION_NOT_FOUND', `Master location '${masterId}' not found.`),
      );
    }
    if (master.geocodeSource !== 'GOOGLE_MAPS' || master.geocodeExpiresAt === null) {
      return Result.failure(
        UseCaseError.businessRule(
          'GEOCODE_NOT_CACHED',
          'Master location has no cached third-party geocode to refresh.',
        ),
      );
    }

    const now = new Date();
    let geocode: GeocodingResult;
    try {
      geocode = await this.regeocode(master);
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : String(cause);
      if (master.geocodeExpiresAt.getTime() > now.getTime()) {
        return Result.failure(UseCaseError.infrastructure('GEOCODER_FAILED', reason));
      }
      const event = new MasterLocationGeocodeExpired(scope, {
        masterLocationId: master.id,
        clientId: master.clientId,
        source: 'GOOGLE_MAPS',
        reason,
      });
      return commitAggregate(
        this.uow,
        this.registry,
        MasterLocation.geocodeExpired(master, now),
        event,
        command,
      );
    }

    const expiresAt = geocodeExpiry(geocode.source, now, this.googleCacheDays);
    const updated = MasterLocation.regeocoded(
      master,
      {
        latitude: geocode.latitude,
        longitude: geocode.longitude,
        source: geocode.source,
        expiresAt,
      },
      now,
    );
    const event = new MasterLocationGeocodeRefreshed(scope, {
      masterLocationId: master.id,
      clientId: master.clientId,
      latitude: geocode.latitude,
      longitude: geocode.longitude,
      confidence: geocode.confidence,
      source: geocode.source,
      expiresAt: expiresAt ? expiresAt.toISOString() : null,
    });
    return commitAggregate(this.uow, this.registry, updated, event, command);
  }

  /** Same query shape the master was first geocoded with. */
  private regeocode(master: MasterLocation): Promise<GeocodingResult> {
    if (master.normalizedAddressLine && isUnresolved(master.normalizedCity)) {
      return this.geocoder.geocodeText(master.normalizedAddressLine, {
        countryCode: isUnresolved(master.normalizedCountry) ? null : master.normalizedCountry,
      });
    }
    return this.geocoder.geocode(addressDetailsFromMaster(master));
  }

  private authorize(scope: Scope): boolean {
    return scope.permissions.has(RefreshMasterLocationGeocodeUseCase.requiredPermission);
  }
}
