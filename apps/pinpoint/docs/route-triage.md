# Pinpoint route triage

Snapshot of the Rust pinpoint's HTTP surface and the status of each
route's TS port. Maintained as the source of truth for Slice 10 (path-
scope rewrite + BFF surface) and Slice 11 (Vue lift).

The Rust mount tree (from `pinpoint-server/src/main.rs`):

```
/                        → routes::api_router
/bff                     → routes::bff::bff_router
```

Both trees nest under `/clients/{client_id}` where appropriate.

---

## Non-BFF surface (`/`) — production / CLI API

| Rust file                                                | TS status | Notes |
|---|---|---|
| `routes/health.rs`                                       | **ported** as `GET /health` | unchanged |
| `routes/auth_routes.rs`                                  | **partial** — `GET /me` ported (Slice 1); the OIDC `/auth/login` + `/auth/callback` + PKCE flow is deferred until cutover (Slice 12) |
| `routes/client_routes.rs`                                | **ported** | `POST /clients`, `GET /clients/:clientId`. Slice 10b adds `PUT` + `DELETE` + list |
| `routes/partition_routes.rs`                             | **ported** | `POST /clients/:cid/partitions`, `GET /clients/:cid/partitions/:pid`. Slice 10b adds list / `PUT` / `DELETE` |
| `routes/location_routes.rs`                              | **ported** | `POST /clients/:cid/locations`, `GET /clients/:cid/locations/:lid`, `GET /clients/:cid/locations` paged. Slice 10b adds list-filtering + location-attribute CRUD |
| `routes/master_location_routes.rs`                       | **ported** | `GET /clients/:cid/master-locations/:mlid`, list, `POST .../validate`, `POST .../confirm` (Slice 9) |
| `routes/layer_routes.rs`                                 | **ported** | `POST /clients/:cid/layers`, `GET /clients/:cid/layers/:lid`, list. Slice 10b adds `PUT` + `DELETE` + nested feature CRUD already lives under `/clients/:cid/layers/:lid/features` from Slice 4 |
| `routes/matching_config_routes.rs`                       | **ported** | `GET /clients/:cid/matching-config?partitionId=…`, `PUT` (Slice 5) |
| `routes/spatial_lookup_routes.rs`                        | **ported** | `POST /clients/:cid/spatial-lookup` (Slice 5) |
| `routes/geocode_routes.rs`                               | **ported** | `POST /geocode/forward`, `POST /geocode/reverse` (Slice 6). Kept flat — no client scope; geocoder is shared |
| `routes/unvalidated_routes.rs`                           | **deferred to Slice 10b** | `GET /master-locations/unvalidated` listing-with-filters endpoint. The TS side has `MasterLocationRepository.listByStatus` (Slice 9); 10b adds the route + the filtered-by-client-ids / partition-codes variant |
| `routes/fragment_routes.rs`                              | **WILL NOT PORT** | askama HTML server-rendered fragments. The Vue SPA in Slice 11 owns the UI; nothing in the SPA's API client calls fragment endpoints. Tracked here so future agents don't try to "complete" it |

Pinpoint TS additions not present in Rust:

- `POST /verify-match` (Slice 7) — LLM verifier debug route, no Rust analogue
- `POST /jobs/validate-master-locations` (Slice 9) — FlowCatalyst-scheduled job webhook (HMAC-verified)

---

## BFF surface (`/bff`) — Vue SPA UI

