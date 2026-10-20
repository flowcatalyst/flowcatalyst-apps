/**
 * The geocode routes check pinpoint's own master locations before calling a
 * geocoder: a VALIDATED master for the same address (exact duplicate, or one
 * the address verifier confirms) answers the request with its stored
 * coordinates — `source: MASTER_LOCATIONS`. `forceGeocode: true` skips the
 * check. Only masters the caller may see are considered (partition access, as
 * for the reports); `clientId` / `partitionId` narrow it further.
 */
import { Type } from '@sinclair/typebox';
import type { FastifyReply } from 'fastify';
import { PinpointPermission } from '@pinpoint/shared';
import type { AppContext } from '../../../app-context.js';
import { asClientId, asPartitionId } from '../../../domain/tenancy/ids.js';
import { MASTER_GEOCODE_SOURCES } from '../../../domain/locations/master-location.js';
import { addressDetailsFromMaster } from '../../../domain/locations/events/address-details.js';
import { lookupMasterLocation } from '../../../domain/services/master-lookup.js';
import type { GeocodingResult } from '../../../domain/services/geocoder.js';
import { authorizePartitionAccess } from '../reporting/access.js';

/** Request fields shared by the forward + address geocode routes. */
export const MasterFirstFields = {
  /** Skip the master-location check and always call the geocoder. */
  forceGeocode: Type.Optional(Type.Boolean({ default: false })),
  /** Only check this client's master locations. */
  clientId: Type.Optional(Type.String({ minLength: 1 })),
  /** Only check this partition's master locations. */
  partitionId: Type.Optional(Type.String({ minLength: 1 })),
};

const Nullable = <T extends ReturnType<typeof Type.String>>(t: T) => Type.Union([t, Type.Null()]);

/** Response fields shared by the forward + address geocode routes. */
export const GeocodeSourceFields = {
  /** Where the coordinates came from. */
  source: Type.Union([
    Type.Literal('MASTER_LOCATIONS'),
    Type.Literal('PHOTON'),
    Type.Literal('GOOGLE_MAPS'),
  ]),
  /** The matched master location (source MASTER_LOCATIONS), else null. */
  masterLocationId: Nullable(Type.String()),
  /** How the master matched: an exact address-line duplicate, or verified by the model. */
  matchMethod: Type.Union([Type.Literal('EXACT_HASH'), Type.Literal('FUZZY'), Type.Null()]),
  /** Who produced the matched master's coordinates (PHOTON / GOOGLE_MAPS / OPERATOR). */
  geocodeSource: Type.Union([
    ...MASTER_GEOCODE_SOURCES.map((s) => Type.Literal(s)),
    Type.Null(),
  ]),
};

export interface MasterFirstRequest {
  readonly forceGeocode?: boolean | undefined;
  readonly clientId?: string | undefined;
  readonly partitionId?: string | undefined;
}

/** A geocoder result, in the routes' response shape. */
export function fromGeocoder(result: GeocodingResult) {
  return {
    latitude: result.latitude,
    longitude: result.longitude,
    confidence: result.confidence,
    formattedAddress: result.formattedAddress,
    address: result.address,
    roadMatched: result.roadMatched,
    query: result.query,
    source: result.source,
    masterLocationId: null,
    matchMethod: null,
    geocodeSource: null,
  };
}

/**
 * The master-location answer for `addressLine`, or `null` to go on to the
 * geocoder. `'denied'` means a 403 was already sent (the caller named a client
 * or partition they can't see).
 */
export async function answerFromMasters(
  reply: FastifyReply,
  appContext: AppContext,
  request: MasterFirstRequest,
  addressLine: string,
): Promise<ReturnType<typeof fromMaster> | null | 'denied'> {
  if (request.forceGeocode) return null;
  const access = await authorizePartitionAccess(
    reply,
    appContext,
    PinpointPermission.MatchingSpatialLookup,
    { clientId: request.clientId, partitionId: request.partitionId },
  );
  if (!access) return 'denied';

  const clientId = request.clientId ? asClientId(request.clientId) : undefined;
  const partitionId = request.partitionId ? asPartitionId(request.partitionId) : undefined;
  const config = await appContext.repositories.matchingConfigs.resolve(
    clientId ?? null,
    partitionId ?? null,
  );
  const match = await lookupMasterLocation(
    {
      masters: appContext.repositories.masterLocations,
      locations: appContext.repositories.locations,
      verifier: appContext.services.addressVerifier,
    },
    {
      addressLine,
      threshold: config.overallThreshold,
      scope: {
        visibleTo: access.all
          ? null
          : { partitionIds: access.partitionIds, clientIds: access.clientIds },
        clientId,
        partitionId,
      },
    },
  );
  return match ? fromMaster(match, addressLine) : null;
}

function fromMaster(
  match: NonNullable<Awaited<ReturnType<typeof lookupMasterLocation>>>,
  addressLine: string,
) {
  const { master } = match;
  return {
    latitude: master.latitude!,
    longitude: master.longitude!,
    confidence: match.confidence,
    formattedAddress: master.normalizedAddressLine,
    address: addressDetailsFromMaster(master),
    roadMatched: null,
    query: addressLine,
    source: 'MASTER_LOCATIONS' as const,
    masterLocationId: master.id as string,
    matchMethod: match.method,
    geocodeSource: master.geocodeSource,
  };
}
