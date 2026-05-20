# Pinpoint Port — Handoff

**Read this first if you're picking up the pinpoint port in a new session.**

## Status (2026-05-20)

- **HEAD:** Slice 7 (LLM address verifier — Vercel AI SDK + Bedrock + Ollama + Noop) — this commit
- **Slices done:** 0, 1, 2, 3, 4, 5, 6, 7 + PRE-0a + PRE-0b
- **Slices remaining:** 8 → 12 (~42% of the work)
- **Workspaces:** 12, all `pnpm -r typecheck` clean
- **Smoke:** `POST /verify-match` against local Ollama+gemma4 returned sensible verdicts on three test pairs (same place / different house numbers / different cities); 40 tests passing (`pnpm -F @pinpoint/server test`)
- **Drizzle migrations:** **TWO** now generated under `apps/pinpoint/server/drizzle/`:
  - `20260520171747_futuristic_zaladane` — schema (all Slice 0-5 tables, audit_logs from app-framework, geometry columns + GIST indexes)
  - `20260520171804_seed_globals` — `mcf_GLOBAL_DEFAULT` matching config + ~177-country geometry seed (verbatim port of Rust migration 016, with `ON CONFLICT (id) DO NOTHING` for re-runs)
- **Local dev DB:** `pnpm db:up && pnpm db:init && pnpm db:migrate` brings up a fresh PostGIS-enabled DB on port 5433 (see `apps/pinpoint/compose.yaml`)

## Decision factors (kept here for next re-check, Slice 6+)

The Slice 4 → Slice 5 → Slice 7 decision points all passed on 2026-05-20; Andrew opted to continue. Slice 7 was the named "AI SDK vs rig-core" re-check — Vercel AI SDK's `generateObject` + Ollama's native JSON-schema `format` field both produced clean structured output on gemma4 with the Rust-ported prompts, so no rig-core regression observed.

Re-evaluate again only if either of these change:
- AI ecosystem gap — Slice 7 brings the Vercel AI SDK in; if `ai`@v6 + Bedrock turns out to be meaningfully worse than the Rust `rig-core` path on the actual prompts, that would be a strong "go back" signal.
- Supply chain pain — Effect 4 is still beta-pinned. If a major Effect 4 rename lands before Slice 7 finishes, it's worth re-asking.

The original decision factors stay relevant context:
- Supply chain: Rust is meaningfully stronger (fewer deps, less npm churn, no beta lock-in)
- Safety: Rust is stronger overall; Effect closes some gaps via `Sealed<E>`
- Effect's specific wins for visibility: errors stay in the type signature, no `anyhow`-style flattening, automatic span tracing, structured concurrency — these matter for ops-heavy logistics
- AI ecosystem: rig-core is genuinely good for focused use; Vercel AI SDK only wins meaningfully for broad/agentic AI
- Hiring + frontend type sharing are the strongest *positive* reasons for TS

## What's shipped

| Slice | Commit | Scope |
|---|---|---|
| baseline | `d455e48` | Initial state of flowcatalyst-apps |
| PRE-0a | `6f2349c` + `c46b00e` (fixup) | Extract Scope/Jobs/Logging into `@flowcatalyst-apps/app-framework` |
| PRE-0b | `5357bdf` | Extract UoW infra (DrizzleOutboxDriver, TransactionStore, AggregateRegistry, commitAggregate, audit_logs schema) into `@flowcatalyst-apps/app-framework` |
| 0 | `a588006` | Pinpoint scaffold: `apps/pinpoint/{shared,framework,server,docs}` + Fastify + Drizzle + `/health` + OpenAPI |
| 1 | `138204d` | Reference + auth: Principal aggregate (no PartitionMembership FK yet), Country read-model, `GET /me`, `GET /countries` |
| 2 | `a7e34dd` | Tenancy spine: Client + Partition aggregates + UoW path, `principal_partitions` table joined in, `POST/GET /clients` and `/partitions` |
| 3 | `2d30bfc` | Locations core: `Location` aggregate (full schema, minimal create), `POST /locations`, `GET /locations/:id`, paged `GET /locations?clientId=…` |
| 4 | `13cc964` | Layers + layer-features: `Layer` + `LayerFeature` aggregates, first `commitDelete` user, `POST /layers` + `POST/PUT/DELETE/GET /layer-features`, paged reads. `property_sets`/`properties`/`layer_partitions`/`location_layer_associations` ship as schema-only |
| 5 | `dac0b43` | PostGIS canary: `MatchingConfig` aggregate + repo + `update-matching-config` use case, `GET/PUT /matching-config`, `POST /spatial-lookup`. Geometry `customType` (with `codec: 'text'` opt-out), GIST indexes on layers/layer_features/countries, country geometry seed (~177 rows). First two Drizzle migrations generated + applied. `docs/spatial-queries.md` captures the pattern |
| 6 | `5323e76` | External services: Photon `GeocoderService` + Effect 4 `RateLimiter`-backed decorator, `POST /geocode/forward` + `POST /geocode/reverse`, `NormalizedAddress` data type, 25 tests (first in the codebase) covering Photon parsing/error paths/User-Agent/query string + rate-limiter wall-clock behavior + trigram-key stability |
| 7 | (this commit) | LLM `AddressVerifier`: Bedrock (Vercel AI SDK `generateObject`) + Ollama (native `/api/chat` with JSON-schema `format`) + Noop. `POST /verify-match` debug route. Env-driven provider selection (`PINPOINT_LLM_PROVIDER` / `_MODEL` / `_OLLAMA_URL`). 15 new tests; smoke against local Ollama+gemma4 green |

