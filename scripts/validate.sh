#!/usr/bin/env bash
# Local validation gate (there is no hosted CI): typecheck, tests, sweep report freshness, production build. Used by the pre-push hook and by deploy.sh.
set -euo pipefail
cd "$(dirname "$0")/.."
echo "==> typecheck + tests"; npm test --silent
echo "==> pin-sweep report freshness"; npm run --silent sweep >/dev/null; if ! git diff --quiet -- docs/pin-sweep.md; then echo "docs/pin-sweep.md is out of date; commit the regenerated file" >&2; exit 1; fi
echo "==> build"; npm run --silent build >/dev/null
echo "validation passed"
