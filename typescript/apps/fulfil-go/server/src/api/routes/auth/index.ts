import type { FastifyInstance, FastifyReply } from 'fastify';
import { Type } from '@sinclair/typebox';
import { ScopeStore } from '@fulfil-go/framework';
import {
  AuthorizeUrlRequestSchema,
  AuthorizeUrlResponseSchema,
  MobileRefreshRequestSchema,
  MobileTokenRequestSchema,
  MobileTokenResponseSchema,
  type AuthorizeUrlRequest,
  type MobileRefreshRequest,
  type MobileTokenRequest,
} from '@fulfil-go/shared';
import type { AppContext } from '../../../app-context.js';
import type { OidcTokens, ResolvedOidcClient } from '../../../auth/oidc-client.js';
import { ErrorResponseSchema } from '../../schemas/common.js';

/**
 * Mobile/SPA PKCE brokering — stateless, token-returning (no cookies, no
 * server session). The app generates verifier+challenge, opens the authorize
 * URL in the system browser, catches the deep-link callback, and posts the
 * code + verifier here. `POST /auth/mobile/refresh` doubles as the
 * Transistorsoft native uploader's `authorization.refreshUrl`.
 *
 * OAuth client topology: one client per app — requests carry `app`
 * ('execution' | 'picking' | 'management') and the broker binds the matching
 * credentials + redirect allowlist. Requests without `app` use the
 * `default` client (single-client dev setups).
 *
 * When no OIDC issuer is configured (local dev), these routes 503 — the dev
 * fallback (`x-user-id`) covers local auth instead.
 */
const notConfigured = (reply: FastifyReply) =>
  reply.code(503).send({
    error: 'infrastructure',
    code: 'OIDC_NOT_CONFIGURED',
    message: 'OIDC_ISSUER_URL is not configured on this server.',
    details: null,
  });

const unknownApp = (reply: FastifyReply, app: string | undefined) =>
  reply.code(400).send({
    error: 'validation',
    code: 'OIDC_CLIENT_NOT_CONFIGURED',
    message: `No OAuth client is configured for app '${app ?? 'default'}'.`,
    details: null,
  });

const redirectNotAllowed = (reply: FastifyReply, redirectUri: string) =>
  reply.code(400).send({
    error: 'validation',
    code: 'REDIRECT_URI_NOT_ALLOWED',
    message: `redirectUri '${redirectUri}' is not in the allowlist for this app.`,
    details: null,
  });

/**
 * If the token response omits expires_in, advertise a conservative 5-minute
 * lifetime — the client refreshes early rather than riding an unknown expiry.
 */
const toResponse = (tokens: OidcTokens) => ({
  accessToken: tokens.accessToken,
  ...(tokens.refreshToken ? { refreshToken: tokens.refreshToken } : {}),
  expiresAt: tokens.expiresAt !== null ? tokens.expiresAt * 1000 : Date.now() + 300_000,
});

