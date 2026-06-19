import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../../../app-context.js';
import { SESSION_COOKIE_NAME } from '../../../auth/session-cookie.js';
import { asPrincipalId } from '../../../domain/auth/ids.js';

const ErrorSchema = Type.Object({
  error: Type.String(),
  message: Type.String(),
});

/**
 * GET /auth/callback — exchange the OIDC `code` for tokens, fetch
 * userinfo, upsert the principal, attach everything to the session, and
 * redirect the browser into the SPA.
 *
 * Validates the `state` query param against the session's stored state
 * (the openid-client library also does that check; we keep it on the
 * session side as defence-in-depth).
 */
export function registerCallbackRoute(fastify: FastifyInstance, appContext: AppContext): void {
  fastify.get(
    '/auth/callback',
    {
      schema: {
        tags: ['Auth'],
        querystring: Type.Object({
          code: Type.Optional(Type.String()),
          state: Type.Optional(Type.String()),
          error: Type.Optional(Type.String()),
          error_description: Type.Optional(Type.String()),
        }),
        response: {
          400: ErrorSchema,
          401: ErrorSchema,
          500: ErrorSchema,
          503: ErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const { oidcClient, sessionStore, config } = appContext.auth;
      if (!oidcClient) {
        return reply.code(503).send({
          error: 'OidcNotConfigured',
          message: 'OIDC issuer not configured.',
        });
      }

      const query = request.query as {
        code?: string;
        state?: string;
        error?: string;
        error_description?: string;
      };
      if (query.error) {
        return reply.code(401).send({
          error: query.error,
          message: query.error_description ?? 'IdP returned an authorization error.',
        });
      }
      if (!query.code || !query.state) {
        return reply.code(400).send({
          error: 'BadRequest',
          message: 'Missing `code` or `state` in callback query.',
        });
      }

      const sessionId = request.cookies?.[SESSION_COOKIE_NAME];
      if (!sessionId) {
        return reply.code(400).send({
          error: 'BadRequest',
          message: 'Missing session cookie — start at /auth/login.',
        });
      }
      const session = await sessionStore.get(sessionId);
      if (!session) {
        return reply.code(400).send({
          error: 'BadRequest',
          message: 'Unknown session — start at /auth/login.',
        });
      }
      if (session.codeVerifier === null || session.state === null) {
        return reply.code(400).send({
          error: 'BadRequest',
          message: 'No pending auth flow on this session.',
        });
      }
      if (session.state !== query.state) {
        return reply.code(400).send({
          error: 'BadRequest',
          message: 'State parameter mismatch — possible CSRF attempt or stale callback.',
        });
      }

      let tokens;
      try {
        const currentUrl = new URL(request.url, `${request.protocol}://${request.hostname}`);
        tokens = await oidcClient.exchangeCode(currentUrl, session.codeVerifier, session.state);
      } catch (err) {
        request.log.error({ err }, 'OIDC token exchange failed');
        return reply.code(500).send({
          error: 'TokenExchangeFailed',
          message: err instanceof Error ? err.message : String(err),
        });
      }

      // userinfo is best-effort: some IdPs return everything in the
      // id_token / access_token and the userinfo endpoint returns 401
      // for older sessions. Don't fail the login on a userinfo miss.
      let userinfo;
      try {
        userinfo = await oidcClient.fetchUserInfo(tokens.accessToken, null);
      } catch (err) {
        request.log.warn({ err }, 'userinfo fetch failed, continuing without it');
        userinfo = null;
      }

      await sessionStore.update(sessionId, {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        sub: userinfo?.sub ?? session.sub ?? null,
        name: userinfo?.name ?? null,
        email: userinfo?.email ?? null,
        // Clear the in-flight fields — they're consumed.
        codeVerifier: null,
        state: null,
      });

      // Best-effort: upsert the principal so downstream BFF reads can
      // resolve it without waiting for the user's first /me call. The
      // upsert is a raw repo write (no ScopeStore required) so we can
      // call it directly outside of `runWrite`.
      if (userinfo?.sub) {
        const principalId = asPrincipalId(userinfo.sub);
        try {
          await appContext.repositories.principals.upsert({
            id: principalId,
            principalType: 'USER',
            name: userinfo.name ?? userinfo.sub,
            email: userinfo.email ?? null,
          });
        } catch (err) {
          request.log.warn({ err }, 'principal upsert failed; /me will retry on first call');
        }
      }

      const target = config.postLoginRedirect;
      return reply.redirect(target, 302);
    },
  );
}
