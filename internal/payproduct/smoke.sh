#!/usr/bin/env bash
set -euo pipefail
repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$repo"
go test ./internal/payproduct/... -run 'TestHTTPProductSmoke|TestAuthoritativePaymentPersistenceIdempotencyAndTamper|TestConcurrentInvoiceIdempotencyCreatesOneCentralPair' -count=1
npm run check --prefix apps/merchant-console
npm run check --prefix apps/pay
