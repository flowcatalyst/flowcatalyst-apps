/**
 * BFF master-location confirm-geocode. Mirror of Rust
 * `routes/bff/master_locations.rs::confirm_geocode`.
 *
 * The SPA's "confirm a reverse-geocode suggestion" flow: takes the
 * confirmed address components + coordinates, applies them atomically
 * to the master, appends a processing-log entry, then runs
 * confirm-master-location for the * → VALIDATED transition with
 * cascade. The address update itself is a direct repo write (matches
 * Rust); the VALIDATED event from confirm-master-location is the
 * load-bearing audit signal for downstream consumers.
 */
import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import { ScopeStore } from '@pinpoint/framework';
import { ConfirmMasterLocationCommandSchema } from '@pinpoint/shared';
import { asMasterLocationId } from '../../../../domain/locations/ids.js';
import {
  addressHash as computeAddressHash,
  toAddressLine,
  type NormalizedAddress,
} from '../../../../domain/services/address-normalizer.js';
import type { AppContext } from '../../../../app-context.js';
import { sendUseCaseError } from '../../../plugins/error-mapper.js';
import { toBffMasterLocationResponse } from './list-master-locations.route.js';
import { isFailure } from '@pinpoint/framework';

const BodySchema = Type.Object({
  houseNumber: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  road: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  suburb: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  city: Type.String({ minLength: 1 }),
  state: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  postalCode: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  country: Type.String({ minLength: 1 }),
  latitude: Type.Number({ minimum: -90, maximum: 90 }),
  longitude: Type.Number({ minimum: -180, maximum: 180 }),
});

const ResponseSchema = Type.Object({
  id: Type.String(),
  address: Type.String(),
  houseNumber: Type.Union([Type.String(), Type.Null()]),
  road: Type.Union([Type.String(), Type.Null()]),
  suburb: Type.Union([Type.String(), Type.Null()]),
  city: Type.String(),
  state: Type.Union([Type.String(), Type.Null()]),
  postalCode: Type.Union([Type.String(), Type.Null()]),
  country: Type.String(),
  status: Type.String(),
  latitude: Type.Union([Type.Number(), Type.Null()]),
  longitude: Type.Union([Type.Number(), Type.Null()]),
  addressHash: Type.String(),
  createdAt: Type.String({ format: 'date-time' }),
});

const ErrorSchema = Type.Object({
  error: Type.String(),
  message: Type.Optional(Type.String()),
  code: Type.Optional(Type.String()),
  details: Type.Optional(Type.Unknown()),
});

export function registerBffConfirmGeocodeRoute(
  fastify: FastifyInstance,
  appContext: AppContext,
): void {
  fastify.post(
    '/bff/clients/:clientId/master-locations/:masterLocationId/confirm-geocode',
    {
      schema: {
        tags: ['BFF'],
        params: Type.Object({
          clientId: Type.String({ minLength: 1 }),
          masterLocationId: Type.String({ minLength: 1 }),
        }),
        body: BodySchema,
        response: {
          200: ResponseSchema,
          400: ErrorSchema,
          401: ErrorSchema,
          404: ErrorSchema,
          409: ErrorSchema,
          500: ErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const { clientId, masterLocationId } = request.params as {
        clientId: string;
        masterLocationId: string;
      };
      const body = request.body as {
        houseNumber?: string | null;
        road?: string | null;
        suburb?: string | null;
        city: string;
        state?: string | null;
        postalCode?: string | null;
        country: string;
        latitude: number;
        longitude: number;
      };

      const scope = ScopeStore.get();
      if (!scope) {
        return reply
          .code(401)
          .send({ error: 'Unauthorized', message: 'Authentication required.' });
      }

      const mid = asMasterLocationId(masterLocationId);
      const existing = await appContext.repositories.masterLocations.findById(mid);
      if (!existing) {
        return reply.code(404).send({
          error: 'NotFound',
          message: `Master location '${masterLocationId}' not found.`,
        });
      }

      const normalized: NormalizedAddress = {
        houseNumber: body.houseNumber ?? null,
        road: body.road ?? null,
        suburb: body.suburb ?? null,
        city: body.city,
        state: body.state ?? null,
        postalCode: body.postalCode ?? null,
        country: body.country,
      };

      // Apply the confirmed address + coords atomically. Plain repo
      // write — the audit for the confirm flow comes from the
      // subsequent confirm-master-location use case's VALIDATED event.
      await appContext.repositories.masterLocations.applyConfirmedGeocode({
        masterLocationId: mid,
        normalizedHouseNumber: normalized.houseNumber,
        normalizedRoad: normalized.road,
        normalizedSuburb: normalized.suburb,
        normalizedCity: normalized.city,
        normalizedState: normalized.state,
        normalizedPostalCode: normalized.postalCode,
        normalizedCountry: normalized.country,
        addressHash: computeAddressHash(normalized),
        normalizedAddressLine: toAddressLine(normalized),
        latitude: body.latitude,
        longitude: body.longitude,
      });

      // Best-effort processing log — failures must not block (matches
      // pattern across the rest of the matching pipeline).
      try {
        await appContext.repositories.processingLog.append(mid, 'confirm-geocode', {
          houseNumber: normalized.houseNumber,
          road: normalized.road,
          suburb: normalized.suburb,
          city: normalized.city,
          state: normalized.state,
          postalCode: normalized.postalCode,
          country: normalized.country,
          latitude: body.latitude,
          longitude: body.longitude,
          source: 'bff:confirm-geocode',
        });
      } catch {
        // intentionally swallowed
      }

      // Run the VALIDATED transition + cascade through the use case
      // so events emit and child locations get updated.
      const parsed = ConfirmMasterLocationCommandSchema.safeParse({
        clientId,
        masterLocationId,
      });
      if (!parsed.success) {
        return reply.code(400).send({ error: 'ValidationError' });
      }
      const result = await appContext.runWrite(() =>
        appContext.useCases.confirmMasterLocation.execute(parsed.data),
      );
      if (isFailure(result)) {
        return sendUseCaseError(reply, result.error);
      }

      const ml = await appContext.repositories.masterLocations.findById(mid);
      if (!ml) {
        return reply.code(500).send({
          error: 'InfrastructureError',
          message: `Master location '${masterLocationId}' not found after confirm.`,
        });
      }
      return reply.code(200).send(toBffMasterLocationResponse(ml));
    },
  );
}