| Rust file                                                       | TS status | LoC | Notes |
|---|---|---|---|
| `routes/bff/clients.rs`                                         | **deferred to Slice 10c** | 87 | UI-shaped client list + detail; mostly re-export of existing fields with `{items, total}` framing |
| `routes/bff/countries.rs`                                       | **deferred to Slice 10c** | 41 | UI dropdown source; SPA expects `/bff/countries` → flat array |
| `routes/bff/dashboard.rs`                                       | **deferred to Slice 10c** | 32 | `GET /bff/dashboard/stats` — aggregate counts for the home screen |
| `routes/bff/partitions.rs`                                      | **deferred to Slice 10c** | 192 | CRUD under `/bff/clients/:cid/partitions`. Requires the partition `PUT` + `DELETE` use cases from Slice 10b |
| `routes/bff/principal_partitions.rs`                            | **deferred to Slice 10c** | 119 | `/bff/clients/:cid/partitions/:pid/principals` — assign / revoke principal access. Backed by `principal_partitions` (Slice 2 schema-only) |
| `routes/bff/locations.rs`                                       | **deferred to Slice 10c** | 227 | UI-shaped list with filter chips + master joins |
| `routes/bff/master_locations.rs`                                | **deferred to Slice 10c** | 790 | The biggest one. List + detail + edit (status / normalized fields) + manual confirm. Needs Slice 10b's master-location update use case |
| `routes/bff/layers.rs`                                          | **deferred to Slice 10c** | 496 | Layer CRUD + property-set CRUD + nested feature listing |
| `routes/bff/layer_features.rs`                                  | **deferred to Slice 10c** | 316 | Feature CRUD under a specific layer. The non-BFF feature CRUD ports Slice 4 already; BFF wraps with UI shape |
| `routes/bff/matching_config.rs`                                 | **deferred to Slice 10c** | 127 | `GET` + `PUT` thresholds with `{items: [...]}` for client + per-partition rows |
| `routes/bff/spatial_lookup.rs`                                  | **deferred to Slice 10c** | 103 | UI variant of `POST /spatial-lookup`. Possibly a no-op (same shape, mounted under `/bff/...`) |

Total BFF surface: ~2530 LoC Rust to triage in Slice 10c.

---

## Slice 10b — missing CRUD operations

Operations the existing TS port doesn't have but the BFF surface needs:

| Operation                          | Aggregate          | Notes |
|---|---|---|
| `update-client`                    | Client             | rename + status |
| `delete-client`                    | Client             | cascade considerations: partitions, locations, layers all FK to client |
| `update-partition`                 | Partition          | rename + description |
| `delete-partition`                 | Partition          | cascade: locations.partition_id is nullable, layer_partitions cascades |
| `update-layer`                     | Layer              | rename + description + status |
| `delete-layer`                     | Layer              | cascade: features, property_sets, layer_partitions cascade |
| `update-master-location`           | MasterLocation     | manual edit of normalized fields (BFF "edit master" form) |
| `reject-master-location`           | MasterLocation     | transition `* → REJECTED` for non-canonical masters |
| `create-property-set`              | PropertySet (new aggregate) | first non-schema-only use case for PropertySet (Slice 4 deferred this) |
| `update-property-set`              | PropertySet        | |
| `delete-property-set`              | PropertySet        | cascade: properties cascade |
| `replace-property-set-properties`  | PropertySet        | bulk PUT of all properties on a set; matches Rust BFF's single `replace_properties` op (cap 6). No per-Property aggregate — properties are child entities managed inline. |
| `assign-principal-to-partition`    | PrincipalPartition (new aggregate) | grants UI partition access |
| `revoke-principal-from-partition`  | PrincipalPartition | |
| `update-location-attribute`        | LocationAttribute (new aggregate) | first non-schema-only use case for LocationAttribute (Slice 3 deferred) |
| `delete-location-attribute`        | LocationAttribute  | |

That's ~18 use cases. Each is ~150–250 LoC including tests; Slice 10b will probably split into 2-3 commits by aggregate group.

---

## Slice 10c — BFF surface mount

Once 10b lands, 10c mounts the BFF tree under `/bff` and delegates each
endpoint to the corresponding use case (writes) / repository (reads).
Response framing is `{items, total}` for lists; flat objects for details.

Open questions for 10c:

- **BFF auth**: Rust uses session cookies (`BffAuth` middleware). TS port still has the `x-user-id` dev fallback. Real OIDC is deferred until Slice 12. For 10c, the BFF surface accepts the same `x-user-id` dev fallback the rest of the API uses. Hardening before production cutover.
- **Permission checks**: Rust `BffAuth` calls `auth_info.require_permission(...)` per route. TS has `PinpointPermission.*` constants but no enforcement — the `authorize()` private method always returns true. 10c surfaces this; tightening happens with real auth in Slice 12.
- **principal_partitions**: the `principal_partitions` table has been live since Slice 2 (schema-only) and Slice 1's `/me` route reads it for the principal's memberships. 10c is where the CRUD around it lands.

---

## fragment_routes — NOT porting

`routes/fragment_routes.rs` returns askama HTML templates for server-
rendered fragments. The Vue SPA in Slice 11 owns all UI rendering;
nothing in `pinpoint-web/src/` calls fragment endpoints (verified via
grep of the `apiFetch` call sites — they all hit `/bff/...`).

If a future need surfaces (rare — embedded iframes, email-template
previews, etc.), we can revisit.
