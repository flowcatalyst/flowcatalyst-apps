import { Type } from '@sinclair/typebox';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ScopeStore } from '@pinpoint/framework';
import type { AppContext } from '../../../app-context.js';
import { asPrincipalId } from '../../../domain/auth/ids.js';

const MeResponseSchema = Type.Object({
  id: Type.String(),
  principalType: Type.Union([Type.Literal('USER'), Type.Literal('SERVICE')]),
  name: Type.String(),
  email: Type.Union([Type.String(), Type.Null()]),
  // Flat permission set the principal holds (anchors carry the full catalog).
  // The SPA uses this to hide actions the user can't perform.
  permissions: Type.Array(Type.String()),
});

const UnauthorizedSchema = Type.Object({
  error: Type.Literal('Unauthorized'),
  message: Type.String(),
});

/**
 * Return the principal resolved from the authenticated request.
 *
 * Served at two paths:
 *   - `/me`      — the canonical unscoped API route (non-SPA clients).
 *   - `/auth/me` — what the Vue SPA's `checkSession()` polls. The SPA fetches
 *                  `/auth/me` (vite proxies `/auth/*` to the server); if it
 *                  isn't a real route the SPA reads the 404 as "logged out"
 *                  and bounces straight back to `/auth/login` — the redirect
 *                  loop. Keep both in sync with the same handler.
 *
 * In dev mode (x-user-id fallback in `server.ts`) the principal is upserted
 * on first call so subsequent requests succeed. In OIDC mode the callback
 * handler does the upsert and this is a pure read.
 */
export function registerMeRoute(fastify: FastifyInstance, appContext: AppContext): void {
  const routeOptions = {
    schema: {
      tags: ['Auth'],
      response: {
        200: MeResponseSchema,
        401: UnauthorizedSchema,
      },
    },
  } as const;

  const handler = async (_request: FastifyRequest, reply: FastifyReply): Promise<unknown> => {
    const scope = ScopeStore.get();
    if (!scope) {
      return reply.code(401).send({
        error: 'Unauthorized' as const,
        message: 'No authenticated principal — supply x-user-id (dev) or a valid OIDC token.',
      });
    }

    const principalId = asPrincipalId(scope.principalId);

    // Read the principal the OIDC callback already provisioned — it carries
    // the real name/email from the token. We must NOT upsert unconditionally
    // here: the upsert does `onConflictDoUpdate` on name/email, so writing the
    // placeholder `name: principalId` on every /me call would clobber the real
    // name (that's why the UI was showing the principal id). Only upsert when
    // the row is genuinely missing — the dev `x-user-id` path has no callback
    // to seed it, so the principal-id placeholder is an acceptable last resort.
    let principal = await appContext.repositories.principals.findById(principalId);
    if (!principal) {
      principal = await appContext.repositories.principals.upsert({
        id: principalId,
        principalType: scope.principalType,
        name: scope.principalId,
      });
    }

    return {
      id: principal.id,
      principalType: principal.principalType,
      name: principal.name,
      email: principal.email,
      permissions: [...scope.permissions],
    };
  };

  fastify.get('/me', routeOptions, handler);
  fastify.get('/auth/me', routeOptions, handler);
}
