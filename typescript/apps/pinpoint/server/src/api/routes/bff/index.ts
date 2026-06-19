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
 *   - 10c.1 — dashboard, countries, clients (done)
 *   - 10c.2 — partitions, principal-partitions (done)
 *   - 10c.3 — locations, spatial-lookup (done; the
 *             /master-locations/unvalidated route is registered alongside
 *             the master-location routes, not here, because it's a
 *             cross-client surface that lives outside the BFF tree)
 *   - 10c.4 — layers, layer-features (done)
 *   - 10c.5 — master-locations (list/detail/update/validate/geocode/
 *             reverse-geocode/processing-log), matching-config (this
 *             commit). Three operator-tool routes (confirm-geocode,
 *             per-master match-features, bulk match-features) deferred
 *             to a hygiene follow-up — see master-locations/index.ts
 *             for rationale.
 */
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../../../app-context.js';
import { registerBffDashboardRoute } from './dashboard.route.js';
import { registerBffCountriesRoute } from './countries.route.js';
import { registerBffClientRoutes } from './clients/index.js';
import { registerBffPartitionRoutes } from './partitions/index.js';
import { registerBffPrincipalPartitionRoutes } from './principal-partitions/index.js';
import { registerBffLocationRoutes } from './locations/index.js';
import { registerBffSpatialLookupRoutes } from './spatial-lookup/index.js';
import { registerBffLayerRoutes } from './layers/index.js';
import { registerBffLayerFeatureRoutes } from './layer-features/index.js';
import { registerBffMasterLocationRoutes } from './master-locations/index.js';
import { registerBffMatchingConfigRoutes } from './matching-config/index.js';

export function registerBffRoutes(fastify: FastifyInstance, appContext: AppContext): void {
  registerBffDashboardRoute(fastify, appContext);
  registerBffCountriesRoute(fastify, appContext);
  registerBffClientRoutes(fastify, appContext);
  registerBffPartitionRoutes(fastify, appContext);
  registerBffPrincipalPartitionRoutes(fastify, appContext);
  registerBffLocationRoutes(fastify, appContext);
  registerBffSpatialLookupRoutes(fastify, appContext);
  registerBffLayerRoutes(fastify, appContext);
  registerBffLayerFeatureRoutes(fastify, appContext);
  registerBffMasterLocationRoutes(fastify, appContext);
  registerBffMatchingConfigRoutes(fastify, appContext);
}
