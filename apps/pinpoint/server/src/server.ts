import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import Fastify, { type FastifyRequest } from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { Scope, ScopeStore, type RequestToken } from '@pinpoint/framework';
import { db } from './infrastructure/db.js';
import { createAppContext, type AppContext } from './app-context.js';
import { loadAuthConfig } from './auth/auth-config.js';
import { ALL_PERMISSIONS_SET, permissionsForRoles } from './auth/role-permissions.js';
import { SESSION_COOKIE_NAME } from './auth/session-cookie.js';
import { registerAuthRoutes } from './api/routes/auth/index.js';
import { registerCountriesRoute } from './api/routes/reference/countries.route.js';
import { registerClientRoutes } from './api/routes/tenancy/clients/index.js';
import { registerPartitionRoutes } from './api/routes/tenancy/partitions/index.js';
import { registerLocationRoutes } from './api/routes/locations/index.js';
import { registerLayerRoutes } from './api/routes/layers/index.js';
import { registerLayerFeatureRoutes } from './api/routes/layer-features/index.js';
import { registerPropertySetRoutes } from './api/routes/property-sets/index.js';
import { registerMatchingConfigRoutes } from './api/routes/matching-config/index.js';
import { registerSpatialLookupRoutes } from './api/routes/spatial-lookup/index.js';
import { registerGeocodeRoutes } from './api/routes/geocode/index.js';
import { registerVerifyMatchRoutes } from './api/routes/verify-match/index.js';
import { registerMasterLocationRoutes } from './api/routes/master-locations/index.js';
import { registerJobsRoutes } from './api/routes/jobs/index.js';
import { registerBffRoutes } from './api/routes/bff/index.js';
import type { AddressVerifierConfig } from './app-context.js';

declare module 'fastify' {
  interface FastifyRequest {
    rawBody?: string;
  }
}

const PORT = Number(process.env['PORT'] ?? 3000);
const HOST = process.env['HOST'] ?? '0.0.0.0';
const CLIENT_ID = process.env['FLOWCATALYST_CLIENT_ID'] ?? 'pinpoint';
const PUBLIC_BASE_URL = process.env['PINPOINT_PUBLIC_BASE_URL'] ?? `http://localhost:${PORT}`;
const DISPATCH_POOL_CODE = process.env['PINPOINT_DISPATCH_POOL'] ?? 'pinpoint-default';
const GEOCODING_API_URL = process.env['PINPOINT_GEOCODING_API_URL'] ?? 'https://photon.komoot.io';
const GEOCODING_RATE_LIMIT = Number(process.env['PINPOINT_GEOCODING_RATE_LIMIT'] ?? 5);
const LIBPOSTAL_URL = process.env['PINPOINT_LIBPOSTAL_URL'] ?? 'http://localhost:4400';
/**
 * Absolute (or server-relative) path to the built Vue SPA's `dist/`
 * directory. When set, the server serves that directory at `/` with a
 * SPA fallback (any unmatched GET returns `index.html` so the client
 * router can pick it up). When unset — local dev — the SPA runs under
 * its own Vite server on port 5173 and the API server stays headless.
 */
const WEB_DIST_DIR = process.env['PINPOINT_WEB_DIST_DIR'];
/**
 * Shared secret the FlowCatalyst platform signs scheduled-job + reactor
 * webhooks with. When unset (local dev), the auth hook logs a per-request
 * warning and lets requests through. NEVER deploy without this set.
 */
const FLOWCATALYST_SIGNING_SECRET = process.env['FLOWCATALYST_SIGNING_SECRET'];

/**
 * LLM provider selection mirrors the Rust pinpoint's `LLM_PROVIDER` /
 * `LLM_MODEL` / `OLLAMA_URL` env shape:
 *
 *   PINPOINT_LLM_PROVIDER=none|bedrock|ollama   (default: none)
 *   PINPOINT_LLM_MODEL=<model-id>               (provider-specific default)
 *   PINPOINT_OLLAMA_URL=http://...              (ollama only, default localhost)
 *   AWS_REGION=...                              (bedrock only, default us-east-1)
 *
 * Defaults match Rust verbatim: gemma3 for Ollama, claude-3-haiku-20240307
 * for Bedrock. Bumping either default risks invalidating tuning the Rust
 * pinpoint did against those exact models — keep changes deliberate.
 */
function buildAddressVerifierConfig(): AddressVerifierConfig {
  const provider = (process.env['PINPOINT_LLM_PROVIDER'] ?? 'none').toLowerCase();
  const model = process.env['PINPOINT_LLM_MODEL'];

  if (provider === 'bedrock') {
    return {
      provider: 'bedrock',
      model: model && model.length > 0 ? model : 'anthropic.claude-3-haiku-20240307-v1:0',
      ...(process.env['AWS_REGION'] ? { region: process.env['AWS_REGION'] } : {}),
    };
  }
  if (provider === 'ollama') {
    return {
      provider: 'ollama',
      baseUrl: process.env['PINPOINT_OLLAMA_URL'] ?? 'http://localhost:11434',
      model: model && model.length > 0 ? model : 'gemma3',
    };
  }
  return { provider: 'none' };
}

