#!/usr/bin/env bash
#
# Download the per-country Geofabrik extracts named in $COUNTRIES and merge
# them into a single deduplicated PBF. Runs inside the `prep` container
# (prep.Dockerfile) — has curl + osmium-tool available.
set -euo pipefail

: "${COUNTRIES:?COUNTRIES must be set (space-separated Geofabrik slugs)}"
BASE="${GEOFABRIK_BASE:-https://download.geofabrik.de/africa}"
OUT="${OUT_FILE:-/work/combined.osm.pbf}"

mkdir -p "$(dirname "$OUT")"

files=()
for c in $COUNTRIES; do
  url="${BASE}/${c}-latest.osm.pbf"
  dest="/work/${c}-latest.osm.pbf"
  echo ">> downloading ${url}"
  curl -fL --retry 3 --retry-delay 2 -o "$dest" "$url"
  # --fail catches 4xx/5xx, but Geofabrik serves a 200 HTML page for an unknown
  # slug (e.g. "eswatini" — it's published as "swaziland"). That slips past
  # curl, so verify each file is actually a PBF before trusting the merge.
  if ! osmium fileinfo "$dest" >/dev/null 2>&1; then
    echo "!! '${dest}' is not a valid OSM PBF ($(wc -c <"$dest") bytes) — likely a bad COUNTRIES slug for '${c}'. Geofabrik uses 'swaziland', not 'eswatini'." >&2
    exit 1
  fi
  files+=("$dest")
done

echo ">> merging ${#files[@]} extracts -> ${OUT}"
# Geofabrik extracts are sorted (type, id); merge dedupes objects shared
# across extracts. --overwrite keeps re-runs idempotent.
osmium merge --overwrite -o "$OUT" "${files[@]}"

echo ">> result:"
osmium fileinfo "$OUT" | sed -n '1,24p'
echo ">> done: ${OUT}"
