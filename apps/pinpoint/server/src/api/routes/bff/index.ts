/**
 * BFF — backend-for-frontend mount tree.
 *
 * UI-shaped endpoints for the Vue SPA. Mirrors the Rust `/bff/...` tree
 * (see `pinpoint-server/src/routes/bff/mod.rs`). Reads delegate to
 * repositories, writes delegate to the same use cases the non-BFF
 * routes use. Response framing is `{items, total}` for lists, flat
 * objects for details, except where Rust BFF returns a bare array
 * (countries) — preserved for SPA contract compatibility.
 *
 * Auth: continues on the `x-user-id` dev fallback (same as the rest of
 * the API today). Real OIDC + cookie sessions land in Slice 12.
 *
 * Sub-slice order:
 *   - 10c.1 — dashboard, countries, clients (this commit)
 *   - 10c.2 — partitions, principal-partitions
 *   - 10c.3 — locations, spatial-lookup, /master-locations/unvalidated
 *   - 10c.4 — layers, layer-features
 *   - 10c.5 — master_locations, matching-config
 */
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../../../app-context.js';
import { registerBffDashboardRoute } from './dashboard.route.js';
import { registerBffCountriesRoute } from './countries.route.js';
import { registerBffClientRoutes } from './clients/index.js';

export function registerBffRoutes(fastify: FastifyInstance, appContext: AppContext): void {
  registerBffDashboardRoute(fastify, appContext);
  registerBffCountriesRoute(fastify, appContext);
  registerBffClientRoutes(fastify, appContext);
}
