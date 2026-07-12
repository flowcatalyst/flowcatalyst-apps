#!/usr/bin/env tsx
/**
 * Register fulfil-go's FlowCatalyst-platform definitions (event types,
 * roles, dispatch pools, subscriptions, scheduled jobs, PROCESS DIAGRAMS
 * from docs/processes/*.mmd, and the OPENAPI SPEC fetched from the running
 * server's /docs/json) and push payload JSON schemas for each event type.
 * Adapted from pinpoint's sync script — same two-phase shape:
 *
 *   1. `client.definitions().sync(...)` — upsert the DefinitionSet.
 *   2. For each event with a TypeBox `payloadSchema`, compare against the
 *      platform's latest specVersion and `addSchemaVersion` only when the
 *      shape actually changed. Idempotent.
 *
 * Required env (see .env.example):
 *   FLOWCATALYST_URL, FLOWCATALYST_API_CLIENT_ID, FLOWCATALYST_API_CLIENT_SECRET
 * Optional env:
 *   FULFILGO_PUBLIC_BASE_URL   (default http://localhost:3200)
 *   FULFILGO_DISPATCH_POOL     (default fulfil-go-default)
 *   FLOWCATALYST_REMOVE_UNLISTED=true — prune SDK-sourced rows missing here
 *   FULFILGO_SCHEMA_SYNC=false        — skip phase 2
 */
