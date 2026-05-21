import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../../../app-context.js';
import { setSessionCookie } from '../../../auth/session-cookie.js';

const NotConfiguredSchema = Type.Object({
  error: Type.Literal('OidcNotConfigured'),
  message: Type.String(),
});

/**
 * GET /auth/login — start an OIDC authorization-code-with-PKCE flow.
 *
 * Stores the PKCE verifier + state in a fresh session row, sets the
 * session cookie, and redirects to the IdP's authorize URL. The cookie
 * has to be set BEFORE the redirect so the callback can correlate the
 * inbound request back to its pre-redirect state.
 */
export function registerLoginRoute(fastify: FastifyInstance, appContext: AppContext): void {
  fastify.get(
    '/auth/login',
    {
      schema: {
        tags: ['Auth'],
        response: { 503: NotConfiguredSchema },
      },
    },
    async (request, reply) => {
      const { oidcClient, sessionStore, config } = appContext.auth;
      if (!oidcClient) {
        return reply.code(503).send({
          error: 'OidcNotConfigured' as const,
          message:
            'OIDC issuer not configured. Set OIDC_ISSUER_URL (and OIDC_CLIENT_ID) to enable login.',
        });
      }

      const { url, state, codeVerifier } = await oidcClient.buildAuthorizeUrl();
      const sessionId = sessionStore.generateId();
      sessionStore.create(sessionId, { codeVerifier, state });

      // `secure: true` requires HTTPS; loosen for plain-HTTP local dev
      // where the redirect URI is http://localhost:... The Set-Cookie
      // attribute is ignored by browsers on secure-only cookies over
      // plain HTTP, so without this flip dev would silently lose the
      // session before the callback.
      const isSecure = config.oidc?.redirectUri.startsWith('https://') ?? true;
      setSessionCookie(reply, sessionId, { secure: isSecure });

      return reply.redirect(url.toString(), 302);
    },
  );
}
