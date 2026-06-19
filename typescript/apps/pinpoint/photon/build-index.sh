#!/usr/bin/env bash
#
# Build a self-contained Photon geocoding index for the southern-Africa
# operating region and emit a portable tarball under ./dist.
#
# Everything runs in throwaway containers — NOTHING connects to pinpoint's
# runtime Postgres. The only host requirement is Docker with compose v2.
#
#   cp .env.example .env   # tune COUNTRIES / versions if needed
#   ./build-index.sh
#
# Budget a beefy BUILD host (not your runtime box): ~16–32 GB RAM and
# 50–150 GB free disk for the transient Nominatim import. The resulting
# index tarball is small.
set -euo pipefail

cd "$(dirname "$0")"

if [[ -f .env ]]; then
  set -a; . ./.env; set +a
else
  echo "!! no .env found — copy .env.example to .env first" >&2
  exit 1
fi

: "${COUNTRIES:?set COUNTRIES in .env (space-separated Geofabrik slugs)}"

COMPOSE=(docker compose -f compose.photon-build.yaml)
STAMP="$(date +%Y%m%d)"
DIST_FILE="dist/${DIST_NAME:-photon-data-southern-africa}-${STAMP}.tar.gz"

cleanup() {
  echo ">> tearing down throwaway Nominatim (down -v)"
  "${COMPOSE[@]}" down -v --remove-orphans || true
}
trap cleanup EXIT

mkdir -p work data dist

echo "== [1/4] download + merge extracts: ${COUNTRIES}"
"${COMPOSE[@]}" run --rm prep

echo "== [2/4] import merged PBF into throwaway Nominatim (slow — minutes to hours)"
"${COMPOSE[@]}" up -d --wait nominatim

echo "== [3/4] build Photon index from Nominatim"
rm -rf data/photon_data
"${COMPOSE[@]}" run --rm photon-import

if [[ ! -d data/photon_data ]]; then
  echo "!! photon_data was not produced — the import failed; see logs above" >&2
  exit 1
fi

echo "== [4/4] package index -> ${DIST_FILE}"
tar -C data -czf "${DIST_FILE}" photon_data
ls -lh "${DIST_FILE}"

cat <<EOF

>> done.
   Artifact: ${DIST_FILE}
   Ship it, extract into ./photon-index, and serve with compose.photon.yaml:

     mkdir -p photon-index
     tar -C photon-index -xzf ${DIST_FILE}
     docker compose -f compose.photon.yaml up -d --build

   Then point pinpoint at it:  PINPOINT_GEOCODING_API_URL=http://<host>:${PHOTON_HTTP_PORT:-2322}

   (./work and ./data are scratch — safe to delete once the tarball is saved.)
EOF
