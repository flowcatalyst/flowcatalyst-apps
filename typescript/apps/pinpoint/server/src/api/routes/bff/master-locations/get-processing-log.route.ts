/**
 * BFF master-location processing-log. Mirror of Rust
 * `routes/bff/master_locations.rs::get_processing_log`. Returns the
 * append-only audit log entries for one master — used by the SPA's
 * "what happened to this master" timeline view.
 */
import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import { ScopeStore } from '@pinpoint/framework';
import { asMasterLocationId } from '../../../../domain/locations/ids.js';
import type { AppContext } from '../../../../app-context.js';

const EntrySchema = Type.Object({
  id: Type.String(),
  step: Type.String(),
  data: Type.Unknown(),
  createdAt: Type.String({ format: 'date-time' }),
});

const ResponseSchema = Type.Array(EntrySchema);

const ErrorSchema = Type.Object({
  error: Type.String(),
  message: Type.Optional(Type.String()),
});

export function registerBffGetProcessingLogRoute(
  fastify: FastifyInstance,
  appContext: AppContext,
): void {
  fastify.get(
    '/bff/clients/:clientId/master-locations/:masterLocationId/processing-log',
    {
      schema: {
        tags: ['BFF'],
        params: Type.Object({
          clientId: Type.String({ minLength: 1 }),
          masterLocationId: Type.String({ minLength: 1 }),
        }),
        response: { 200: ResponseSchema, 401: ErrorSchema, 500: ErrorSchema },
      },
    },
    async (request, reply) => {
      const scope = ScopeStore.get();
      if (!scope) {
        return reply.code(401).send({ error: 'Unauthorized', message: 'Authentication required.' });
      }

      const { masterLocationId } = request.params as {
        clientId: string;
        masterLocationId: string;
      };
      const entries = await appContext.repositories.processingLog.listByMaster(
        asMasterLocationId(masterLocationId),
      );

      return reply.code(200).send(
        entries.map((e) => ({
          id: e.id,
          step: e.step,
          data: e.data,
          createdAt: e.createdAt.toISOString(),
        })),
      );
    },
  );
}
