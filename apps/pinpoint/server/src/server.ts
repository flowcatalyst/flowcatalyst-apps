import Fastify, { type FastifyRequest } from 'fastify';
import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { Scope, ScopeStore, type RequestToken } from '@pinpoint/framework';
import { db } from './infrastructure/db.js';
import { createAppContext } from './app-context.js';
import { registerMeRoute } from './api/routes/auth/me.route.js';
import { registerCountriesRoute } from './api/routes/reference/countries.route.js';

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

function extractRequestToken(req: FastifyRequest): RequestToken | null {
  // TODO(auth): real OIDC extractor replaces this in a later slice. Dev
  // fallback honors `x-user-id` so authenticated routes can be exercised
  // end-to-end without a real IdP, matching fulfil's pattern.
  const sub = req.headers['x-user-id'];
  if (typeof sub !== 'string') return null;
  return { sub };
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

  // onRequest: bind a Scope on ALS for authenticated requests. Mirrors the
  // shape of @fulfil/framework's `frameworkFastifyPlugin` minus the
  // Fulfil-specific SLA / Prometheus pieces. Slice 1 introduces real auth.
  server.addHook('onRequest', (req, _reply, done) => {
    const token = extractRequestToken(req);
    if (token) {
      const scope = Scope.fromRequest(token);
      ScopeStore.run(scope, done);
    } else {
      done();
    }
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
      ],
    },
  });

  await server.register(fastifySwaggerUi, { routePrefix: '/docs' });

  const appContext = createAppContext({
    db,
    clientId: CLIENT_ID,
    publicBaseUrl: PUBLIC_BASE_URL,
    dispatchPoolCode: DISPATCH_POOL_CODE,
  });

  // Smoke endpoint — confirms the server boots and reaches steady state.
  server.get('/health', { schema: { tags: ['System'] } }, async () => ({
    status: 'ok',
    service: 'pinpoint',
  }));

  registerMeRoute(server, appContext);
  registerCountriesRoute(server, appContext);

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
