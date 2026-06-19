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
  # Geofabrik 404s with a slug change occasionally (e.g. swaziland→eswatini).
  # --fail makes that a hard error instead of saving an HTML error page.
  curl -fL --retry 3 --retry-delay 2 -o "$dest" "$url"
  files+=("$dest")
done

echo ">> merging ${#files[@]} extracts -> ${OUT}"
# Geofabrik extracts are sorted (type, id); merge dedupes objects shared
# across extracts. --overwrite keeps re-runs idempotent.
osmium merge --overwrite -o "$OUT" "${files[@]}"

echo ">> result:"
osmium fileinfo "$OUT" | sed -n '1,24p'
echo ">> done: ${OUT}"
