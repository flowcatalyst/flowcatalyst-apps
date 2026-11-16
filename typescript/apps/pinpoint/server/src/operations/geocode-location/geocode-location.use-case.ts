/**
 * Geocode a location: PENDING (or GEOCODED, to redo it) → GEOCODED.
 *
 * Uses the configured geocoder — Photon, falling back to Google Maps when
 * Photon can't place the house. A location whose components are still
 * unknown (city UNKNOWN: it came in as a raw line) is geocoded from its match
 * address as free text, and the components the geocoder resolved are stored
 * on it — unless the geocoder only found a best guess on some other road. A
 * location with components (an operator set them) is geocoded from those.
 *
 * Google coordinates carry an expiry (30 days, `geocode-retention.ts`); the
 * daily refresh job renews or deletes them. Approval (and, for our own
 * geocodes, master-location creation) is a separate step: `approve-location`,
 * run by the auto-approval batch when the geocode is good enough.
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

import { Location } from '../../domain/locations/location.js';
import { LocationGeocoded } from '../../domain/locations/events/location-geocoded.event.js';
import { addressDetailsFromLocation } from '../../domain/locations/events/address-details.js';
import type { LocationRepository } from '../../domain/locations/location.repository.js';
import {
  ProcessingStep,
  type ProcessingLogRepository,
} from '../../domain/locations/processing-log.repository.js';
import type { GeocoderService, GeocodingResult } from '../../domain/services/geocoder.js';
import {
  GOOGLE_MAPS_MAX_CACHE_DAYS,
  geocodeExpiry,
} from '../../domain/services/geocode-retention.js';
import { isUnresolved } from '../../domain/services/address-normalizer.js';
import { loadClientLocation, trail } from '../_shared/load-location.js';
import type { GeocodeLocationCommand } from './geocode-location.command.js';

export class GeocodeLocationUseCase {
  static readonly requiredPermission = PinpointPermission.LocationsLocationGeocode;

  constructor(
    private readonly uow: UnitOfWork,
    private readonly registry: AggregateRegistryImpl,
    private readonly locations: LocationRepository,
    private readonly geocoder: GeocoderService,
    private readonly processingLog: ProcessingLogRepository,
    /** Days a Google geocode may be kept (≤ 30). */
    private readonly googleCacheDays: number = GOOGLE_MAPS_MAX_CACHE_DAYS,
  ) {}

  async execute(command: GeocodeLocationCommand): Promise<Result<LocationGeocoded>> {
    const scope = ScopeStore.require();
    if (!this.authorize(scope)) {
      return Result.failure(
        UseCaseError.authorization(
          'PERMISSION_DENIED',
          `Missing permission ${GeocodeLocationUseCase.requiredPermission}.`,
        ),
      );
    }

    const loaded = await loadClientLocation(this.locations, command.clientId, command.locationId);
    if (!loaded.ok) return Result.failure(loaded.error);
    const location = loaded.location;
    if (location.status !== 'PENDING' && location.status !== 'GEOCODED') {
      return Result.failure(
        UseCaseError.businessRule(
          'LOCATION_NOT_GEOCODABLE',
          `Location is ${location.status}; only PENDING or GEOCODED locations are geocoded.`,
        ),
      );
    }

    const unparsed = location.normalizedCity === null || isUnresolved(location.normalizedCity);
    let result: GeocodingResult;
    try {
      result = unparsed
        ? await this.geocoder.geocodeText(location.matchAddress, {
            countryCode: isUnresolved(location.rawCountry) ? null : location.rawCountry,
          })
        : await this.geocoder.geocode(addressDetailsFromLocation(location));
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      return Result.failure(UseCaseError.infrastructure('GEOCODER_FAILED', message));
    }

    const now = new Date();
    const expiresAt = geocodeExpiry(result.source, now, this.googleCacheDays);
    // A best guess on some other road gets coordinates but not that road's
    // components — the location waits for review (auto-approval skips it).
    const updated = Location.geocoded(
      location,
      {
        latitude: result.latitude,
        longitude: result.longitude,
        source: result.source,
        confidence: result.confidence,
        roadMatched: result.roadMatched,
        expiresAt,
        address: unparsed && result.roadMatched !== false ? result.address : null,
      },
      now,
    );

    const event = new LocationGeocoded(scope, {
      locationId: location.id,
      clientId: location.clientId,
      latitude: result.latitude,
      longitude: result.longitude,
      confidence: result.confidence,
      formattedAddress: result.formattedAddress,
      address: result.address,
      source: result.source,
      expiresAt: expiresAt ? expiresAt.toISOString() : null,
    });
    const committed = await commitAggregate(this.uow, this.registry, updated, event, command);

    await trail(() =>
      this.processingLog.append({ locationId: location.id }, ProcessingStep.Geocoded, {
        source: result.source,
        confidence: result.confidence,
        road_matched: result.roadMatched,
        query: result.query,
        formatted_address: result.formattedAddress,
        expires_at: expiresAt?.toISOString() ?? null,
      }),
    );
    return committed;
  }

  private authorize(scope: Scope): boolean {
    return scope.permissions.has(GeocodeLocationUseCase.requiredPermission);
  }
}
