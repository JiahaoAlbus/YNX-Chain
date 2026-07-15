#!/usr/bin/env bash
set -euo pipefail
repo="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$repo"
go test ./internal/finance ./apps/finance/cmd/server
node --test apps/finance/tests/*.test.mjs
go build -o "${TMPDIR:-/tmp}/ynx-finance-smoke" ./apps/finance/cmd/server
test -s "${TMPDIR:-/tmp}/ynx-finance-smoke"
echo "YNX Finance smoke passed"
