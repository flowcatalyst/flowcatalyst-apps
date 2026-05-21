import Fastify, { type FastifyRequest } from 'fastify';
import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { Scope, ScopeStore, type RequestToken } from '@pinpoint/framework';
import { db } from './infrastructure/db.js';
import { createAppContext } from './app-context.js';
import { registerMeRoute } from './api/routes/auth/me.route.js';
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
        { name: 'Tenancy', description: 'Clients + partitions — the tenancy spine' },
        { name: 'Locations', description: 'Raw addresses + matching pipeline' },
        { name: 'Layers', description: 'Layers, features, and per-feature properties' },
        { name: 'Matching', description: 'Matching configs + spatial lookup' },
        { name: 'Geocode', description: 'Forward + reverse geocoding (Photon-backed, rate-limited)' },
        { name: 'Verify', description: 'LLM-backed address-match verification (Bedrock / Ollama / Noop)' },
        { name: 'MasterLocations', description: 'Master-location lifecycle: geocode (validate) + canonicalize (confirm) + reads' },
        { name: 'Jobs', description: 'FlowCatalyst-scheduled job webhooks (HMAC-verified)' },
      ],
    },
  });

  await server.register(fastifySwaggerUi, { routePrefix: '/docs' });

  const appContext = createAppContext({
    db,
    clientId: CLIENT_ID,
    publicBaseUrl: PUBLIC_BASE_URL,
    dispatchPoolCode: DISPATCH_POOL_CODE,
    geocodingApiUrl: GEOCODING_API_URL,
    geocodingRateLimit: GEOCODING_RATE_LIMIT,
    addressVerifier: buildAddressVerifierConfig(),
    libpostalUrl: LIBPOSTAL_URL,
  });

  // Smoke endpoint — confirms the server boots and reaches steady state.
  server.get('/health', { schema: { tags: ['System'] } }, async () => ({
    status: 'ok',
    service: 'pinpoint',
  }));

  registerMeRoute(server, appContext);
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
