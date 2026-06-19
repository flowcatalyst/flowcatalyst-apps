/**
 * BFF master-location list. Mirror of Rust
 * `routes/bff/master_locations.rs::list_master_locations`. Pagination
 * via `page` + `pageSize`, optional `status` filter.
 *
 * `address` in the response is a short display string composed of
 * `house_number road` (or city if neither is present) — matches the
 * Rust BFF's terse list-view shape. Full normalized components are
 * also returned for the SPA detail-tooltip rendering.
 */
import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import { ScopeStore } from '@pinpoint/framework';
import { asClientId } from '../../../../domain/tenancy/ids.js';
import type {
  MasterLocation,
  MasterLocationStatus,
} from '../../../../domain/locations/master-location.js';
import type { AppContext } from '../../../../app-context.js';

const StatusEnum = Type.Union([
  Type.Literal('PENDING'),
  Type.Literal('GEOCODED'),
  Type.Literal('VALIDATED'),
  Type.Literal('REJECTED'),
]);

const ItemSchema = Type.Object({
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

const ResponseSchema = Type.Object({
  items: Type.Array(ItemSchema),
  total: Type.Integer({ minimum: 0 }),
});

const QuerySchema = Type.Object({
  page: Type.Optional(Type.Integer({ minimum: 0 })),
  pageSize: Type.Optional(Type.Integer({ minimum: 1, maximum: 500 })),
  status: Type.Optional(StatusEnum),
});

const ErrorSchema = Type.Object({
  error: Type.String(),
  message: Type.Optional(Type.String()),
});

export function toBffMasterLocationResponse(ml: MasterLocation): {
  id: string;
  address: string;
  houseNumber: string | null;
  road: string | null;
  suburb: string | null;
  city: string;
  state: string | null;
  postalCode: string | null;
  country: string;
  status: string;
  latitude: number | null;
  longitude: number | null;
  addressHash: string;
  createdAt: string;
} {
  // Mirror Rust's `format_address`: prefer "<num> <road>", fall back to city.
  const parts: string[] = [];
  if (ml.normalizedHouseNumber) parts.push(ml.normalizedHouseNumber);
  if (ml.normalizedRoad) parts.push(ml.normalizedRoad);
  const address = parts.length === 0 ? ml.normalizedCity : parts.join(' ');
  return {
    id: ml.id,
    address,
    houseNumber: ml.normalizedHouseNumber,
    road: ml.normalizedRoad,
    suburb: ml.normalizedSuburb,
    city: ml.normalizedCity,
    state: ml.normalizedState,
    postalCode: ml.normalizedPostalCode,
    country: ml.normalizedCountry,
    status: ml.status,
    latitude: ml.latitude,
    longitude: ml.longitude,
    addressHash: ml.addressHash,
    createdAt: ml.createdAt.toISOString(),
  };
}

export function registerBffListMasterLocationsRoute(
  fastify: FastifyInstance,
  appContext: AppContext,
): void {
  fastify.get(
    '/bff/clients/:clientId/master-locations',
    {
      schema: {
        tags: ['BFF'],
        params: Type.Object({ clientId: Type.String({ minLength: 1 }) }),
        querystring: QuerySchema,
        response: { 200: ResponseSchema, 401: ErrorSchema, 500: ErrorSchema },
      },
    },
    async (request, reply) => {
      const scope = ScopeStore.get();
      if (!scope) {
        return reply.code(401).send({ error: 'Unauthorized', message: 'Authentication required.' });
      }

      const { clientId } = request.params as { clientId: string };
      const {
        page = 0,
        pageSize = 100,
        status,
      } = request.query as {
        page?: number;
        pageSize?: number;
        status?: MasterLocationStatus;
      };

      const { masters, total } = await appContext.repositories.masterLocations.listByClient({
        clientId: asClientId(clientId),
        status,
        limit: pageSize,
        offset: page * pageSize,
      });

      return reply.code(200).send({
        items: masters.map(toBffMasterLocationResponse),
        total,
      });
    },
  );
}