/**
 * Resolve the principal for an inbound request. Order of precedence
 * mirrors the Rust pinpoint:
 *
 *   1. `Authorization: Bearer <jwt>` — validated via the issuer's JWKS.
 *      Service-to-service callers (CI tooling, the FlowCatalyst platform
 *      itself) use this path.
 *   2. Session cookie (`pp_session`) — looks up the stored access token
 *      and validates that. Browsers use this path after `/auth/login`.
 *   3. `x-user-id` header — only honoured when
 *      `PINPOINT_AUTH_DEV_FALLBACK=true`. Convenient for local dev /
 *      integration tests; should be unset in production.
 *
 * Returns `null` when none of the above produce a validated subject —
 * the request continues anonymously and any route that needs a scope
 * will 401 via the missing-ScopeStore path.
 */
async function extractRequestToken(
  req: FastifyRequest,
  appContext: AppContext,
): Promise<RequestToken | null> {
  const { tokenValidator, sessionStore, config } = appContext.auth;

  const authHeader = req.headers['authorization'];
  if (typeof authHeader === 'string' && authHeader.toLowerCase().startsWith('bearer ')) {
    const token = authHeader.slice('bearer '.length).trim();
    if (token.length > 0 && tokenValidator) {
      try {
        const claims = await tokenValidator.validate(token);
        return {
          sub: claims.sub,
          permissions: permissionsForRoles(claims.roles),
        };
      } catch (err) {
        req.log.warn({ err }, 'JWT validation failed');
      }
    }
  }

  const sessionId = req.cookies?.[SESSION_COOKIE_NAME];
  if (sessionId) {
    const session = sessionStore.get(sessionId);
    if (session && session.accessToken.length > 0) {
      if (tokenValidator) {
        try {
          const claims = await tokenValidator.validate(session.accessToken);
          return {
            sub: claims.sub,
            permissions: permissionsForRoles(claims.roles),
          };
        } catch (err) {
          // Don't try to refresh in the hot path — surface 401 and let
          // the SPA bounce through /auth/login. Refresh-on-expiry can
          // land in a follow-up if it turns out to be a UX problem.
          req.log.info({ err }, 'session access token failed validation');
        }
      } else if (session.sub) {
        // No validator (no OIDC issuer configured) but a session exists.
        // Trust the stored sub — used only in test setups. Grant the
        // full permission set since this code path is gated on the
        // OIDC issuer being unconfigured (only happens in test rigs).
        return { sub: session.sub, permissions: ALL_PERMISSIONS_SET };
      }
    }
  }

  if (config.devFallback) {
    const sub = req.headers['x-user-id'];
    if (typeof sub === 'string' && sub.length > 0) {
      // Dev fallback grants everything — matches the Rust pinpoint
      // dev path. NEVER enable in production.
      return { sub, permissions: ALL_PERMISSIONS_SET };
    }
  }
  return null;
}

