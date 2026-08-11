/**
 * Depot registry admin (transport topology — reference data, ManageStores).
 * A depot is where drivers are based; `storeRefs` are the stores it SERVES
 * (many-to-many — no 1:1 depot↔store; Andrew 2026-07-13). For EPOD-adopted
 * clients, `depotRef` should equal EPOD's depot reference so their claim
 * proxy's depotReference resolves directly.
 */
import { Type } from '@sinclair/typebox';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { ScopeStore } from '@fulfil-go/framework';
import { FulfilGoPermission } from '@fulfil-go/shared';
import type { AppContext } from '../../../app-context.js';
import { ErrorResponseSchema, UnauthorizedSchema } from '../../schemas/common.js';

const DepotSchema = Type.Object({
  depotRef: Type.String(),
  name: Type.String(),
  geo: Type.Union([Type.Object({ lat: Type.Number(), lng: Type.Number() }), Type.Null()]),
  storeRefs: Type.Array(Type.String()),
});

const UpsertDepotBodySchema = Type.Object(
  {
    depotRef: Type.String({ minLength: 1, maxLength: 64 }),
    name: Type.String({ minLength: 1, maxLength: 120 }),
    geo: Type.Optional(
      Type.Union([Type.Object({ lat: Type.Number(), lng: Type.Number() }), Type.Null()]),
    ),
    storeRefs: Type.Array(Type.String({ minLength: 1, maxLength: 64 }), { maxItems: 500 }),
  },
  { additionalProperties: false },
);

function requireManageStores(reply: FastifyReply): boolean {
  const scope = ScopeStore.get();
  if (!scope) {
    void reply.code(401).send({ error: 'Unauthorized', message: 'Authentication required.' });
    return false;
  }
  if (!scope.permissions.has(FulfilGoPermission.ManageStores)) {
    void reply.code(403).send({
      error: 'forbidden',
      code: 'PERMISSION_DENIED',
      message: `Missing permission ${FulfilGoPermission.ManageStores}.`,
      details: null,
    });
    return false;
  }
  return true;
}

