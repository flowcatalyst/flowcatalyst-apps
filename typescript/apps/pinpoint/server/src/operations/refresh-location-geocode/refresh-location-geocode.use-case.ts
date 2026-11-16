/**
 * Renew a location's cached third-party geocode before it expires — or, once
 * it has expired without a successful renewal, delete it. Google Maps' terms
 * allow caching its coordinates for 30 days (`geocode-retention.ts`); the
 * daily `pinpoint-refresh-cached-geocodes` job runs this for every location
 * expiring within the refresh margin.
 *
 *   - Geocodes the location again (Photon first, Google as the fallback). A
 *     Photon result replaces the Google one for good (no expiry); a Google
 *     result restarts the 30 days. Status is unchanged.
 *   - If that fails and the expiry has passed, the coordinates — and the
 *     features derived from them — are deleted and the location returns to
 *     PENDING (`location:geocode_expired`). Before expiry a failure is just
 *     reported; the next day's run retries.
 */
import {
  Result,
  ScopeStore,
  TransactionStore,
  UseCaseError,
  commitAggregate,
  type AggregateRegistryImpl,
  type Scope,
  type UnitOfWork,
} from '@pinpoint/framework';
import { PinpointPermission } from '@pinpoint/shared';

import { Location } from '../../domain/locations/location.js';
import { asLocationId } from '../../domain/locations/ids.js';
import { addressDetailsFromLocation } from '../../domain/locations/events/address-details.js';
import { LocationGeocodeRefreshed } from '../../domain/locations/events/location-geocode-refreshed.event.js';
import { LocationGeocodeExpired } from '../../domain/locations/events/location-geocode-expired.event.js';
import type { LocationRepository } from '../../domain/locations/location.repository.js';
import type { LayerFeatureRepository } from '../../domain/layers/layer-feature.repository.js';
import {
  ProcessingStep,
  type ProcessingLogRepository,
} from '../../domain/locations/processing-log.repository.js';
import type { GeocoderService, GeocodingResult } from '../../domain/services/geocoder.js';
import { geocodeExpiry } from '../../domain/services/geocode-retention.js';
import { isUnresolved } from '../../domain/services/address-normalizer.js';
import { associateLocationFeatures } from '../../domain/services/location-features.js';
import { trail } from '../_shared/load-location.js';
import type { RefreshLocationGeocodeCommand } from './refresh-location-geocode.command.js';

export class RefreshLocationGeocodeUseCase {
  static readonly requiredPermission = PinpointPermission.LocationsLocationGeocode;

  constructor(
    private readonly uow: UnitOfWork,
    private readonly registry: AggregateRegistryImpl,
    private readonly locations: LocationRepository,
    private readonly layerFeatures: LayerFeatureRepository,
    private readonly geocoder: GeocoderService,
    private readonly processingLog: ProcessingLogRepository,
    /** Days a Google geocode may be kept (≤ 30). */
    private readonly googleCacheDays: number,
  ) {}

  async execute(
    command: RefreshLocationGeocodeCommand,
  ): Promise<Result<LocationGeocodeRefreshed | LocationGeocodeExpired>> {
    const scope = ScopeStore.require();
    if (!this.authorize(scope)) {
      return Result.failure(
        UseCaseError.authorization(
          'PERMISSION_DENIED',
          `Missing permission ${RefreshLocationGeocodeUseCase.requiredPermission}.`,
        ),
      );
    }

    const location = await this.locations.findById(asLocationId(command.locationId.trim()));
    if (!location) {
      return Result.failure(
        UseCaseError.notFound('LOCATION_NOT_FOUND', `Location '${command.locationId}' not found.`),
      );
    }
    if (location.geocodeSource !== 'GOOGLE_MAPS' || location.geocodeExpiresAt === null) {
      return Result.failure(
        UseCaseError.businessRule(
          'GEOCODE_NOT_CACHED',
          'Location has no cached third-party geocode to refresh.',
        ),
      );
    }

    const now = new Date();
    let result: GeocodingResult;
    try {
      result = await this.regeocode(location);
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : String(cause);
      if (location.geocodeExpiresAt.getTime() > now.getTime()) {
        return Result.failure(UseCaseError.infrastructure('GEOCODER_FAILED', reason));
      }
      const expired = Location.geocodeExpired(location, now);
      // The features were derived from Google's point — they go too.
      await associateLocationFeatures(this.layerFeatures, expired, TransactionStore.get());
      const committed = await commitAggregate(
        this.uow,
        this.registry,
        expired,
        new LocationGeocodeExpired(scope, {
          locationId: location.id,
          clientId: location.clientId,
          source: 'GOOGLE_MAPS',
          reason,
        }),
        command,
      );
      await trail(() =>
        this.processingLog.append({ locationId: location.id }, ProcessingStep.GeocodeExpired, {
          reason,
        }),
      );
      return committed;
    }

    const expiresAt = geocodeExpiry(result.source, now, this.googleCacheDays);
    const refreshed = Location.regeocoded(
      location,
      {
        latitude: result.latitude,
        longitude: result.longitude,
        source: result.source,
        confidence: result.confidence,
        roadMatched: result.roadMatched,
        expiresAt,
        address: null,
      },
      now,
    );
    if (refreshed.status === 'VALIDATED') {
      await associateLocationFeatures(this.layerFeatures, refreshed, TransactionStore.get());
    }
    const committed = await commitAggregate(
      this.uow,
      this.registry,
      refreshed,
      new LocationGeocodeRefreshed(scope, {
        locationId: location.id,
        clientId: location.clientId,
        latitude: result.latitude,
        longitude: result.longitude,
        confidence: result.confidence,
        source: result.source,
        expiresAt: expiresAt ? expiresAt.toISOString() : null,
      }),
      command,
    );
    await trail(() =>
      this.processingLog.append({ locationId: location.id }, ProcessingStep.GeocodeRefreshed, {
        source: result.source,
        expires_at: expiresAt?.toISOString() ?? null,
      }),
    );
    return committed;
  }

  /** The same query shape the location was geocoded with. */
  private regeocode(location: Location): Promise<GeocodingResult> {
    if (location.normalizedCity && !isUnresolved(location.normalizedCity)) {
      return this.geocoder.geocode(addressDetailsFromLocation(location));
    }
    return this.geocoder.geocodeText(location.matchAddress, {
      countryCode: isUnresolved(location.rawCountry) ? null : location.rawCountry,
    });
  }

  private authorize(scope: Scope): boolean {
    return scope.permissions.has(RefreshLocationGeocodeUseCase.requiredPermission);
  }
}
