import Fastify, { type FastifyRequest } from 'fastify';
import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import {
  ConcurrencyConflictError,
  Scope,
  ScopeStore,
  type RequestToken,
} from '@fulfil-go/framework';
import { db, sqlClient } from './infrastructure/db.js';
import { runStartupMigrations } from './infrastructure/migrate.js';
import { createAppContext, type AppContext } from './app-context.js';
import { loadAuthConfig } from './auth/auth-config.js';
import { ALL_PERMISSIONS_SET, resolvePermissions } from './auth/role-permissions.js';
import { registerJobRoutes } from './api/routes/jobs/index.js';
import { registerFulfilmentRoutes } from './api/routes/fulfilments/index.js';
import { registerFlightboardRoutes } from './api/routes/flightboard/index.js';
import { registerConfigRoutes } from './api/routes/config/index.js';
import { registerSseRoutes } from './api/routes/sse/index.js';
import { registerSyncRoutes } from './api/routes/sync/index.js';
import { registerAuthRoutes } from './api/routes/auth/index.js';
import { registerTelemetryRoutes } from './api/routes/telemetry/index.js';
import { registerScheduledJobRoutes } from './api/routes/scheduled-jobs/index.js';
import { registerPickRoutes } from './api/routes/picks/index.js';
import { registerPickerAdminRoutes } from './api/routes/pickers/index.js';
import { registerPickAuthRoutes } from './api/routes/pick-auth/index.js';
import { registerStoreRoutes } from './api/routes/stores/index.js';
import { registerProcessRoutes } from './api/routes/processes/index.js';
import { listenForSyncEvents } from './sse/sync-notify.js';
import { schedulePruneTask } from './scheduling/prune-events.js';
import { scheduleDevReleaseSweep } from './scheduling/dev-release-sweep.js';

declare module 'fastify' {
  interface FastifyRequest {
    rawBody?: string;
  }
}

const PORT = Number(process.env['PORT'] ?? 3200);
const HOST = process.env['HOST'] ?? '0.0.0.0';
// LOCAL tag on outbox rows — never forwarded to the platform (the poller
// posts only the payload; ingest identity comes from the bearer token).
// Useful for diagnostics / multi-app shared-outbox setups. Deliberately NOT
// `FLOWCATALYST_CLIENT_ID` — that env name belongs to the fc-dev outbox
// poller's OAuth credentials (the old app-code convention is vestigial).
const APPLICATION_CODE = process.env['FLOWCATALYST_APPLICATION_CODE'] ?? 'fulfil-go';
const PUBLIC_BASE_URL = process.env['FULFILGO_PUBLIC_BASE_URL'] ?? `http://localhost:${PORT}`;
const DISPATCH_POOL_CODE = process.env['FULFILGO_DISPATCH_POOL'] ?? 'fulfil-go-default';
/**
 * Shared secret the platform signs scheduled-job + dispatch webhooks with.
 * Unset (local dev) = per-request warning + bypass. NEVER deploy unset.
 */
const FLOWCATALYST_SIGNING_SECRET = process.env['FLOWCATALYST_SIGNING_SECRET'];

/**
 * Resolve the principal for an inbound request.
 *
 *   1. `Authorization: Bearer <jwt>` — validated via the issuer's JWKS.
 *      The mobile apps (and the Transistorsoft native uploader) use this
 *      path exclusively; there are no cookie sessions in fulfil-go.
 *   2. `x-user-id` header — only honoured when
 *      `FULFILGO_AUTH_DEV_FALLBACK=true`. Local dev / tests only.
 *
 * Returns `null` when neither produces a validated subject — the request
 * continues anonymously and any route that needs a scope 401s.
 */
async function extractRequestToken(
  req: FastifyRequest,
  appContext: AppContext,
): Promise<RequestToken | null> {
  const { tokenValidator, pickerTokenService, config } = appContext.auth;

  const authHeader = req.headers['authorization'];
  if (typeof authHeader === 'string' && authHeader.toLowerCase().startsWith('bearer ')) {
    const token = authHeader.slice('bearer '.length).trim();
    if (token.length > 0) {
      // Route by the (unverified) issuer: a fulfil-go-issued picker session
      // token goes to the picker verifier; everything else to the platform
      // JWKS validator — so a picker token never triggers a failed JWKS fetch.
      if (pickerTokenService.isPickerToken(token)) {
        try {
          const claims = await pickerTokenService.verifyAccess(token);
          const attributes: Record<string, string> = {
            clientId: claims.clientId,
            storeRef: claims.storeRef,
          };
          if (claims.deviceId) attributes['deviceId'] = claims.deviceId;
          return {
            sub: claims.pickerId,
            permissions: new Set(claims.permissions),
            attributes,
          };
        } catch (err) {
          req.log.warn({ err }, 'picker session token validation failed');
        }
      } else if (tokenValidator) {
        try {
          const claims = await tokenValidator.validate(token);
          return {
            sub: claims.sub,
            permissions: resolvePermissions(claims),
          };
        } catch (err) {
          req.log.warn({ err }, 'JWT validation failed');
        }
      }
    }
  }

  if (config.devFallback) {
    const sub = req.headers['x-user-id'];
    if (typeof sub === 'string' && sub.length > 0) {
      // Dev fallback grants everything. NEVER enable in production.
      return { sub, permissions: ALL_PERMISSIONS_SET };
    }
  }
  return null;
}

