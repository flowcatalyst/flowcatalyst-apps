/**
 * Transport claim surface — EPOD channel (STUBS).
 *
 * These are the endpoints Integral's claim proxy will call once their
 * claim-trip routes are updated to proxy here (driver app untouched — see
 * docs/transport-context.md "EPOD integration plan" and
 * docs/epod-integration-notes.md §2). The TRANSPORT PLANNING context fills
 * them in: claimable-trips will build a reserved offer (expiring,
 * optimistic-locked hold with driver+vehicle bound at OFFER time) and
 * claims/:groupId will confirm it + synchronously push the route plan back
 * to EPOD. Until then: no offers, and every claim is gone.
 *
 * Auth: authenticated scope required (platform-token callers come through
 * extractRequestToken's bearer path) — 401 otherwise.
 */
import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import { ScopeStore } from '@fulfil-go/framework';
import type { AppContext } from '../../../app-context.js';

const ClaimableTripsRequestSchema = Type.Object({
  /** EPOD driver reference (e.g. 'CS001') — bound to the offer, not the claim. */
  driverReference: Type.String({ minLength: 1 }),
  /** EPOD vehicle registration — capacity limits constrain the offer. */
  vehicleRegistration: Type.String({ minLength: 1 }),
  /** EPOD depot reference → collection store. */
  depotReference: Type.Optional(Type.String()),
  /** Territory fallback when no single depot. */
  territoryReference: Type.Optional(Type.String()),
  /** Restrict the offer to one order/part reference. */
  orderReference: Type.Optional(Type.String()),
});

const UnauthorizedSchema = Type.Object({ error: Type.String(), message: Type.String() });

export function registerTransportRoutes(fastify: FastifyInstance, _appContext: AppContext): void {
  fastify.post(
    '/clients/:clientId/transport/epod/claimable-trips',
    {
      schema: {
        tags: ['Transport'],
        summary: 'EPOD claim surface: request an offer of claimable trips (STUB)',
        description:
          'Stub until the transport planning context lands — always returns an empty offer ' +
          "list. Integral's claim proxy calls this with the driver/vehicle/depot context; " +
          'the planning context will answer with a reserved offer group.',
        params: Type.Object({ clientId: Type.String() }),
        body: ClaimableTripsRequestSchema,
        response: {
          200: Type.Object({ offers: Type.Array(Type.Unknown()) }),
          401: UnauthorizedSchema,
        },
      },
    },
    async (_request, reply) => {
      if (!ScopeStore.get()) {
        return reply.code(401).send({ error: 'Unauthorized', message: 'Authentication required.' });
      }
      // TODO(transport-planning): build a reserved offer (driver+vehicle
      // bound now, expiring hold on the trip/orders) instead of nothing.
      return reply.code(200).send({ offers: [] });
    },
  );

  fastify.post(
    '/clients/:clientId/transport/epod/claims/:groupId',
    {
      schema: {
        tags: ['Transport'],
        summary: 'EPOD claim surface: claim an offered trip group (STUB)',
        description:
          'Stub until the transport planning context lands — no offers exist, so every ' +
          'claim is 410 gone. The real implementation confirms the reservation and ' +
          'synchronously pushes the route plan to EPOD (explicit accept/reject).',
        params: Type.Object({ clientId: Type.String(), groupId: Type.String() }),
        response: {
          401: UnauthorizedSchema,
          410: Type.Object({ error: Type.String(), message: Type.String() }),
        },
      },
    },
    async (_request, reply) => {
      if (!ScopeStore.get()) {
        return reply.code(401).send({ error: 'Unauthorized', message: 'Authentication required.' });
      }
      return reply.code(410).send({
        error: 'gone',
        message: 'No such offer — transport planning context not yet live.',
      });
    },
  );
}
