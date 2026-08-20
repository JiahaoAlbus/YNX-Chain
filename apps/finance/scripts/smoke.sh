#!/usr/bin/env bash
set -euo pipefail
repo="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$repo"
node apps/finance/scripts/security-check.mjs
node --test apps/finance/tests/*.test.mjs
if [[ -d internal/finance ]]; then
  go test ./internal/finance ./apps/finance/cmd/server ./apps/finance/cmd/admin
  go build -o "${TMPDIR:-/tmp}/ynx-finance-smoke" ./apps/finance/cmd/server
  go build -o "${TMPDIR:-/tmp}/ynx-finance-admin-smoke" ./apps/finance/cmd/admin
  test -s "${TMPDIR:-/tmp}/ynx-finance-smoke"
  test -s "${TMPDIR:-/tmp}/ynx-finance-admin-smoke"
  echo "YNX Finance smoke passed"
else
  echo "YNX Finance frontend smoke passed; Go backend smoke skipped because internal/finance is not present in this Finance-only recovery checkout."
fi
