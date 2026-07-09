#!/usr/bin/env bash
set -euo pipefail

make env-check
make no-placeholder-check
make secret-scan
make objective-state-check
make deploy-readiness-gate-check
make host-key-approval-check-test
go test ./cmd/... ./internal/...
make deploy-dry-run
make ops-check
echo "preflight passed for local devnet/testnet deployment package"
