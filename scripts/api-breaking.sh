#!/usr/bin/env bash
#
# Detect BREAKING changes in our generated OpenAPI specs.
#
# This answers a different question to `pnpm openapi:pinpoint:check`, which only
# asks "did someone forget to regenerate the spec?". A regenerated, perfectly
# in-sync spec can still break every consumer. This script diffs the spec
# against a base git ref and fails when the change is incompatible.
#
#   ./scripts/api-breaking.sh                 # compare against origin/main
#   ./scripts/api-breaking.sh HEAD~1          # compare against a specific ref
#   OASDIFF_FAIL_ON=WARN ./scripts/api-breaking.sh
#
# oasdiff resolves git refs natively (`<ref>:<path>`), so there is no temp-file
# extraction step — but that does mean the .git directory must be present and
# the base ref must be fetched (CI needs `fetch-depth: 0`).
#
# Uses a local `oasdiff` binary when present, otherwise falls back to the
# official Docker image. Install the binary for speed:
#   brew install oasdiff        # or: go install github.com/oasdiff/oasdiff@latest
#
# NOTE: do NOT install `oasdiff` from npm — that name is an unrelated
# placeholder package with no functionality.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

BASE_REF="${OASDIFF_BASE_REF:-${1:-origin/main}}"
FAIL_ON="${OASDIFF_FAIL_ON:-ERR}"
OASDIFF_IMAGE="${OASDIFF_IMAGE:-tufin/oasdiff:latest}"

# Specs to guard. Add new ones here as other apps grow a public surface.
SPECS=(
  "typescript/apps/pinpoint/openapi.gen.json"
)

if ! git rev-parse --verify --quiet "${BASE_REF}" >/dev/null; then
  echo "[api-breaking] base ref '${BASE_REF}' not found." >&2
  echo "[api-breaking] In CI, checkout with 'fetch-depth: 0' so history is available." >&2
  exit 2
fi

run_oasdiff() {
  if command -v oasdiff >/dev/null 2>&1; then
    oasdiff "$@"
  elif command -v docker >/dev/null 2>&1; then
    # Mount the repo (including .git) so oasdiff can resolve the base git ref.
    docker run --rm -v "${REPO_ROOT}:/repo" -w /repo "${OASDIFF_IMAGE}" "$@"
  else
    echo "[api-breaking] neither 'oasdiff' nor 'docker' is available." >&2
    echo "[api-breaking] install with: brew install oasdiff" >&2
    exit 2
  fi
}

status=0
for spec in "${SPECS[@]}"; do
  if [[ ! -f "${spec}" ]]; then
    echo "[api-breaking] skipping missing spec: ${spec}" >&2
    continue
  fi

  # A spec that does not exist on the base ref is new — nothing to break.
  if ! git cat-file -e "${BASE_REF}:${spec}" 2>/dev/null; then
    echo "[api-breaking] ${spec} is new on this branch — no baseline to compare."
    continue
  fi

  echo "[api-breaking] ${spec} vs ${BASE_REF}"
  # --auto-upgrade canonicalises both sides to the latest 3.x before diffing.
  # Without it, the one-off 3.0.3 -> 3.1.0 migration reads as a wholesale
  # rewrite instead of the no-op it actually is.
  if ! run_oasdiff breaking "${BASE_REF}:${spec}" "${spec}" \
    --fail-on "${FAIL_ON}" --auto-upgrade --color never; then
    status=1
  fi
done

if [[ ${status} -ne 0 ]]; then
  echo >&2
  echo "[api-breaking] Breaking changes detected against ${BASE_REF}." >&2
  echo "[api-breaking] Either make the change additive, or version the endpoint." >&2
fi

exit "${status}"
