/**
 * POST /geocode/address — geocode a RAW address line.
 *
 * The sibling `/geocode/forward` requires pre-parsed components (city and
 * country are mandatory). This route accepts the free-text line you actually
 * have and sends it to the geocoder as-is — no libpostal parse. Photon is a
 * free-text search engine; parsing the line into components only to join them
 * back into a string added a failure mode (mis-parses) without adding signal.
 *
 * Nothing is written: no location, no master location, no outbox event.
 *
 * The response returns the components the geocoder matched (`address`), the
 * exact upstream query that produced them (`query` — the geocoder may have
 * loosened the line), and whether the match sits on a road named in the line
 * (`roadMatched`).
 */
import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import { ScopeStore, UseCaseError } from '@pinpoint/framework';
import { PinpointPermission } from '@pinpoint/shared';
import type { AppContext } from '../../../app-context.js';
import { AddressDetailsSchema } from '../../../domain/locations/events/address-details.js';
import { sendUseCaseError } from '../../plugins/error-mapper.js';
import { ErrorResponseRef } from '../../plugins/error-response.schema.js';

const AddressGeocodeBodySchema = Type.Object({
  /** Free-text address line, e.g. `548 Market Street, San Francisco, CA 94104`. */
  address: Type.String({ minLength: 1 }),
  /**
   * Optional ISO country code hint. Widened to the country name and appended to
   * the line when the line doesn't already mention it.
   */
  countryCode: Type.Optional(
    Type.Union([Type.String({ minLength: 2, maxLength: 3 }), Type.Null()]),
  ),
});

const AddressGeocodeResponseSchema = Type.Object({
  latitude: Type.Number(),
  longitude: Type.Number(),
  confidence: Type.Number(),
  formattedAddress: Type.Union([Type.String(), Type.Null()]),
  /** Components of the address the geocoder actually matched. */
  address: AddressDetailsSchema,
  /**
   * Whether the matched road appears in the line. False means the geocoder
   * found nothing on a road the line names and returned its best guess.
   */
  roadMatched: Type.Union([Type.Boolean(), Type.Null()]),
  /** The upstream query that produced this result — may be a loosened line. */
  query: Type.String(),
});

export function registerAddressGeocodeRoute(
  fastify: FastifyInstance,
  appContext: AppContext,
): void {
  fastify.post(
    '/geocode/address',
    {
      schema: {
        operationId: 'geocodeAddress',
        tags: ['Geocode'],
        summary: 'Geocode a raw, unparsed address line.',
        description:
          'Geocodes a free-text address line as-is (no libpostal parse), loosening ' +
          'the line when no candidate sits on a road it names. Read-only — nothing ' +
          'is persisted and no events are emitted.',
        body: AddressGeocodeBodySchema,
        response: {
          200: AddressGeocodeResponseSchema,
          401: ErrorResponseRef,
          403: ErrorResponseRef,
          // 422, not 404: the request was understood, the address simply has no
          // match. A 404 here is indistinguishable from Fastify's own
          // "route not found" 404, which makes a failed lookup impossible to
          // tell from a wrong URL or an undeployed build.
          422: ErrorResponseRef,
          500: ErrorResponseRef,
          502: ErrorResponseRef,
        },
      },
    },
    async (request, reply) => {
      const scope = ScopeStore.get();
      if (!scope) {
        return reply.code(401).send({ error: 'Unauthorized', message: 'Authentication required.' });
      }
      if (!scope.permissions.has(PinpointPermission.MatchingSpatialLookup)) {
        return sendUseCaseError(
          reply,
          UseCaseError.authorization(
            'PERMISSION_DENIED',
            `Missing permission ${PinpointPermission.MatchingSpatialLookup}.`,
          ),
        );
      }

      const body = request.body as { address: string; countryCode?: string | null };
      const address = body.address.trim();
      const countryCode = body.countryCode?.trim() || null;

      try {
        const result = await appContext.services.geocoder.geocodeText(address, { countryCode });
        return reply.code(200).send({
          latitude: result.latitude,
          longitude: result.longitude,
          confidence: result.confidence,
          formattedAddress: result.formattedAddress,
          address: result.address,
          roadMatched: result.roadMatched,
          query: result.query,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const noMatch = message.startsWith('No geocoding results');
        request.log.warn({ address, countryCode, noMatch, err: message }, 'geocode/address failed');
        return reply.code(noMatch ? 422 : 502).send({
          error: noMatch ? 'NoGeocodingMatch' : 'BadGateway',
          message,
        });
      }
    },
  );
}
