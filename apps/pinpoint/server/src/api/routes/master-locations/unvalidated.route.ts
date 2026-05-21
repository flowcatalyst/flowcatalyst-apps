/**
 * GET /master-locations/unvalidated. Cross-client operator view of every
 * master that hasn't reached VALIDATED yet — useful for ops dashboards
 * and bulk re-runs. Mirror of Rust `routes/unvalidated_routes.rs`.
 *
 * Filters via query params:
 *   - clientIds=cli_a,cli_b      → cross-client filter
 *   - partitionCodes=foo,bar     → partition-code filter (resolved here)
 *   - limit=N (1-500, default 100)
 *   - offset=N (default 0)
 *   - order=asc|desc (by id, default desc)
 *
 * Note: deliberately NOT under `/clients/:clientId/...` — this is a
 * cross-client surface for the SPA's "unvalidated backlog" panel. The
 * partition-code resolution iterates across the filtered (or all)
 * clients, matching the Rust behavior; expensive but mirrors the
 * source.
 */
import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import { ScopeStore } from '@pinpoint/framework';
import {
  asClientId,
  asPartitionId,
  type ClientId,
  type PartitionId,
} from '../../../domain/tenancy/ids.js';
import type { AppContext } from '../../../app-context.js';

const QuerySchema = Type.Object({
  clientIds: Type.Optional(Type.String()),
  partitionCodes: Type.Optional(Type.String()),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 500 })),
  offset: Type.Optional(Type.Integer({ minimum: 0 })),
  order: Type.Optional(Type.Union([Type.Literal('asc'), Type.Literal('desc')])),
});

const ItemSchema = Type.Object({
  id: Type.String(),
  clientId: Type.String(),
  partitionId: Type.Union([Type.String(), Type.Null()]),
  address: Type.String(),
  city: Type.String(),
  country: Type.String(),
  status: Type.String(),
  latitude: Type.Union([Type.Number(), Type.Null()]),
  longitude: Type.Union([Type.Number(), Type.Null()]),
  addressHash: Type.String(),
  createdAt: Type.String({ format: 'date-time' }),
  updatedAt: Type.String({ format: 'date-time' }),
});

const ResponseSchema = Type.Object({
  items: Type.Array(ItemSchema),
  total: Type.Integer({ minimum: 0 }),
  limit: Type.Integer(),
  offset: Type.Integer(),
});

const ErrorSchema = Type.Object({
  error: Type.String(),
  message: Type.Optional(Type.String()),
});

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;
const CLIENT_LOOKUP_PAGE = 1000;

function splitCsv(value: string | undefined): readonly string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function composeAddressLine(parts: {
  readonly normalizedHouseNumber: string | null;
  readonly normalizedRoad: string | null;
  readonly normalizedSuburb: string | null;
  readonly normalizedCity: string;
  readonly normalizedCountry: string;
}): string {
  const street = [parts.normalizedHouseNumber, parts.normalizedRoad].filter(Boolean).join(' ');
  const segments: string[] = [];
  if (street.length > 0) segments.push(street);
  if (parts.normalizedSuburb) segments.push(parts.normalizedSuburb);
  segments.push(parts.normalizedCity);
  segments.push(parts.normalizedCountry);
  return segments.join(', ');
}

export function registerUnvalidatedMasterLocationsRoute(
  fastify: FastifyInstance,
  appContext: AppContext,
): void {
  fastify.get(
    '/master-locations/unvalidated',
    {
      schema: {
        tags: ['MasterLocations'],
        querystring: QuerySchema,
        response: { 200: ResponseSchema, 401: ErrorSchema, 500: ErrorSchema },
      },
    },
    async (request, reply) => {
      const scope = ScopeStore.get();
      if (!scope) {
        return reply
          .code(401)
          .send({ error: 'Unauthorized', message: 'Authentication required.' });
      }

      const q = request.query as {
        clientIds?: string;
        partitionCodes?: string;
        limit?: number;
        offset?: number;
        order?: 'asc' | 'desc';
      };

      const limit = Math.min(Math.max(q.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
      const offset = Math.max(q.offset ?? 0, 0);
      const ascending = q.order === 'asc';

      const clientIdStrings = splitCsv(q.clientIds);
      const clientIds: ClientId[] | null =
        clientIdStrings.length > 0 ? clientIdStrings.map(asClientId) : null;

      // Resolve partition codes → ids. If clientIds are provided, search
      // only those clients; otherwise iterate every client (capped at
      // CLIENT_LOOKUP_PAGE to keep this bounded). Matches Rust behavior.
      let partitionIds: PartitionId[] | null = null;
      const partitionCodes = splitCsv(q.partitionCodes);
      if (partitionCodes.length > 0) {
        let searchClients: readonly ClientId[];
        if (clientIds != null) {
          searchClients = clientIds;
        } else {
          const { clients } = await appContext.repositories.clients.listAll({
            limit: CLIENT_LOOKUP_PAGE,
            offset: 0,
          });
          searchClients = clients.map((c) => c.id);
        }
        const resolved: PartitionId[] = [];
        for (const cid of searchClients) {
          for (const code of partitionCodes) {
            const partition = await appContext.repositories.partitions.findByClientAndCode(
              cid,
              code,
            );
            if (partition) resolved.push(asPartitionId(partition.id));
          }
        }
        partitionIds = resolved.length > 0 ? resolved : null;
      }

      const { masters, total } = await appContext.repositories.masterLocations.findUnvalidated({
        clientIds,
        partitionIds,
        limit,
        offset,
        ascending,
      });

      return reply.code(200).send({
        items: masters.map((m) => ({
          id: m.id,
          clientId: m.clientId,
          partitionId: m.partitionId,
          address: composeAddressLine(m),
          city: m.normalizedCity,
          country: m.normalizedCountry,
          status: m.status,
          latitude: m.latitude,
          longitude: m.longitude,
          addressHash: m.addressHash,
          createdAt: m.createdAt.toISOString(),
          updatedAt: m.updatedAt.toISOString(),
        })),
        total,
        limit,
        offset,
      });
    },
  );
}
