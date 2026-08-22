/**
 * BFF matching-config PUT. Mirror of Rust
 * `routes/bff/matching_config.rs::update_matching_config`.
 *
 * Delegates to `update-matching-config` via runWrite. Always scopes to
 * (clientId, partitionId=null) — same client-level scope as GET.
 * Body requires all 6 thresholds (Rust BFF doesn't accept partial
 * updates here, unlike the canonical PUT which lets each threshold be
 * optional).
 */
import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import { ScopeStore } from '@pinpoint/framework';
import { UpdateMatchingConfigCommandSchema } from '@pinpoint/shared';
import { asClientId } from '../../../../domain/tenancy/ids.js';
import type { AppContext } from '../../../../app-context.js';
import { sendUseCaseError } from '../../../plugins/error-mapper.js';
import { isFailure } from '@pinpoint/framework';
import { ErrorResponseRef } from '../../../plugins/error-response.schema.js';

const Threshold = Type.Number({ minimum: 0, maximum: 1 });

const BodySchema = Type.Object({
  streetThreshold: Threshold,
  houseNumberThreshold: Threshold,
  postalCodeThreshold: Threshold,
  stateThreshold: Threshold,
  addressNameThreshold: Threshold,
  overallThreshold: Threshold,
});

const ResponseSchema = Type.Object({
  id: Type.String(),
  clientId: Type.Union([Type.String(), Type.Null()]),
  partitionId: Type.Union([Type.String(), Type.Null()]),
  streetThreshold: Type.Number(),
  houseNumberThreshold: Type.Number(),
  postalCodeThreshold: Type.Number(),
  stateThreshold: Type.Number(),
  addressNameThreshold: Type.Number(),
  overallThreshold: Type.Number(),
  createdAt: Type.String({ format: 'date-time' }),
  updatedAt: Type.String({ format: 'date-time' }),
});

export function registerBffUpdateMatchingConfigRoute(
  fastify: FastifyInstance,
  appContext: AppContext,
): void {
  fastify.put(
    '/bff/clients/:clientId/matching-config',
    {
      schema: {
        operationId: 'bffUpdateMatchingConfig',
        tags: ['BFF'],
        params: Type.Object({ clientId: Type.String({ minLength: 1 }) }),
        body: BodySchema,
        response: {
          200: ResponseSchema,
          400: ErrorResponseRef,
          401: ErrorResponseRef,
          404: ErrorResponseRef,
          500: ErrorResponseRef,
        },
      },
    },
    async (request, reply) => {
      const { clientId } = request.params as { clientId: string };
      const parsed = UpdateMatchingConfigCommandSchema.safeParse({
        ...(request.body as object),
        clientId,
      });
      if (!parsed.success) {
        return reply.code(400).send({ error: 'ValidationError', issues: parsed.error.issues });
      }

      const scope = ScopeStore.get();
      if (!scope) {
        return reply.code(401).send({ error: 'Unauthorized', message: 'Authentication required.' });
      }

      const result = await appContext.runWrite(() =>
        appContext.useCases.updateMatchingConfig.execute(parsed.data),
      );
      if (isFailure(result)) {
        return sendUseCaseError(reply, result.error);
      }

      const updated = await appContext.repositories.matchingConfigs.resolve(
        asClientId(clientId),
        null,
      );
      return reply.code(200).send({
        id: updated.id,
        clientId: updated.clientId,
        partitionId: updated.partitionId,
        streetThreshold: updated.streetThreshold,
        houseNumberThreshold: updated.houseNumberThreshold,
        postalCodeThreshold: updated.postalCodeThreshold,
        stateThreshold: updated.stateThreshold,
        addressNameThreshold: updated.addressNameThreshold,
        overallThreshold: updated.overallThreshold,
        createdAt: updated.createdAt.toISOString(),
        updatedAt: updated.updatedAt.toISOString(),
      });
    },
  );
}
