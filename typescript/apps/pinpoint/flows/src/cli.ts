#!/usr/bin/env tsx
/**
 * pinpoint flow walkthrough — see README.md.
 *
 *   pnpm flows [--base-url URL] [--principal prn_x] [--seed-only] [--cleanup] [--no-db]
 */
import { parseArgs } from 'node:util';
import { makeApi, ok } from './client.js';
import { Report } from './report.js';
import { seed } from './seed.js';
import { cleanup, runFlows } from './flows.js';
import { observeOutbox } from './outbox.js';

const { values } = parseArgs({
  // pnpm forwards a literal `--` separator; drop it so parseArgs sees only options.
  args: process.argv.slice(2).filter((a) => a !== '--'),
  options: {
    'base-url': {
      type: 'string',
      default: process.env['PINPOINT_BASE_URL'] ?? 'http://localhost:3100',
    },
    principal: { type: 'string', default: 'prn_flows' },
    'seed-only': { type: 'boolean', default: false },
    cleanup: { type: 'boolean', default: false },
    'no-db': { type: 'boolean', default: false },
    help: { type: 'boolean', default: false },
  },
});
if (values.help) {
  process.stdout.write(
    'pnpm flows [--base-url URL] [--principal prn_x] [--seed-only] [--cleanup] [--no-db]',
  );
  process.exit(0);
}
const baseUrl = values['base-url']!.replace(/\/+$/, '');
const api = makeApi(baseUrl, values.principal!);
const r = new Report();
const startedAt = new Date();
const runTag = startedAt
  .toISOString()
  .replace(/[-:TZ.]/g, '')
  .slice(2, 14);

process.stdout.write(
  `pinpoint flow walkthrough → ${baseUrl} as ${values.principal} (run ${runTag})\n`,
);

const healthy = await r.step('Preflight: server reachable, dev identity accepted', async () => {
  const res = await fetch(`${baseUrl}/health`);
  r.expect(res.ok, `GET /health → ${res.status}`);
  try {
    const me = await ok(api.GET('/me'));
    r.note(`identity ${me.id} permissions=${me.permissions.length}`);
    r.expect(me.permissions.length > 0, 'dev identity carries permissions');
  } catch (err) {
    throw new Error(
      `x-user-id identity rejected (${err instanceof Error ? err.message : String(err)}). ` +
        'Start the server with PINPOINT_AUTH_DEV_FALLBACK=true for the walkthrough.',
      { cause: err },
    );
  }
  return true;
});
if (!healthy) process.exit(r.summary());

const seeded = await r.step(
  'Seed: client, partitions, zones layer + features, property set, matching config',
  () => seed(api, r, runTag),
);
if (!seeded) process.exit(r.summary());

if (values['seed-only']) {
  process.stdout.write(
    `\nSeeded client ${seeded.clientCode} (${seeded.clientId}) — open the SPA and select it.`,
  );
  process.exit(r.summary());
}

const state = await runFlows(api, r, seeded, {
  baseUrl,
  signingSecret: process.env['FLOWCATALYST_SIGNING_SECRET'] || undefined,
});

if (!values['no-db']) {
  await r.step('Observe: domain events in outbox_messages', () =>
    observeOutbox(
      r,
      process.env['DATABASE_URL'] ??
        'postgresql://postgres:postgres@localhost:15432/pinpoint?sslmode=disable',
      startedAt,
    ),
  );
}

if (values.cleanup) await cleanup(api, r, seeded, state);
else
  process.stdout.write(
    `\nData kept: client ${seeded.clientCode} (${seeded.clientId}) — explore it in the SPA, or re-run with --cleanup.`,
  );

process.exit(r.summary());
