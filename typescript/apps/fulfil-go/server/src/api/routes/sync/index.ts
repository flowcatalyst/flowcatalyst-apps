import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import { ScopeStore } from '@fulfil-go/framework';
import { FulfilGoPermission, PickDeltaSyncResponseSchema } from '@fulfil-go/shared';
import type { AppContext } from '../../../app-context.js';
import { toPickDto } from '../../../domain/picks/pick-dto.js';
import { storeChannel } from '../../../infrastructure/sync-event-repository.js';
import { ErrorResponseSchema, UnauthorizedSchema } from '../../schemas/common.js';

/**
 * Delta-sync catch-up: snapshot-then-stream. Clients hydrate the working
 * set, then attach SSE with `Last-Event-ID: latestEventId`, closing the
 * snapshot→stream gap race.
 */
export function registerSyncRoutes(fastify: FastifyInstance, appContext: AppContext): void {
  // Picking-station snapshot: the store's full pick working set + the STORE
  // channel's high water. Store scoping comes from the picker session token.
  fastify.get(
    '/clients/:clientId/sync/picks',
    {
      schema: {
        tags: ['Sync'],
        params: Type.Object({ clientId: Type.String() }),
        response: {
          200: PickDeltaSyncResponseSchema,
          401: UnauthorizedSchema,
          403: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const scope = ScopeStore.get();
      if (!scope) {
        return reply.code(401).send({ error: 'Unauthorized', message: 'Authentication required.' });
      }
      const storeRef = scope.attributes['storeRef'];
      const scopeClientId = scope.attributes['clientId'];
      const { clientId } = request.params as { clientId: string };
      if (
        !storeRef ||
        scopeClientId !== clientId ||
        !scope.permissions.has(FulfilGoPermission.ViewStorePicks)
      ) {
        return reply.code(403).send({
          error: 'forbidden',
          code: 'NOT_A_PICKER_SESSION',
          message: 'Pick sync requires a picker session scoped to this client.',
          details: null,
        });
      }

      const [picks, latestEventId] = await Promise.all([
        // Bounded to ~the day (±36h superset — the station filters to its
        // exact local day): stations never carry historical picks.
        appContext.repositories.picks.listByStore(clientId, storeRef, undefined, {
          from: new Date(Date.now() - 36 * 60 * 60 * 1000),
          to: new Date(Date.now() + 36 * 60 * 60 * 1000),
        }),
        appContext.repositories.syncEvents.latestId(storeChannel(clientId, storeRef)),
      ]);
      return reply.code(200).send({
        latestEventId: String(latestEventId),
        picks: picks.map(toPickDto),
      });
    },
  );
}
