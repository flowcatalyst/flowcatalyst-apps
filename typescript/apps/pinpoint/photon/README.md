# Self-hosted Photon — southern Africa index

Build pipeline + runtime for a self-hosted [Photon](https://github.com/komoot/photon)
geocoder, scoped to pinpoint's operating region. Replaces the free public
`photon.komoot.io` default (`PINPOINT_GEOCODING_API_URL`) once that endpoint's
fair-use limits become a constraint.

**Region (Geofabrik slugs):** `south-africa namibia botswana zimbabwe mozambique lesotho swaziland`

> You cannot merge Komoot's prebuilt per-country dumps — each is a complete,
> self-contained search index with no union tooling. Combining arbitrary
> countries means building one index from Nominatim, which is what this
> pipeline does. The output is a portable `photon_data` tarball; the runtime
> container just mounts it.

## Layout

| File                           | Role                                                                       |
| ------------------------------ | -------------------------------------------------------------------------- |
| `build-index.sh`               | One command: download → merge → Nominatim import → Photon import → tarball |
| `compose.photon-build.yaml`    | The throwaway build stack (prep + Nominatim + Photon importer)             |
| `prep.Dockerfile` + `merge.sh` | Downloads Geofabrik extracts, `osmium merge` into one PBF                  |
| `Dockerfile`                   | The Photon image — used for **both** the importer and the runtime server   |
| `compose.photon.yaml`          | Runtime: serves a prebuilt index on `:2322`                                |
| `.env.example`                 | Region + pinned versions + tunables                                        |

## Build the index

Run on a **build host**, not your runtime box — the Nominatim import is the
heavy step (budget ~16–32 GB RAM and 50–150 GB transient disk; the resulting
index is small). Only Docker (with compose v2) is required.

```bash
cd apps/pinpoint/photon
cp .env.example .env          # tune COUNTRIES / versions if needed
./build-index.sh
```

What it does, end to end:

1. **prep** — downloads the 7 Geofabrik extracts and `osmium merge`s them into
   `work/combined.osm.pbf` (dedupes objects shared across extracts, so the
   Lesotho/Swaziland overlap with neighbouring extracts is harmless).
2. **nominatim** — a throwaway `mediagis/nominatim` (bundles its own
   Postgres+PostGIS) imports the merged PBF. **Never touches pinpoint's DB.**
3. **photon-import** — connects to that Nominatim, builds the index into
   `data/photon_data`, exits.
4. **package** — tars it to `dist/photon-data-southern-africa-YYYYMMDD.tar.gz`.
5. **teardown** — `down -v` destroys the Nominatim DB. The tarball remains.

## Serve the index

```bash
mkdir -p photon-index
tar -C photon-index -xzf dist/photon-data-southern-africa-YYYYMMDD.tar.gz
docker compose -f compose.photon.yaml up -d --build
```

Then point pinpoint at it (no code change — same Photon HTTP API):

```bash
PINPOINT_GEOCODING_API_URL=http://photon:2322   # same compose network
# or http://<host>:2322 from a separate host
```

To fold Photon into the main prod stack, copy the `photon` service block from
`compose.photon.yaml` into `compose.prod.yaml` and set
`PINPOINT_GEOCODING_API_URL: http://photon:2322` on the `pinpoint` service.
With your own endpoint you can also raise/drop `PINPOINT_GEOCODING_RATE_LIMIT`
(the in-process token bucket exists mainly to be polite to the free instance).

## Version pinning — read before bumping

- **Photon ↔ Nominatim must agree on schema version.** Photon 0.6.x targets
  Nominatim 4.x; `mediagis/nominatim:4.4` is Nominatim 4.4. Bump them together.
- **Pin `PHOTON_VERSION`** to a real release from
  <https://github.com/komoot/photon/releases> (don't float — matches the repo's
  supply-chain discipline). `.env.example` defaults to a known release; verify
  before a fresh build.
- **`NOMINATIM_PGDATA` tracks the Nominatim image's PG major.** `4.4` → PG 14
  (`/var/lib/postgresql/14/main`). A newer tag may be PG 16 — update both.

## Migrating to OpenSearch Photon (1.x) — prepped, not yet executed

We currently run **classic Photon `0.6.2`**, which embeds **Elasticsearch 5.6.16**
(EOL, unmaintained). It's acceptable because the photon service is internal-only
(Cloud Map + a task SG that admits only pinpoint) and serves a static,
rebuildable index — but it's known tech-debt. Photon **≥ 1.0 dropped
Elasticsearch entirely**; OpenSearch is now the only backend (latest `1.2.0`).

Verified for the switch (2026-06-20):
- **Single jar `photon-1.2.0.jar`** — same download pattern, so it's a version bump.
- **Still embedded by default** ("photon starts a private instance of OpenSearch",
  `photon_data` dir) → the jar + EFS-index + awsvpc-service architecture is
  unchanged. No OpenSearch cluster to run.
- **Java 21+** — the `eclipse-temurin:21-jre` base already satisfies it.
- **Old CLI still works in 1.x** (removed in v2), so the existing
  `-nominatim-import` / `-data-dir` commands keep working; new subcommands are
  `import` / `serve` for a later cleanup.
- **Index format is incompatible** (ES → OpenSearch): the index MUST be rebuilt;
  the current ES 5.6 index won't load on 1.2.0.

Coordinated switch (image + index move together — do not flip one alone):
1. Bump `PHOTON_VERSION` to `1.2.0` in `.env`, `build-photon.yml`, and
   `build-photon-index.yml` (the Dockerfile arg default too if desired).
2. **Verify Nominatim compatibility** — Photon 1.2.0's required Nominatim
   version isn't documented; if `build-index.sh` fails on a schema error, bump
   `NOMINATIM_VERSION` (+ `NOMINATIM_PGDATA` to the new PG major) and retry.
3. Rebuild the index: run **Build Photon index (prod)** with `photon_version=1.2.0`.
4. Rebuild the image: run **build-photon** with `photon_version=1.2.0`.
5. Load the new index (**Load Photon index (prod)**) onto EFS.
6. `force-new-deployment` on the photon service.
7. (Later, before Photon v2) switch the Dockerfile/loader commands to the new
   `serve` / `import` subcommands.

## Refreshing

Geofabrik extracts update daily. For freshness, re-run `build-index.sh`
periodically (monthly/quarterly is plenty for address geocoding) and ship the
new tarball. Continuous updates (Nominatim replication + Photon update mode)
are possible but deliberately out of scope here — full rebuilds are far simpler
to reason about and these extracts don't churn fast.

## Notes / gotchas

- **`IMPORT_STYLE=address`** keeps the import lean — enough for address
  geocoding, far smaller/faster than `full` (which adds POIs). Switch to `full`
  only if you need POI search.
- **`swaziland` slug, not `eswatini`:** Geofabrik publishes the extract under the
  legacy name `swaziland`. Using `eswatini` returns a 200 HTML page (not a 404),
  which would slip past `curl --fail` — so `merge.sh` validates each download
  with `osmium fileinfo` and aborts naming the bad slug.
- **Runtime mount is read-write**, not `:ro` — the embedded Elasticsearch
  writes a node lock on startup and won't boot from a read-only dir.
- **`work/`, `data/`, `dist/`, `photon-index/`, `.env`** are git-ignored
  (large/regenerable/secret). `work/` and `data/` are scratch — delete once the
  tarball is saved.
