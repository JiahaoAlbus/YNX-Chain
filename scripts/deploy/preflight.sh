#!/usr/bin/env bash
set -euo pipefail

make env-check
make no-placeholder-check
make secret-scan
make objective-state-check
make deploy-readiness-gate-check
make public-proof-evidence-check
make public-proof-package-check
make release-manifest-evidence-check
make host-key-approval-check-test
make verify-testnet-check
go test ./cmd/... ./internal/...
make caddy-ingress-check
make ops-check
echo "preflight passed for local devnet/testnet deployment package"