export function registerAuthRoutes(fastify: FastifyInstance, appContext: AppContext): void {
  // Who am I — display identity for app chrome (name/email ride scope
  // attributes: OIDC claims on real tokens, x-user-name on the dev fallback).
  fastify.get(
    '/auth/me',
    {
      schema: {
        tags: ['Auth'],
        summary: 'Current principal identity',
        response: {
          200: Type.Object({
            principalId: Type.String(),
            name: Type.Union([Type.String(), Type.Null()]),
            email: Type.Union([Type.String(), Type.Null()]),
          }),
          401: ErrorResponseSchema,
        },
      },
    },
    async (_request, reply) => {
      const scope = ScopeStore.get();
      if (!scope) {
        return reply.code(401).send({
          error: 'authentication',
          code: 'UNAUTHENTICATED',
          message: 'Authentication required.',
          details: null,
        });
      }
      return reply.send({
        principalId: scope.principalId,
        name: scope.attributes['name'] ?? null,
        email: scope.attributes['email'] ?? null,
      });
    },
  );

  // Client registry for the management chrome (name + switcher). Served
  // from the platform via the SERVICE ACCOUNT (v1: every ACTIVE client —
  // when management runs on real user tokens, this can move to the
  // platform's user-scoped /api/me/clients). Cached briefly: the registry
  // changes rarely and every page render asks.
  let clientsCache: {
    at: number;
    clients: { id: string; name: string; identifier: string }[];
  } | null = null;
  const CLIENTS_CACHE_MS = 60_000;

  fastify.get(
    '/auth/clients',
    {
      schema: {
        tags: ['Auth'],
        summary: 'Clients available to the management UI',
        response: {
          200: Type.Object({
            clients: Type.Array(
              Type.Object({
                id: Type.String(),
                name: Type.String(),
                identifier: Type.String(),
              }),
            ),
          }),
          401: ErrorResponseSchema,
          503: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      if (!ScopeStore.get()) {
        return reply.code(401).send({
          error: 'authentication',
          code: 'UNAUTHENTICATED',
          message: 'Authentication required.',
          details: null,
        });
      }
      if (!appContext.platform) {
        return reply.code(503).send({
          error: 'infrastructure',
          code: 'PLATFORM_NOT_CONFIGURED',
          message: 'FLOWCATALYST_URL / API credentials are not configured on this server.',
          details: null,
        });
      }
      if (clientsCache && Date.now() - clientsCache.at < CLIENTS_CACHE_MS) {
        return reply.send({ clients: clientsCache.clients });
      }
      const result = await appContext.platform.clients().list();
      if (result.isErr()) {
        request.log.error({ err: result.error }, 'platform clients list failed');
        // Serve the stale cache over an error — the switcher degrades soft.
        if (clientsCache) return reply.send({ clients: clientsCache.clients });
        return reply.code(503).send({
          error: 'infrastructure',
          code: 'PLATFORM_UNAVAILABLE',
          message: 'The platform client registry is unreachable.',
          details: null,
        });
      }
      const clients = (result.value.clients ?? [])
        .filter((c) => c.status === 'ACTIVE')
        .map((c) => ({ id: c.id, name: c.name, identifier: c.identifier }));
      clientsCache = { at: Date.now(), clients };
      return reply.send({ clients });
    },
  );

  function resolveClient(reply: FastifyReply, app: string | undefined): ResolvedOidcClient | null {
    const { oidcBroker } = appContext.auth;
    if (!oidcBroker) {
      void notConfigured(reply);
      return null;
    }
    const client = oidcBroker.resolve(app);
    if (!client) {
      void unknownApp(reply, app);
      return null;
    }
    return client;
  }

  fastify.post(
    '/auth/mobile/authorize-url',
    {
      schema: {
        tags: ['Auth'],
        body: AuthorizeUrlRequestSchema,
        response: {
          200: AuthorizeUrlResponseSchema,
          400: ErrorResponseSchema,
          503: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const body = request.body as AuthorizeUrlRequest;
      const client = resolveClient(reply, body.app);
      if (!client) return;

      if (!client.allowedRedirectUris.includes(body.redirectUri)) {
        return redirectNotAllowed(reply, body.redirectUri);
      }

      const url = client.buildAuthorizeUrl({
        codeChallenge: body.codeChallenge,
        redirectUri: body.redirectUri,
        state: body.state,
      });
      return reply.code(200).send({ url: url.toString() });
    },
  );

  fastify.post(
    '/auth/mobile/token',
    {
      schema: {
        tags: ['Auth'],
        body: MobileTokenRequestSchema,
        response: {
          200: MobileTokenResponseSchema,
          400: ErrorResponseSchema,
          401: ErrorResponseSchema,
          503: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const body = request.body as MobileTokenRequest;
      const client = resolveClient(reply, body.app);
      if (!client) return;

      if (!client.allowedRedirectUris.includes(body.redirectUri)) {
        return redirectNotAllowed(reply, body.redirectUri);
      }

      try {
        const tokens = await client.exchangeCode(body);
        return reply.code(200).send(toResponse(tokens));
      } catch (err) {
        request.log.warn({ err }, 'mobile code exchange failed');
        return reply.code(401).send({
          error: 'authorization',
          code: 'CODE_EXCHANGE_FAILED',
          message: 'Authorization code exchange was rejected by the identity provider.',
          details: null,
        });
      }
    },
  );

  fastify.post(
    '/auth/mobile/refresh',
    {
      schema: {
        tags: ['Auth'],
        body: MobileRefreshRequestSchema,
        response: {
          200: MobileTokenResponseSchema,
          400: ErrorResponseSchema,
          401: ErrorResponseSchema,
          503: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const body = request.body as MobileRefreshRequest;
      const client = resolveClient(reply, body.app);
      if (!client) return;

      try {
        const tokens = await client.refresh(body.refreshToken);
        return reply.code(200).send(toResponse(tokens));
      } catch (err) {
        request.log.warn({ err }, 'mobile token refresh failed');
        return reply.code(401).send({
          error: 'authorization',
          code: 'REFRESH_FAILED',
          message: 'Refresh token was rejected by the identity provider.',
          details: null,
        });
      }
    },
  );
}