Chores: `3e5726f`, `a1bcb38` (tsbuildinfo + .gitignore cleanup).

## What's deferred (and where it lands)

Tracked across slices so far. The next agent must NOT forget these:

- ~~**`countries.geometry` column + PostGIS extension + ~390KB seed**~~ → **Slice 5 — landed**
- ~~**`layers.boundary` + `layer_features.boundary` GEOMETRY columns + GIST indexes**~~ → **Slice 5 — landed**
- ~~**`location_feature_associations` table + `distance_meters`**~~ → **Slice 5 — landed (table empty; population by the matching pipeline still pending — see below)**
- ~~**pg_trgm fuzzy matching (CREATE EXTENSION)**~~ → **Slice 5 — `pg_trgm` extension installed via `pnpm db:init`. Trgm indexes on `master_locations` still deferred to Slice 8 (table doesn't exist yet)**
- **`master_locations` table** → Slice 8. `locations.master_location_id` is a nullable text column today with NO FK reference. Slice 8 adds both the table AND the FK in one migration.
- **`processing_log` table** → Slice 8
- **PropertySet + Property aggregate scaffolding** → later slice (no Rust use case exists for direct property-set management; tables ported as schema-only in Slice 4, mirroring how `location_attributes` was treated in Slice 3). `pst` prefix reserved but unregistered.
- **`location_layer_associations` population** → still pending. Table exists; population is what the matching pipeline does (next: when `create-location` grows the spatial-lookup step in Slice 5b or as part of the geocoder slice).
- **`layer_partitions` population** → later slice. Table ports in Slice 4; no `assign-layer-to-partition` use case yet.
- **Address normalization (libpostal in Rust)** → Slice 8. The Rust `LibPostalNormalizer` talks HTTP to a `pelias/libpostal-service` sidecar — NOT an LLM service, contrary to what the migration plan implied. Three paths: (a) docker-compose in the pelias/libpostal-service sidecar (matches Rust verbatim, ~3GB container), (b) hosted normalization API, (c) accept reduced normalization quality.
- **`AddressMatcher`** → Slice 8. The Rust `AddressMatcher` is NOT LLM-based either — it's a pure Jaro-Winkler + substitution-dictionary algorithm with thresholds from `MatchingConfig`. Belongs with the master-locations slice where it's actually called.
- ~~**LLM verifier (Rust `rig-core` → TS Vercel AI SDK)**~~ → **Slice 7 — landed.** `AddressVerifier` interface + Bedrock/Ollama/Noop impls. Default Noop keeps the matching pipeline cred-free.
- **Layer feature spatial lookup inside `create-location`** → next: the `POST /spatial-lookup` route + `LayerFeatureRepository.spatialLookup` exist, but `create-location.use-case.ts` doesn't call it. Wire it in as part of the matching slice (Slice 8).
- **`LocationValidated` event emission** → Slice 8 (when master_locations + validation transitions land)
- **Full Rust `create_location.rs` pipeline (~600 lines: normalize → hash + fuzzy → LLM verify → master association → log)** → consolidates in Slice 8. Slice 7 provided the LLM verifier; Slice 8 chains everything together.
- **OIDC auth** → out of scope until cutover. `extractRequestToken` in `server.ts` has the `x-user-id` dev fallback marked TODO.

## What the next agent needs to read

In order:
1. `apps/fulfil/CLAUDE.md` — **canonical pattern reference** for the entire monorepo (UoW + Sealed + Scope + processes + Effect 4 beta renames). All apps follow this.
2. `apps/pinpoint/docs/MIGRATION_PLAN.md` — pinpoint-specific design + slice ordering
3. This file
4. `MEMORY.md` — auto-loaded; gives broader context

## Slice 8 spec (if continuing)

**Master locations + the full matching pipeline.** This is the big one — it consolidates everything slices 3-7 set up.

- `MasterLocation` aggregate + Drizzle table. The `locations.master_location_id` column has been waiting for this FK since Slice 3; Slice 8 adds the table AND the FK in one migration.
- `master_locations.point GEOMETRY(Point, 4326)` + GIST index. Backfill migration from Rust 011 (`UPDATE master_locations SET point = ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)`) is documented in `docs/spatial-queries.md`.
- `processing_log` table — port verbatim from Rust 014.
- Trgm GIN index on `master_locations.normalized_address_line` (the trgm extension was enabled in Slice 5 via `pnpm db:init`).
- `AddressMatcher` — port the pure Jaro-Winkler + substitution-dictionary algorithm from Rust `address_matcher.rs`. Pure module, no service tag. The 80-entry SUBSTITUTIONS table ships verbatim (Afrikaans → English street types, ZA city aliases, country variants).
- `AddressNormalizer` — port the `LibPostalNormalizer` (HTTP client for `pelias/libpostal-service`). Decision still open on whether to add the sidecar to `compose.yaml` (matches Rust verbatim, ~3GB container) or use a hosted normalization API. The orphan `pinpoint-libpostal-1` container we saw earlier is from a prior pelias setup — same image, recyclable.
- Use cases: `confirm-master-location`, `validate-master-location` (calls the `AddressVerifier` from Slice 7), and the chained `create_location` pipeline (normalize → hash + fuzzy → LLM verify → master association → log).
- Events: `master-location-{confirmed,validated}`, `LocationValidated`.
- Routes: `POST /master-locations/confirm`, `POST /master-locations/validate`.
- Wire `POST /spatial-lookup` into `create-location` so a new location auto-populates `location_feature_associations` from the resolved coordinate.
- Deliverable: end-to-end matching pipeline runnable.

This is the slice where Slice 3's "~85% of the Rust create_location.rs pipeline deferred" finally lands. Expect it to be bigger than slices 4-7 individually.

## Gotchas

**SDK is git-tag tracked, not path-linked.** As of 2026-05-20, all five workspaces that consume `@flowcatalyst/sdk` use `github:flowcatalyst/typescript-sdk#semver:>=0.6.7`. The git tag list is the resolution source (pnpm strips a leading `v` and matches against the spec); the package.json `version` field on the tag is stale and unreliable (v0.6.7 still claims 0.3.2). The previous `file:../../../flowcatalyst-rust/clients/typescript-sdk` path link was retired because it went stale silently between SDK rebuilds and required `rm -rf node_modules && pnpm install` to refresh (`pnpm install --force` lies and says "Already up to date").

**Standing rule: run `pnpm update @flowcatalyst/sdk -r` at the start of every new task** before doing anything else. The semver range floats but pnpm only re-resolves on explicit update. The dev SDK ships out-of-band, often weekly. If the update bumps the locked commit, run `pnpm -r --if-present typecheck` immediately so any SDK-induced breakage is attributed to the bump and not to whatever task you're about to start.

**Effect 4 is beta.** Pinned at `4.0.0-beta.67`. Don't bump without checking the renames documented in `apps/fulfil/CLAUDE.md` (Either→Result, Context.Tag→Context.Service, etc.).

**`as never` cast on Scope in event constructors.** This is intentional — the SDK's `BaseDomainEvent` expects a structurally-narrower `ExecutionContext`, and pinpoint's `Scope` is a structural superset. The cast satisfies the brand. Don't try to "fix" it without understanding the seal pattern.

**Route response schemas need all status codes.** Fastify + TypeBox typechecks reply codes against the schema's declared `response` keys. Every error status the handler can emit (400/401/403/404/409/500) must be declared in the route's `response: {…}` schema. See the tenancy/locations routes for the standard `ErrorResponseSchema`.

**`*.tsbuildinfo` is gitignored** as of `a1bcb38`. If you see it appearing as untracked, that's the typecheck cache; ignore it.

**PostGIS geometry needs `codec: 'text'` on the customType.** Drizzle 1.0 RC's built-in `geometry` codec matches by SQL type prefix and routes any `geometry(*)` column through `parseEWKB`, which only handles POINT and throws "Unsupported geometry type" on POLYGON / MULTIPOLYGON. The customType in `infrastructure/schema/types/geometry.ts` passes `codec: 'text'` to opt out. If anyone ever "cleans up" that line, every read against a layer / layer_feature / country with a real geometry blows up — including from repos that never touch the boundary column directly. See `docs/spatial-queries.md`.

**Drizzle-kit `--custom` is how seeds land.** Migration journals don't include hand-dropped `.sql` files. To add a seed, run `pnpm exec drizzle-kit generate --custom --name <slug>` — it scaffolds the file AND updates `meta/_journal.json` so `drizzle-kit migrate` picks it up. The countries seed (`20260520171804_seed_globals`) is the precedent.

**Vitest 4 removed `it(name, fn, options)`.** Use `it(name, options, fn)` — the options object goes before the function. Vitest 4.1+ throws "Signature ... was deprecated in Vitest 3 and removed in Vitest 4" if you get the order wrong. Pattern set in `rate-limited-geocoder.test.ts` (Slice 6).

**Ollama provider deliberately bypassed.** The canonical `ollama-ai-provider-v2` peers on `zod ^4` while the rest of the workspace is on `zod ^3`. Slice 7's `ollama-verifier.ts` hits Ollama's `/api/chat` directly via global `fetch` and uses the native `format` field (a JSON Schema object) for structured output — same end result, one less dep. If the workspace ever moves to zod 4, the Ollama provider can replace the hand-written client.

**LLM verifier swallows errors and returns null.** A provider failure (timeout, schema mismatch, model misbehavior) returns `null` — the matching pipeline treats this as "no verification opinion" and falls back to the algorithmic verdict. Routes surface `null` as 204 No Content. Don't add throwing fallback paths without thinking through the failure semantics for the matching pipeline.

**Slice 7 corrected the LLM scope.** The original spec named three LLM services (`AddressNormalizer`, `AddressMatcher`, `AddressVerifier`); only `AddressVerifier` is actually LLM-based in Rust. The other two land with Slice 8: `AddressMatcher` is pure Jaro-Winkler + substitution dictionary, `AddressNormalizer` is the libpostal HTTP sidecar (Pelias). See updated Slice 8 spec.

**The rate-limited geocoder test does wall-clock timing.** It fires 8 calls at 4 rps and asserts `elapsed >= 750ms`. Token-bucket refill timing varies a bit; if this turns out flaky in CI, widen the lower bound or split into "no-delay first burst" + "delay after burst" pairs against a tighter clock. Don't replace with fake timers — Effect 4's `RateLimiter` doesn't respect vitest's `vi.useFakeTimers`.

## Smoke commands

```bash
# typecheck everything
pnpm -r --if-present typecheck

# bring up the dev DB + apply migrations (idempotent — re-run anytime)
cd apps/pinpoint/server
pnpm db:up && pnpm db:init && pnpm db:migrate

# boot the server (DB now required for live routes)
PORT=3199 pnpm tsx src/server.ts

# verify (auth fallback: `x-user-id: alice`)
curl http://localhost:3199/health
curl http://localhost:3199/docs/json | jq '.paths | keys'

# matching-config cascade — falls back to mcf_GLOBAL_DEFAULT then promotes a scoped row on PUT
curl -s -H 'x-user-id: alice' \
  "http://localhost:3199/matching-config?clientId=cli_NONEXISTENT" | jq

# spatial-lookup at -26.108, 28.057 (must have a layer + feature with backfilled boundary)
curl -s -X POST -H 'content-type: application/json' -H 'x-user-id: alice' \
  -d '{"clientId":"<CLI>","latitude":-26.108,"longitude":28.057}' \
  http://localhost:3199/spatial-lookup | jq

# forward + reverse geocode (Photon-backed, rate-limited by default to 5 rps)
curl -s -X POST -H 'content-type: application/json' -H 'x-user-id: alice' \
  -d '{"houseNumber":"548","road":"Market Street","city":"San Francisco","state":"CA","postalCode":"94104","country":"USA"}' \
  http://localhost:3199/geocode/forward | jq

curl -s -X POST -H 'content-type: application/json' -H 'x-user-id: alice' \
  -d '{"latitude":37.7899932,"longitude":-122.4008494}' \
  http://localhost:3199/geocode/reverse | jq

# vitest suite (Slice 6 added the first tests in the codebase; Slice 7 brings the count to 40)
pnpm -F @pinpoint/server test

# verify-match (Slice 7): defaults to Noop → 204 No Content
curl -s -X POST -H 'content-type: application/json' -H 'x-user-id: alice' \
  -d '{"inputAddress":"548 Market St, SF","candidateAddress":"548 Market Street, San Francisco"}' \
  -w '\nstatus=%{http_code}\n' http://localhost:3199/verify-match

# verify-match against local Ollama: boot the server with the provider env vars
PINPOINT_LLM_PROVIDER=ollama PINPOINT_LLM_MODEL=gemma4 PORT=3199 pnpm tsx src/server.ts
# then re-run the curl above → 200 with {matchConfirmed, confidence, reasoning}
```
