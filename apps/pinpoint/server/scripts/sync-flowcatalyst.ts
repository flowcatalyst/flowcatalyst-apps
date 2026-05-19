#!/usr/bin/env tsx
/**
 * CI/CD script: register Pinpoint's FlowCatalyst-platform definitions
 * (event types, subscriptions, dispatch pools, roles, scheduled jobs).
 *
 * Required env:
 *   FLOWCATALYST_URL, FLOWCATALYST_CLIENT_ID, FLOWCATALYST_CLIENT_SECRET,
 *   PINPOINT_PUBLIC_BASE_URL
 *
 * Optional env:
 *   PINPOINT_DISPATCH_POOL (default: "pinpoint-default")
 *   FLOWCATALYST_REMOVE_UNLISTED=true  — prune SDK-sourced rows missing
 *                                        from the current set
 */
import { FlowCatalystClient } from '@flowcatalyst/sdk';
import { buildPinpointDefinitions } from '../src/flowcatalyst/index.js';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env: ${name}`);
  }
  return value;
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
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
