/**
 * Export the OpenAPI spec that `@fastify/swagger` derives from the TypeBox
 * route schemas to `apps/pinpoint/openapi.gen.json` (no DB / IdP needed).
 *
 *   pnpm openapi:export          # (re)write the file
 *   pnpm openapi:check           # exit 1 if the file is stale vs the routes
 *
 * The file is the language-neutral API contract: feed it to
 * openapi-typescript for the Vue SPA, or to any other client generator.
 * `*.gen.*` is ignored by the formatter — never hand-edit it.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Force an offline-safe boot BEFORE importing the server module — it reads
// env at module scope, and `createAppContext` would otherwise hit OIDC
// discovery / Redis. postgres-js connects lazily, so no DB is touched.
process.env['OIDC_ISSUER_URL'] = '';
process.env['PINPOINT_SESSION_DRIVER'] = 'memory';
process.env['PINPOINT_LLM_PROVIDER'] = 'none';
process.env['PINPOINT_DB_AUTO_MIGRATE'] = 'false';
process.env['LOG_LEVEL'] = 'silent';
delete process.env['PINPOINT_WEB_DIST_DIR'];

const here = dirname(fileURLToPath(import.meta.url));
const OUT_FILE = resolve(here, '../../openapi.gen.json');
const check = process.argv.includes('--check');

const { buildServer } = await import('../src/server.js');
const server = await buildServer();
try {
  await server.ready();
  const spec = server.swagger();
  const next = `${JSON.stringify(spec, null, 2)}\n`;

  if (check) {
    let current = '';
    try {
      current = readFileSync(OUT_FILE, 'utf8');
    } catch {
      /* missing → stale */
    }
    if (current !== next) {
      console.error(`openapi.gen.json is out of date — run \`pnpm openapi:export\` and commit it.`);
      process.exitCode = 1;
    } else {
      console.log('openapi.gen.json is up to date.');
    }
  } else {
    writeFileSync(OUT_FILE, next);
    const paths = Object.keys(spec.paths ?? {}).length;
    const ops = Object.values(spec.paths ?? {}).reduce((n, p) => n + Object.keys(p ?? {}).length, 0);
    console.log(`wrote ${OUT_FILE} (${paths} paths, ${ops} operations)`);
  }
} finally {
  await server.close();
}
