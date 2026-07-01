#!/usr/bin/env bash
set -euo pipefail

make env-check
make no-placeholder-check
make secret-scan
go test ./cmd/... ./internal/...
make deploy-dry-run
echo "preflight passed for local devnet/testnet deployment package"
