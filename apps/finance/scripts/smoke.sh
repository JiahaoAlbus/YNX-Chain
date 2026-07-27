#!/usr/bin/env bash
set -euo pipefail
repo="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$repo"
node apps/finance/scripts/security-check.mjs
go test ./internal/finance ./apps/finance/cmd/server ./apps/finance/cmd/admin
node --test apps/finance/tests/*.test.mjs
go build -o "${TMPDIR:-/tmp}/ynx-finance-smoke" ./apps/finance/cmd/server
go build -o "${TMPDIR:-/tmp}/ynx-finance-admin-smoke" ./apps/finance/cmd/admin
test -s "${TMPDIR:-/tmp}/ynx-finance-smoke"
test -s "${TMPDIR:-/tmp}/ynx-finance-admin-smoke"
echo "YNX Finance smoke passed"
