# Rust ↔ TS Schema Parity Report

**Date:** 2026-05-25
**TS HEAD:** `2ac69e3`
**Rust source:** `~/Developer/tangent/pinpoint`

This report is the migration-plan cutover gate from `MIGRATION_PLAN.md`'s
"Migration parity check: diff Rust schema vs Drizzle schema". Run as a
read-only audit by an Explore agent. Findings are below; no remediation
required.

## Summary

- **Parity:** 17 of 18 tables
- **Intentional drift:** 1 (`audit_logs`, present only in TS — platform-level addition, not a pinpoint domain table)
- **Rust-only tables:** 0
- **Net pre-cutover action:** none

## Per-table findings

All findings below are "✓ parity" unless flagged.

| Table                           | Status    | Notes                                                                                                                                                                                                                                       |
| ------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `clients`                       | ✓ parity  | Unique on `code` both sides                                                                                                                                                                                                                 |
| `partitions`                    | ✓ parity  | Unique on `(client_id, code)` both sides                                                                                                                                                                                                    |
| `principals`                    | ✓ parity  | `principal_type varchar(20)` both sides                                                                                                                                                                                                     |
| `principal_partitions`          | ✓ parity  | PK + FKs + indexes match; `granted_by` ref both sides                                                                                                                                                                                       |
| `locations`                     | ✓ parity  | All columns + indexes match; `master_location_id` FK is RESTRICT both sides                                                                                                                                                                 |
| `layers`                        | ✓ parity  | Includes `code` (Rust migration 010); GIST on `boundary` both sides; unique on `(client_id, code)`                                                                                                                                          |
| `layer_features`                | ✓ parity  | `property_values` JSONB default `{}`; GIST on `boundary`; FK `layer_id ON DELETE CASCADE` both sides                                                                                                                                        |
| `layer_partitions`              | ✓ parity  | PK `(layer_id, partition_id)` + both FKs `ON DELETE CASCADE`                                                                                                                                                                                |
| `location_layer_associations`   | ✓ parity  | PK + cascade FKs match                                                                                                                                                                                                                      |
| `location_feature_associations` | ✓ parity  | PK + 3 cascade FKs + `distance_meters` (Rust migration 013)                                                                                                                                                                                 |
| `property_sets`                 | ✓ parity  | Unique on `(layer_id, name)`; cascade on `layer_id`                                                                                                                                                                                         |
| `properties`                    | ✓ parity  | Unique on `(property_set_id, key)`; cascade                                                                                                                                                                                                 |
| `location_attributes`           | ✓ parity  | `value` JSONB; unique on `(location_id, key)`; cascade                                                                                                                                                                                      |
| `master_locations`              | ✓ parity  | All address components + `address_hash` + `normalized_address_line` (Rust 012) + GIST on `point` + trigram GIST on `normalized_address_line`                                                                                                |
| `processing_log`                | ✓ parity  | Indexes on `master_location_id` + `(master_location_id, step)`; cascade FK                                                                                                                                                                  |
| `matching_configs`              | ✓ parity  | All thresholds with identical defaults; UNIQUE NULLS NOT DISTINCT on `(client_id, partition_id)`                                                                                                                                            |
| `countries`                     | ✓ parity  | `id SERIAL`; unique partial indexes on `iso_a2`/`iso_a3` WHERE != '-99'; GIST on `geometry`                                                                                                                                                 |
| `audit_logs`                    | ⚠ TS only | **Intentional.** Platform-level audit table from `@flowcatalyst-apps/app-framework`. Not part of the pinpoint domain. Rust pinpoint has no equivalent and doesn't need one — `outbox_messages` audit-log type covers the cross-system path. |

## Type-mapping notes

- **Geometry columns** (`boundary` on layers / layer_features, `point` on master_locations, `geometry` on countries) use a `customType` with `codec: 'text'` on the TS side (deliberately — see `docs/spatial-queries.md`); Rust uses the native PostGIS type directly. The SQL column type is `geometry(Geometry, 4326)` / `geometry(Point, 4326)` on both sides. No drift.
- **JSONB** (`property_values`, `location_attributes.value`, `processing_log.data`) matches both sides.
- **`double precision`** (Rust) ↔ **`doublePrecision()`** (Drizzle). No drift.
- **Status / principal_type columns** are `varchar(20)` on both sides without DB-level CHECK or enum types. Validation lives in app code. Deliberate match.

## FK cascade behavior

All FK relationships were spot-checked:

- Child-of-aggregate FKs (`layer_features.layer_id`, `properties.property_set_id`, `location_attributes.location_id`, `processing_log.master_location_id`, both ends of `layer_partitions` / `location_layer_associations` / `location_feature_associations`) use `ON DELETE CASCADE` both sides.
- Aggregate-to-aggregate FKs (`locations.client_id`, `layers.client_id`, `master_locations.client_id` / `partition_id`) default to `RESTRICT` both sides.

No drift detected.

## Index parity

All business-critical indexes present on both sides with matching names:

- spatial GIST (`idx_layer_features_boundary`, `idx_master_locations_point`, etc.)
- trigram GIST (`idx_master_locations_address_trgm` with `WHERE` clause)
- partial unique indexes (`idx_locations_external_id` filtered on non-null)
- composite uniques (`(client_id, code)` on partitions / layers)
- foreign-key indexes for join performance

## Migrations applied

- **Rust:** 17 migrations (001 – 017) covering initial schema, clients/partitions, matching configs, spatial columns, trigram matching, processing audit, country data, layer partitions.
- **TS:** 3 Drizzle migrations applied at TS HEAD `2ac69e3`:
  - `20260520171747_futuristic_zaladane` — initial schema
  - `20260520171804_seed_globals` — countries seed + global-default matching config
  - `20260521051524_flashy_ricochet` — Slice 10c adjustments

The TS port collapses the Rust migration history into fewer Drizzle migrations because Drizzle generates a single diff against the current TypeScript schema rather than replaying historical column moves.

## Conclusion

**Pre-cutover gate: PASS.** Schema is fully ported with no critical drift. The single deliberate TS-side addition (`audit_logs`) is documented and out-of-scope for the Rust → TS comparison.
