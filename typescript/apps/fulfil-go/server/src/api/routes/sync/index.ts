import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import { ScopeStore } from '@fulfil-go/framework';
import { DeltaSyncResponseSchema } from '@fulfil-go/shared';
import type { AppContext } from '../../../app-context.js';
import { toJobDto } from '../../../domain/jobs/job-dto.js';
import { userChannel } from '../../../infrastructure/sync-event-repository.js';
import { UnauthorizedSchema } from '../../schemas/common.js';

/**
 * GET /sync/jobs — delta-sync catch-up. Returns the caller's full working
 * set plus the channel's latest event id; the client hydrates from `jobs`,
 * then attaches SSE with `Last-Event-ID: latestEventId`, closing the
 * snapshot→stream gap race. `since` is accepted for forward compatibility;
 * the scaffold always returns the full (small) working set.
 */
export function registerSyncRoutes(fastify: FastifyInstance, appContext: AppContext): void {
  fastify.get(
    '/sync/jobs',
    {
      schema: {
        tags: ['Sync'],
        querystring: Type.Object({ since: Type.Optional(Type.String()) }),
        response: {
          200: DeltaSyncResponseSchema,
          401: UnauthorizedSchema,
        },
      },
    },
    async (_request, reply) => {
      const scope = ScopeStore.get();
      if (!scope) {
        return reply.code(401).send({ error: 'Unauthorized', message: 'Authentication required.' });
      }

      const channel = userChannel(scope.principalId);
      const [jobs, latestEventId] = await Promise.all([
        appContext.repositories.jobs.listByAssignee(scope.principalId),
        appContext.repositories.syncEvents.latestId(channel),
      ]);

      return reply.code(200).send({
        latestEventId: String(latestEventId),
        jobs: jobs.map(toJobDto),
      });
    },
  );
}