async function buildServer() {
  const server = Fastify({
    logger: { level: process.env['LOG_LEVEL'] ?? 'info' },
  }).withTypeProvider<TypeBoxTypeProvider>();

  // Capture raw JSON body — required for HMAC webhook verification when
  // process / scheduled-job webhooks land in later slices.
  server.addContentTypeParser('application/json', { parseAs: 'buffer' }, (req, body, done) => {
    const text = body.toString('utf8');
    req.rawBody = text;
    if (text.length === 0) {
      done(null, {});
      return;
    }
    try {
      done(null, JSON.parse(text));
    } catch (err) {
      done(err as Error, undefined);
    }
  });

  // @fastify/cookie has to be registered BEFORE the onRequest hook that
  // reads `req.cookies`. The plugin runs as part of Fastify's preHandler
  // / preValidation chain so onRequest still sees parsed cookies via
  // request.cookies on hooks registered after `register`.
  await server.register(fastifyCookie);

  // onRequest: bind a Scope on ALS for authenticated requests. The hook
  // is callback-style on purpose — calling `done` INSIDE
  // `ScopeStore.run(scope, done)` is what ties the rest of the request
  // pipeline to the ALS-bound scope. An `async` hook that returns a
  // promise hands control back to Fastify OUTSIDE the scope (the
  // promise resolution happens after `store.run` has exited and
  // restored the previous ALS context), so subsequent handlers see
  // undefined. Auth resolution is itself async, so we run it as a
  // promise and re-enter the callback world via `.then`.
  server.addHook('onRequest', (req, _reply, done) => {
    extractRequestToken(req, appContext)
      .then((token) => {
        if (token) {
          const scope = Scope.fromRequest(token);
          ScopeStore.run(scope, done);
        } else {
          done();
        }
      })
      .catch((err) => done(err as Error));
  });

  await server.register(fastifySwagger, {
    openapi: {
      info: {
        title: 'Pinpoint API',
        version: '0.0.1',
        description:
          'Address resolution, spatial matching, and partition management. ' +
          'Port of the Rust pinpoint service — see apps/pinpoint/docs/MIGRATION_PLAN.md.',
      },
      tags: [
        { name: 'System', description: 'Health + ops endpoints' },
        { name: 'Auth', description: 'Principal identity + session' },
        { name: 'Reference', description: 'Reference data (countries, …)' },
        { name: 'Tenancy', description: 'Clients + partitions — the tenancy spine' },
        { name: 'Locations', description: 'Raw addresses + matching pipeline' },
        { name: 'Layers', description: 'Layers, features, and per-feature properties' },
        { name: 'Matching', description: 'Matching configs + spatial lookup' },
        { name: 'Geocode', description: 'Forward + reverse geocoding (Photon-backed, rate-limited)' },
        { name: 'Verify', description: 'LLM-backed address-match verification (Bedrock / Ollama / Noop)' },
        { name: 'MasterLocations', description: 'Master-location lifecycle: geocode (validate) + canonicalize (confirm) + reads' },
        { name: 'Jobs', description: 'FlowCatalyst-scheduled job webhooks (HMAC-verified)' },
        { name: 'BFF', description: 'UI-shaped endpoints for the Vue SPA (mounted under /bff/...)' },
      ],
    },
  });

  await server.register(fastifySwaggerUi, { routePrefix: '/docs' });

  const appContext = await createAppContext({
    db,
    clientId: CLIENT_ID,
    publicBaseUrl: PUBLIC_BASE_URL,
    dispatchPoolCode: DISPATCH_POOL_CODE,
    geocodingApiUrl: GEOCODING_API_URL,
    geocodingRateLimit: GEOCODING_RATE_LIMIT,
    addressVerifier: buildAddressVerifierConfig(),
    auth: loadAuthConfig(),
    libpostalUrl: LIBPOSTAL_URL,
  });

  // Smoke endpoint — confirms the server boots and reaches steady state.
  server.get('/health', { schema: { tags: ['System'] } }, async () => ({
    status: 'ok',
    service: 'pinpoint',
  }));

  registerAuthRoutes(server, appContext);
  registerCountriesRoute(server, appContext);
  registerClientRoutes(server, appContext);
  registerPartitionRoutes(server, appContext);
  registerLocationRoutes(server, appContext);
  registerLayerRoutes(server, appContext);
  registerLayerFeatureRoutes(server, appContext);
  registerPropertySetRoutes(server, appContext);
  registerMatchingConfigRoutes(server, appContext);
  registerSpatialLookupRoutes(server, appContext);
  registerGeocodeRoutes(server, appContext);
  registerVerifyMatchRoutes(server, appContext);
  registerMasterLocationRoutes(server, appContext);
  registerJobsRoutes(server, appContext, {
    webhookAuth: { signingSecret: FLOWCATALYST_SIGNING_SECRET },
  });
  registerBffRoutes(server, appContext);

  if (WEB_DIST_DIR) {
    const root = resolve(WEB_DIST_DIR);
    if (!existsSync(root)) {
      server.log.warn({ root }, 'PINPOINT_WEB_DIST_DIR is set but the directory does not exist; skipping static serving');
    } else {
      await server.register(fastifyStatic, {
        root,
        prefix: '/',
        // Don't auto-serve index.html for non-root paths — the SPA's
        // client-side router owns deep links. We serve index.html
        // explicitly in the setNotFoundHandler fallback below.
        index: 'index.html',
      });
      // SPA fallback: any unmatched GET (not /api, /bff, /me, /health,
      // /jobs, /docs, /geocode, /verify-match, /countries) returns
      // index.html so the client router can resolve the route.
      server.setNotFoundHandler((req, reply) => {
        if (req.method !== 'GET') {
          return reply.code(404).send({ error: 'NotFound', message: `Route ${req.method} ${req.url} not found.` });
        }
        return reply.type('text/html').sendFile('index.html');
      });
      server.log.info({ root }, 'Serving Vue SPA from PINPOINT_WEB_DIST_DIR');
    }
  }

  return server;
}

async function main(): Promise<void> {
  const server = await buildServer();
  try {
    await server.listen({ port: PORT, host: HOST });
    server.log.info({ port: PORT, host: HOST }, 'Pinpoint server listening');
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
}

main();
