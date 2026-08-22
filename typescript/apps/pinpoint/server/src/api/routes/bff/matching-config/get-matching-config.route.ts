/**
 * BFF matching-config GET. Mirror of Rust
 * `routes/bff/matching_config.rs::get_matching_config`.
 *
 * Always resolves with `partitionId = null` so the SPA sees the
 * client-level config (or falls back to `mcf_GLOBAL_DEFAULT` via the
 * cascade if no client-scoped row exists yet). Per-partition configs
 * are managed via the canonical `/clients/:cid/matching-config` route
 * with the partition id in the body.
 */
import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import { ScopeStore } from '@pinpoint/framework';
import { asClientId } from '../../../../domain/tenancy/ids.js';
import type { AppContext } from '../../../../app-context.js';
import { ErrorResponseRef } from '../../../plugins/error-response.schema.js';
import { MatchingConfigRef } from '../../matching-config/matching-config.schema.js';

const ResponseSchema = MatchingConfigRef;

export function registerBffGetMatchingConfigRoute(
  fastify: FastifyInstance,
  appContext: AppContext,
): void {
  fastify.get(
    '/bff/clients/:clientId/matching-config',
    {
      schema: {
        operationId: 'bffGetMatchingConfig',
        tags: ['BFF'],
        params: Type.Object({ clientId: Type.String({ minLength: 1 }) }),
        response: { 200: ResponseSchema, 401: ErrorResponseRef, 500: ErrorResponseRef },
      },
    },
    async (request, reply) => {
      const scope = ScopeStore.get();
      if (!scope) {
        return reply.code(401).send({ error: 'Unauthorized', message: 'Authentication required.' });
      }

      const { clientId } = request.params as { clientId: string };
      const config = await appContext.repositories.matchingConfigs.resolve(
        asClientId(clientId),
        null,
      );

      return reply.code(200).send({
        id: config.id,
        clientId: config.clientId,
        partitionId: config.partitionId,
        streetThreshold: config.streetThreshold,
        houseNumberThreshold: config.houseNumberThreshold,
        postalCodeThreshold: config.postalCodeThreshold,
        stateThreshold: config.stateThreshold,
        addressNameThreshold: config.addressNameThreshold,
        overallThreshold: config.overallThreshold,
        createdAt: config.createdAt.toISOString(),
        updatedAt: config.updatedAt.toISOString(),
      });
    },
  );
}
