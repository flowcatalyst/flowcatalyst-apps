import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import { ScopeStore } from '@pinpoint/framework';
import type { AppContext } from '../../../app-context.js';
import { asPrincipalId } from '../../../domain/auth/ids.js';

const MeResponseSchema = Type.Object({
  id: Type.String(),
  principalType: Type.Union([Type.Literal('USER'), Type.Literal('SERVICE')]),
  name: Type.String(),
  email: Type.Union([Type.String(), Type.Null()]),
});

const UnauthorizedSchema = Type.Object({
  error: Type.Literal('Unauthorized'),
  message: Type.String(),
});

/**
 * GET /me — return the principal resolved from the authenticated request.
 *
 * In dev mode (x-user-id fallback in `server.ts`) the principal is upserted
 * on first call so subsequent requests succeed. In production (OIDC flow,
 * later slice) the OIDC callback handler does the upsert and `/me` is a
 * pure read.
 */
export function registerMeRoute(fastify: FastifyInstance, appContext: AppContext): void {
  fastify.get(
    '/me',
    {
      schema: {
        tags: ['Auth'],
        response: {
          200: MeResponseSchema,
          401: UnauthorizedSchema,
        },
      },
    },
    async (_request, reply) => {
      const scope = ScopeStore.get();
      if (!scope) {
        return reply.code(401).send({
          error: 'Unauthorized' as const,
          message: 'No authenticated principal — supply x-user-id (dev) or a valid OIDC token.',
        });
      }

      const principalId = asPrincipalId(scope.principalId);

      // Upsert-on-read keeps the dev x-user-id flow working without a
      // separate provisioning step. In OIDC mode this collapses to a no-op
      // because the callback upserted ahead of time.
      const principal = await appContext.repositories.principals.upsert({
        id: principalId,
        principalType: scope.principalType,
        name: scope.principalId,
      });

      return {
        id: principal.id,
        principalType: principal.principalType,
        name: principal.name,
        email: principal.email,
      };
    },
  );
}
