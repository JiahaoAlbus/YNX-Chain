#!/usr/bin/env bash
set -Eeuo pipefail
cd "$(dirname "$0")/../.."

commit="$(git rev-parse HEAD)"
output="${1:-}"
node ./scripts/verify/bridge-migration-evidence.mjs "$commit" "$output"