export function registerDepotRoutes(fastify: FastifyInstance, appContext: AppContext): void {
  fastify.get(
    '/clients/:clientId/depots',
    {
      schema: {
        tags: ['Depots'],
        params: Type.Object({ clientId: Type.String() }),
        response: {
          200: Type.Object({ depots: Type.Array(DepotSchema) }),
          401: UnauthorizedSchema,
        },
      },
    },
    async (request, reply) => {
      // Read surface: any authenticated principal (drivers pick their depot
      // at login; management lists it) — writes are ManageStores-gated.
      if (!ScopeStore.get()) {
        return reply.code(401).send({ error: 'Unauthorized', message: 'Authentication required.' });
      }
      const { clientId } = request.params as { clientId: string };
      const rows = await appContext.repositories.depots.listByClient(clientId);
      return reply.send({
        depots: rows.map((d) => ({
          depotRef: d.depotRef,
          name: d.name,
          geo: d.geo,
          storeRefs: [...d.storeRefs],
        })),
      });
    },
  );

  fastify.put(
    '/clients/:clientId/depots/:depotRef',
    {
      schema: {
        tags: ['Depots'],
        summary: 'Create/update a depot + the stores it serves (full replace)',
        params: Type.Object({ clientId: Type.String(), depotRef: Type.String() }),
        body: Type.Omit(UpsertDepotBodySchema, ['depotRef']),
        response: {
          200: DepotSchema,
          400: ErrorResponseSchema,
          401: UnauthorizedSchema,
          403: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      if (!requireManageStores(reply)) return reply;
      const { clientId, depotRef } = request.params as { clientId: string; depotRef: string };
      const body = request.body as {
        name: string;
        geo?: { lat: number; lng: number } | null;
        storeRefs: string[];
      };
      // Links are registry-validated — a typo'd store must not vanish work.
      for (const storeRef of body.storeRefs) {
        if (!(await appContext.repositories.stores.existsByRef(clientId, storeRef))) {
          return reply.code(400).send({
            error: 'validation',
            code: 'STORE_NOT_FOUND',
            message: `Store '${storeRef}' is not in the registry.`,
            details: null,
          });
        }
      }
      const depot = await appContext.repositories.depots.upsert(clientId, {
        depotRef,
        name: body.name,
        geo: body.geo ?? null,
        storeRefs: body.storeRefs,
      });
      return reply.send({
        depotRef: depot.depotRef,
        name: depot.name,
        geo: depot.geo,
        storeRefs: [...depot.storeRefs],
      });
    },
  );

  fastify.delete(
    '/clients/:clientId/depots/:depotRef',
    {
      schema: {
        tags: ['Depots'],
        params: Type.Object({ clientId: Type.String(), depotRef: Type.String() }),
        response: {
          200: Type.Object({ depotRef: Type.String(), deleted: Type.Boolean() }),
          401: UnauthorizedSchema,
          403: ErrorResponseSchema,
          409: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      if (!requireManageStores(reply)) return reply;
      const { clientId, depotRef } = request.params as { clientId: string; depotRef: string };
      // Drivers reference depots — refuse to orphan a roster.
      const drivers = await appContext.repositories.driverUsers.listByClient(clientId, depotRef);
      if (drivers.length > 0) {
        return reply.code(409).send({
          error: 'conflict',
          code: 'DEPOT_HAS_DRIVERS',
          message: `Depot '${depotRef}' still has ${drivers.length} driver(s) — reassign them first.`,
          details: null,
        });
      }
      const deleted = await appContext.repositories.depots.delete(clientId, depotRef);
      return reply.send({ depotRef, deleted });
    },
  );

  // Dev/test seeding: one depot per CITY, serving that city's stores —
  // realistic topology from the store fixtures without hand-linking 100
  // stores. Idempotent (upserts by ref, links replaced wholesale).
  fastify.post(
    '/clients/:clientId/depots/seed',
    {
      schema: {
        tags: ['Depots'],
        params: Type.Object({ clientId: Type.String() }),
        response: {
          200: Type.Object({ depots: Type.Integer(), stores: Type.Integer() }),
          401: UnauthorizedSchema,
          403: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      if (!requireManageStores(reply)) return reply;
      const { clientId } = request.params as { clientId: string };
      const stores = await appContext.repositories.stores.listByClient(clientId);
      const byCity = new Map<
        string,
        { name: string; storeRefs: string[]; coords: { lat: number; lng: number }[] }
      >();
      for (const store of stores) {
        const city = store.city ?? 'unassigned';
        const slug = city
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '');
        const entry =
          byCity.get(slug) ??
          ({ name: `${city} Depot`, storeRefs: [], coords: [] } as {
            name: string;
            storeRefs: string[];
            coords: { lat: number; lng: number }[];
          });
        entry.storeRefs.push(store.storeRef);
        if (store.lat !== null && store.lng !== null) {
          entry.coords.push({ lat: store.lat, lng: store.lng });
        }
        byCity.set(slug, entry);
      }
      let linked = 0;
      for (const [slug, entry] of byCity) {
        // Depot geo = centroid of its linked stores (they're same-city, so a
        // plain average is a sensible "middle of the serviced area").
        const geo =
          entry.coords.length > 0
            ? {
                lat: entry.coords.reduce((s, c) => s + c.lat, 0) / entry.coords.length,
                lng: entry.coords.reduce((s, c) => s + c.lng, 0) / entry.coords.length,
              }
            : null;
        await appContext.repositories.depots.upsert(clientId, {
          depotRef: `dep-${slug}`,
          name: entry.name,
          geo,
          storeRefs: entry.storeRefs,
        });
        linked += entry.storeRefs.length;
      }
      return reply.send({ depots: byCity.size, stores: linked });
    },
  );
}
