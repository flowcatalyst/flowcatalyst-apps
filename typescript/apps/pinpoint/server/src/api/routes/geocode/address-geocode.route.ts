/**
 * POST /geocode/address — geocode a RAW address line.
 *
 * The sibling `/geocode/forward` requires pre-parsed components (city and
 * country are mandatory). This route accepts the free-text line you actually
 * have, runs it through the libpostal normalizer first, and then geocodes the
 * parsed result — the same two steps `create-location` performs, minus the
 * persistence, matching, and event emission.
 *
 * Nothing is written: no location, no master location, no outbox event. This is
 * a read-only diagnostic surface for answering "what would pinpoint make of
 * this address?" before committing it.
 *
 * The response deliberately returns BOTH parses — what libpostal extracted from
 * the raw line (`normalized`) and what the geocoder matched (`address`) —
 * because the gap between them is the signal when an address resolves oddly.
 */
import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import { ScopeStore, UseCaseError } from '@pinpoint/framework';
import { PinpointPermission } from '@pinpoint/shared';
import type { AppContext } from '../../../app-context.js';
import { AddressDetailsSchema } from '../../../domain/locations/events/address-details.js';
import {
  normalizeWithFallback,
  type NormalizedAddress,
} from '../../../domain/services/address-normalizer.js';
import { sendUseCaseError } from '../../plugins/error-mapper.js';
import { ErrorResponseRef } from '../../plugins/error-response.schema.js';

const AddressGeocodeBodySchema = Type.Object({
  /** Free-text address line, e.g. `548 Market Street, San Francisco, CA 94104`. */
  address: Type.String({ minLength: 1 }),
  /**
   * Optional ISO country code hint. When the strict libpostal parse fails, the
   * line is retried with this appended — same fallback `create-location` uses.
   */
  countryCode: Type.Optional(Type.Union([Type.String({ minLength: 2, maxLength: 3 }), Type.Null()])),
});

const AddressGeocodeResponseSchema = Type.Object({
  latitude: Type.Number(),
  longitude: Type.Number(),
  confidence: Type.Number(),
  formattedAddress: Type.Union([Type.String(), Type.Null()]),
  /** Components libpostal parsed out of the raw line — the geocoder's input. */
  normalized: AddressDetailsSchema,
  /**
   * True when the strict parse failed and a best-effort pass was used. The
   * result is still usable but libpostal could not confidently identify the
   * city or country, so treat the coordinate with suspicion.
   */
  normalizationBestEffort: Type.Boolean(),
  /** Components of the address the geocoder actually matched. */
  address: AddressDetailsSchema,
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
          'Normalizes a free-text address via libpostal, then geocodes the parsed ' +
          'components. Read-only — nothing is persisted and no events are emitted.',
        body: AddressGeocodeBodySchema,
        response: {
          200: AddressGeocodeResponseSchema,
          401: ErrorResponseRef,
          403: ErrorResponseRef,
          404: ErrorResponseRef,
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

      // Same ladder create-location uses on ingest, so a line geocoded here
      // parses exactly as it would when persisted.
      let normalized: NormalizedAddress;
      let normalizationBestEffort: boolean;
      try {
        const outcome = await normalizeWithFallback(
          appContext.services.addressNormalizer,
          address,
          countryCode,
        );
        normalized = outcome.normalized;
        normalizationBestEffort = outcome.bestEffort;
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        return reply.code(502).send({ error: 'BadGateway', message });
      }

      try {
        const result = await appContext.services.geocoder.geocode(normalized);
        return reply.code(200).send({
          latitude: result.latitude,
          longitude: result.longitude,
          confidence: result.confidence,
          formattedAddress: result.formattedAddress,
          normalized,
          normalizationBestEffort,
          address: result.address,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const status = message.startsWith('No geocoding results') ? 404 : 502;
        return reply.code(status).send({
          error: status === 404 ? 'NotFound' : 'BadGateway',
          message,
        });
      }
    },
  );
}