async function buildServer() {
  const server = Fastify({
    logger: { level: process.env['LOG_LEVEL'] ?? 'info' },
  }).withTypeProvider<TypeBoxTypeProvider>();

  // Capture raw JSON body — required for HMAC webhook verification if
  // platform webhooks land later.
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

  // Optimistic-lock conflicts throw from repository persist (tx already
  // rolled back) — map them to 409 here. Everything else keeps Fastify's
  // shape for ajv validation errors and logs + 500s the rest.
  server.setErrorHandler((err, request, reply) => {
    if (err instanceof ConcurrencyConflictError) {
      return reply.code(409).send({
        error: 'concurrency',
        code: err.code,
        message: err.message,
        details: null,
      });
    }
    const validation = (err as { validation?: unknown[] }).validation;
    if (validation) {
      return reply.code(400).send({ error: 'ValidationError', issues: validation });
    }
    request.log.error({ err }, 'unhandled request error');
    return reply.code(500).send({
      error: 'infrastructure',
      code: 'INTERNAL',
      message: 'Internal server error.',
      details: null,
    });
  });

  const appContext = await createAppContext({
    db,
    clientId: APPLICATION_CODE,
    publicBaseUrl: PUBLIC_BASE_URL,
    dispatchPoolCode: DISPATCH_POOL_CODE,
    auth: loadAuthConfig(),
  });

  // onRequest: bind a Scope on ALS for authenticated requests. The hook is
  // callback-style ON PURPOSE — calling `done` INSIDE `ScopeStore.run(scope,
  // done)` ties the rest of the request pipeline to the ALS-bound scope. An
  // `async` hook would exit the ALS context before the handlers run.
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
        title: 'fulfil-go API',
        version: '0.0.1',
        description:
          'On-demand fulfilment: job dispatch (SSE), driver telemetry ingest, ' +
          'offline-queued job transitions.',
      },
      tags: [
        { name: 'System', description: 'Health + ops endpoints' },
        { name: 'Auth', description: 'Mobile PKCE token brokering' },
        {
          name: 'Fulfilments',
          description: 'Fulfilment coordination: create → … (cancel-only, immutable)',
        },
        {
          name: 'Jobs',
          description: 'Job lifecycle: create → assign → accept → complete (demo vertical)',
        },
        { name: 'Sync', description: 'SSE push + delta-sync catch-up' },
        { name: 'Telemetry', description: 'Driver location ingest (Transistorsoft uploader)' },
        { name: 'Pickers', description: 'Pick-context picker admin (provision store staff)' },
        { name: 'PickAuth', description: 'Picker station auth: device-bound PIN/QR login' },
        { name: 'Stores', description: 'Store registry (reference data pickers bind to)' },
        { name: 'Picks', description: 'Pick work items: platform intake + picker claim' },
      ],
    },
  });

  await server.register(fastifySwaggerUi, { routePrefix: '/docs' });

  // Smoke endpoint — confirms the server boots and reaches steady state.
  server.get('/health', { schema: { tags: ['System'] } }, async () => ({
    status: 'ok',
    service: 'fulfil-go',
  }));

  registerAuthRoutes(server, appContext);
  registerFulfilmentRoutes(server, appContext);
  registerFlightboardRoutes(server, appContext);
  registerConfigRoutes(server, appContext);
  registerJobRoutes(server, appContext);
  registerSseRoutes(server, appContext);
  registerSyncRoutes(server, appContext);
  registerTelemetryRoutes(server, appContext);
  registerScheduledJobRoutes(server, appContext, {
    webhookAuth: { signingSecret: FLOWCATALYST_SIGNING_SECRET },
  });
  registerPickRoutes(server, appContext, {
    webhookAuth: { signingSecret: FLOWCATALYST_SIGNING_SECRET },
  });
  registerPickerAdminRoutes(server, appContext);
  registerPickAuthRoutes(server, appContext);
  registerStoreRoutes(server, appContext);
  registerProcessRoutes(server, appContext, {
    webhookAuth: { signingSecret: FLOWCATALYST_SIGNING_SECRET },
  });

  if (appContext.auth.config.picker.usingDevSecret) {
    server.log.warn(
      'PICKER_SESSION_SECRET is unset — using the built-in dev secret. NEVER run this in production.',
    );
  }

  appContext.sseBroker.start();
  // Cross-node wake-up: the sync_events insert trigger NOTIFYs on commit;
  // the poll interval remains the correctness backstop (see sync-notify.ts).
  const unlistenSync = await listenForSyncEvents(
    sqlClient,
    () => appContext.sseBroker.nudge(),
    server.log,
  );
  const pruneTask = schedulePruneTask(db, server.log);
  // Dev-only, loud fallback for the platform release-picks cron — see
  // scheduling/dev-release-sweep.ts. Off unless explicitly enabled.
  const devSweep =
    (process.env['FULFILGO_DEV_RELEASE_SWEEP'] ?? '').toLowerCase() === 'true'
      ? scheduleDevReleaseSweep(appContext, server.log)
      : null;
  if (devSweep) {
    server.log.warn(
      'FULFILGO_DEV_RELEASE_SWEEP is ON — local fallback will release due picks if the ' +
        'platform cron does not. NEVER enable in production.',
    );
  }
  server.addHook('onClose', async () => {
    pruneTask.stop();
    devSweep?.stop();
    await unlistenSync();
    await appContext.sseBroker.stop();
  });

  return server;
}

async function main(): Promise<void> {
  const server = await buildServer();

  // Prod runs migrations on boot (advisory-lock serialized across replicas);
  // local/dev/test use `pnpm db:init` + `pnpm db:migrate` and leave this off.
  if ((process.env['FULFILGO_DB_AUTO_MIGRATE'] ?? '').toLowerCase() === 'true') {
    try {
      await runStartupMigrations(server.log);
    } catch (err) {
      server.log.error(err, 'startup migrations failed; refusing to start');
      process.exit(1);
    }
  }

  try {
    await server.listen({ port: PORT, host: HOST });
    server.log.info({ port: PORT, host: HOST }, 'fulfil-go server listening');
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
}

main();