import { FlowCatalystClient } from '@flowcatalyst/sdk';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { CreateFulfilmentCommandSchema } from '@fulfil-go/shared';
import { buildFulfilGoDefinitions, FULFILGO_APPLICATION_CODE } from '../src/flowcatalyst/index.js';
import { fulfilGoEventTypes } from '../src/flowcatalyst/events.js';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env: ${name}`);
  }
  return value;
}

/** Stable JSON stringify — key order can't fake a schema change. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>).toSorted(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
}

interface SpecVersionLike {
  readonly schema?: unknown;
}

function latestSpecVersionSchema(specVersions: readonly SpecVersionLike[] | undefined): unknown {
  if (!specVersions || specVersions.length === 0) return null;
  return specVersions[specVersions.length - 1]?.schema ?? null;
}

async function syncEventSchemas(client: FlowCatalystClient): Promise<void> {
  const listResult = await client.eventTypes().list({ application: FULFILGO_APPLICATION_CODE });
  if (listResult.isErr()) {
    throw new Error(`Failed to list event types: ${String(listResult.error)}`);
  }

  const byCode = new Map<string, { id: string; specVersions?: readonly SpecVersionLike[] }>();
  for (const item of listResult.value.items) {
    byCode.set(item.code, { id: item.id, specVersions: item.specVersions });
  }

  let pushed = 0;
  let skipped = 0;
  let missing = 0;

  for (const event of fulfilGoEventTypes) {
    const remote = byCode.get(event.code);
    if (!remote) {
      console.warn(
        `[schema-sync] ${event.code}: event type not found on platform, skipping schema push`,
      );
      missing += 1;
      continue;
    }

    const remoteSchema = latestSpecVersionSchema(remote.specVersions);
    if (
      remoteSchema !== null &&
      stableStringify(event.payloadSchema) === stableStringify(remoteSchema)
    ) {
      skipped += 1;
      continue;
    }

    // Platform requires a semver on each schema push; derive the next
    // minor from how many spec versions already exist.
    const version = `1.${remote.specVersions?.length ?? 0}.0`;
    const pushResult = await client
      .eventTypes()
      .addSchemaVersion(remote.id, { schema: event.payloadSchema, version });
    if (pushResult.isErr()) {
      throw new Error(
        `Failed to push schema for ${event.code}: ${JSON.stringify(pushResult.error)}`,
      );
    }
    console.log(`[schema-sync] ${event.code}: pushed schema version ${version}`);
    pushed += 1;
  }

  console.log(`[schema-sync] done — pushed=${pushed} skipped=${skipped} missing=${missing}`);
}

interface OpenapiOperation {
  requestBody?: unknown;
}

interface OpenapiDocument {
  paths?: Record<string, Record<string, OpenapiOperation>>;
}

/**
 * Fetch the live OpenAPI document from the running server (fastify-swagger
 * builds it from the TypeBox route schemas; swagger-ui serves it at
 * /docs/json). Unreachable server → warn + skip, never fail the sync.
 *
 * One fix-up before publishing: create-fulfilment validates its body with
 * the shared ZOD contract in-handler (route body is Type.Any), so the raw
 * document would show an untyped body for the most important endpoint.
 * Patch in the JSON schema derived from the actual contract (clientId
 * omitted — it rides the path).
 */
async function fetchOpenapiSpec(publicBaseUrl: string): Promise<unknown | null> {
  const url = process.env['FULFILGO_OPENAPI_URL'] ?? `${publicBaseUrl}/docs/json`;
  let spec: OpenapiDocument;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    spec = (await res.json()) as OpenapiDocument;
  } catch (err) {
    console.warn(
      `[openapi-sync] could not fetch ${url} (${String(err)}) — skipping OpenAPI publish. ` +
        'Start the server (pnpm dev:fulfil-go) or set FULFILGO_OPENAPI_URL.',
    );
    return null;
  }

  const createPath = Object.keys(spec.paths ?? {}).find((p) =>
    /^\/clients\/\{?:?clientId\}?\/fulfilments$/.test(p),
  );
  const createOp = createPath ? spec.paths?.[createPath]?.['post'] : undefined;
  if (createOp) {
    createOp.requestBody = {
      required: true,
      content: {
        'application/json': {
          schema: zodToJsonSchema(CreateFulfilmentCommandSchema.omit({ clientId: true }), {
            $refStrategy: 'none',
            target: 'openApi3',
          }),
        },
      },
    };
  } else {
    console.warn('[openapi-sync] create-fulfilment path not found in spec — body left untyped');
  }
  return spec;
}

async function main(): Promise<void> {
  const client = new FlowCatalystClient({
    baseUrl: requireEnv('FLOWCATALYST_URL'),
    clientId: requireEnv('FLOWCATALYST_API_CLIENT_ID'),
    clientSecret: requireEnv('FLOWCATALYST_API_CLIENT_SECRET'),
  });

  const publicBaseUrl = process.env['FULFILGO_PUBLIC_BASE_URL'] ?? 'http://localhost:3200';
  const definitions = buildFulfilGoDefinitions({
    publicBaseUrl,
    dispatchPoolCode: process.env['FULFILGO_DISPATCH_POOL'] ?? 'fulfil-go-default',
    // Tenant that owns the scheduled job(s). Dev default: the platform's
    // Inhance client (see project memory / management-app default).
    tenantClientId: process.env['FULFILGO_TENANT_CLIENT_ID'] ?? 'clt_6F9GM54BB5G2Y',
  });

  // Publish the REST surface alongside the definitions (each sync replaces
  // the platform's stored copy). Sourced from the RUNNING server so the
  // catalogue can never diverge from what actually serves.
  const openapiSpec = await fetchOpenapiSpec(publicBaseUrl);
  if (openapiSpec) definitions.openapiSpec = openapiSpec;

  const removeUnlisted = process.env['FLOWCATALYST_REMOVE_UNLISTED'] === 'true';

  // NOTE: the SDK returns a neverthrow Result — it does NOT throw.
  // (Pinpoint's script misses this check and reports success on failure.)
  const syncResult = await client.definitions().sync(definitions, { removeUnlisted });
  if (typeof syncResult === 'object' && syncResult !== null && 'isErr' in syncResult) {
    const r = syncResult as { isErr(): boolean; error?: unknown; value?: unknown };
    if (r.isErr()) {
      throw new Error(`definitions sync failed: ${JSON.stringify(r.error)}`);
    }
    console.log('fulfil-go FlowCatalyst definitions synced:', JSON.stringify(r.value));
  } else {
    console.log('fulfil-go FlowCatalyst definitions synced.');
  }

  if (process.env['FULFILGO_SCHEMA_SYNC'] === 'false') {
    console.log('[schema-sync] skipped (FULFILGO_SCHEMA_SYNC=false)');
    return;
  }
  await syncEventSchemas(client);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
