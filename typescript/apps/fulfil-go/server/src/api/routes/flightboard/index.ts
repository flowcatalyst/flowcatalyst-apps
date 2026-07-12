import type { FastifyInstance } from 'fastify';
import { Type } from '@sinclair/typebox';
import { ScopeStore } from '@fulfil-go/framework';
import type { AppContext } from '../../../app-context.js';
import { queryFlightboard } from './flightboard-query.js';

const ExceptionSchema = Type.Object({
  kind: Type.String(),
  fulfilmentId: Type.String(),
  externalRef: Type.String(),
  partShortId: Type.String(),
  storeRef: Type.String(),
  serviceLevel: Type.String(),
  slotStart: Type.String(),
  sinceMinutes: Type.Integer(),
  detail: Type.String(),
});

const BoardRowSchema = Type.Object({
  id: Type.String(),
  externalRef: Type.String(),
  type: Type.String(),
  serviceLevel: Type.String(),
  status: Type.String(),
  slotStart: Type.String(),
  slotEnd: Type.String(),
  stores: Type.Array(Type.String()),
  parts: Type.Array(
    Type.Object({
      shortId: Type.String(),
      storeRef: Type.String(),
      status: Type.String(),
      pickStatus: Type.Union([Type.String(), Type.Null()]),
      pickClaimedAt: Type.Union([Type.String(), Type.Null()]),
      exceptions: Type.Array(Type.String()),
    }),
  ),
  exceptions: Type.Array(Type.String()),
});

const FlightboardResponseSchema = Type.Object({
  windowStart: Type.String(),
  windowEnd: Type.String(),
  kpis: Type.Object({
    totalOrders: Type.Integer(),
    totalPicked: Type.Integer(),
    totalFailed: Type.Integer(),
    totalDelivered: Type.Union([Type.Integer(), Type.Null()]),
    pickedOnTimePct: Type.Union([Type.Number(), Type.Null()]),
    pickedInFullPct: Type.Union([Type.Number(), Type.Null()]),
    onTimePct: Type.Union([Type.Number(), Type.Null()]),
    otifPct: Type.Union([Type.Number(), Type.Null()]),
  }),
  exceptions: Type.Array(ExceptionSchema),
  board: Type.Array(BoardRowSchema),
});

export function registerFlightboardRoutes(fastify: FastifyInstance, appContext: AppContext): void {
  fastify.get(
    '/clients/:clientId/flightboard',
    {
      schema: {
        tags: ['Fulfilments'],
        summary: 'Operational flightboard',
        description:
          'Controller view over the ±24h slot window: KPIs, exception list (release overdue, ' +
          'late unclaimed picks, late incomplete picks — transport kinds land with the ' +
          'transport context), and the active board sorted ASAP-first then oldest slot ' +
          '(completed/cancelled/failed excluded).',
        params: Type.Object({ clientId: Type.String() }),
        querystring: Type.Object({
          /** Comma-separated storeRefs — fulfilments with any part at any of them. */
          stores: Type.Optional(Type.String()),
        }),
        response: {
          200: FlightboardResponseSchema,
          401: Type.Object({ error: Type.String(), message: Type.String() }),
        },
      },
    },
    async (request, reply) => {
      if (!ScopeStore.get()) {
        return reply.code(401).send({ error: 'Unauthorized', message: 'Authentication required.' });
      }
      const { clientId } = request.params as { clientId: string };
      const { stores } = request.query as { stores?: string };
      const storeRefs = stores
        ?.split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      return reply.send(await queryFlightboard(appContext.db, clientId, storeRefs));
    },
  );
}
