import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../../../app-context.js';
import { clearSessionCookie, SESSION_COOKIE_NAME } from '../../../auth/session-cookie.js';

/**
 * GET /auth/logout — drop the session row, clear the cookie, redirect to
 * /auth/login (or /, when the SPA owns the post-logout landing).
 */
export function registerLogoutRoute(fastify: FastifyInstance, appContext: AppContext): void {
  fastify.get(
    '/auth/logout',
    { schema: { tags: ['Auth'] } },
    async (request, reply) => {
      const { sessionStore, config } = appContext.auth;
      const sessionId = request.cookies?.[SESSION_COOKIE_NAME];
      if (sessionId) await sessionStore.delete(sessionId);

      const isSecure = config.oidc?.redirectUri.startsWith('https://') ?? true;
      clearSessionCookie(reply, { secure: isSecure });

      const target = config.oidc !== null ? '/auth/login' : '/';
      return reply.redirect(target, 302);
    },
  );
}
