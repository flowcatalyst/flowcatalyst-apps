#!/usr/bin/env tsx
/**
 * CI/CD script: register Pinpoint's FlowCatalyst-platform definitions
 * (event types, subscriptions, dispatch pools, roles, scheduled jobs)
 * and push payload JSON schemas for each event type.
 *
 * Two-phase shape:
 *   1. `client.definitions().sync(...)` — register event-type codes +
 *      names + descriptions, subscriptions, dispatch pools, roles.
 *      The SDK's DefinitionSet doesn't carry payload schemas, so this
 *      step alone leaves the platform without schema versions.
 *   2. For each pinpoint event with a TypeBox `payloadSchema`, list the
 *      platform's event types, look up the TSID by code, compare the
 *      latest specVersion's schema, and call
 *      `eventTypes.addSchemaVersion(id, { schema })` ONLY when the
 *      shape has actually changed. Idempotent — repeat invocations
 *      against an up-to-date platform skip the addSchemaVersion call.
 *
 * Required env:
 *   FLOWCATALYST_URL, FLOWCATALYST_CLIENT_ID, FLOWCATALYST_CLIENT_SECRET,
 *   PINPOINT_PUBLIC_BASE_URL
 *
 * Optional env:
 *   PINPOINT_DISPATCH_POOL (default: "pinpoint-default")
 *   FLOWCATALYST_REMOVE_UNLISTED=true  — prune SDK-sourced rows missing
 *                                        from the current set
 *   PINPOINT_SCHEMA_SYNC=false         — skip phase 2 (debug aid; the
 *                                        DefinitionSet sync still runs)
 */
import { FlowCatalystClient } from '@flowcatalyst/sdk';
import { buildPinpointDefinitions } from '../src/flowcatalyst/index.js';
import { pinpointEventTypes } from '../src/flowcatalyst/events.js';

const PINPOINT_APPLICATION_CODE = 'pinpoint';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env: ${name}`);
  }
  return value;
}

/**
 * Stable JSON stringify — sorts object keys recursively so two
 * structurally-equivalent schemas hash the same regardless of the key
 * order the platform returned. Cheap to implement, robust enough for
 * the schema-comparison use case.
 */
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
  // The list endpoint returns specVersions in version order; the last
  // one is the current. Defensive against undefined `schema` fields —
  // detail views include schema, summary views may not.
  return specVersions[specVersions.length - 1]?.schema ?? null;
}

async function syncEventSchemas(client: FlowCatalystClient): Promise<void> {
  const listResult = await client.eventTypes().list({ application: PINPOINT_APPLICATION_CODE });
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

  for (const event of pinpointEventTypes) {
    const remote = byCode.get(event.code);
    if (!remote) {
      // The DefinitionSet sync should have created the row; if it
      // didn't, something upstream went wrong and we shouldn't paper
      // over it by adding a schema to a non-existent event type.
      console.warn(
        `[schema-sync] ${event.code}: event type not found on platform, skipping schema push`,
      );
      missing += 1;
      continue;
    }

    const remoteSchema = latestSpecVersionSchema(remote.specVersions);
    const localSchemaJson = stableStringify(event.payloadSchema);
    const remoteSchemaJson = stableStringify(remoteSchema);

    if (remoteSchema !== null && localSchemaJson === remoteSchemaJson) {
      skipped += 1;
      continue;
    }

    const pushResult = await client
      .eventTypes()
      .addSchemaVersion(remote.id, { schema: event.payloadSchema });
    if (pushResult.isErr()) {
      throw new Error(`Failed to push schema for ${event.code}: ${String(pushResult.error)}`);
    }
    console.log(`[schema-sync] ${event.code}: pushed new schema version`);
    pushed += 1;
  }

  console.log(`[schema-sync] done — pushed=${pushed} skipped=${skipped} missing=${missing}`);
}

async function main(): Promise<void> {
  const client = new FlowCatalystClient({
    baseUrl: requireEnv('FLOWCATALYST_URL'),
    clientId: requireEnv('FLOWCATALYST_CLIENT_ID'),
    clientSecret: requireEnv('FLOWCATALYST_CLIENT_SECRET'),
  });

  const definitions = buildPinpointDefinitions({
    publicBaseUrl: requireEnv('PINPOINT_PUBLIC_BASE_URL'),
    dispatchPoolCode: process.env['PINPOINT_DISPATCH_POOL'] ?? 'pinpoint-default',
  });

  const removeUnlisted = process.env['FLOWCATALYST_REMOVE_UNLISTED'] === 'true';

  await client.definitions().sync(definitions, { removeUnlisted });
  console.log('Pinpoint FlowCatalyst definitions synced.');

  if (process.env['PINPOINT_SCHEMA_SYNC'] === 'false') {
    console.log('[schema-sync] skipped (PINPOINT_SCHEMA_SYNC=false)');
    return;
  }
  await syncEventSchemas(client);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
