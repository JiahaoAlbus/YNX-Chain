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
make faucet-check
make indexer-check
make explorer-check
make ai-gateway-check
make pay-api-check
make trust-api-check
make resource-api-check
make validator-peer-readiness-check
make anti-illegal-request-check
make request-validity-check
make transparency-report-check
make trust-appeal-check
make anti-unreasonable-tracking-check
make native-ynxt-no-hidden-freeze-check
make resource-market-check
make consensus-migration-check
make consensus-abci-check
make consensus-signed-transfer-check
make consensus-quorum-check
make consensus-production-package-check
make bft-gateway-check
make bft-ai-action-check
make bft-pay-action-check
make bft-trust-action-check
make consensus-public-cutover-check
make caddy-ingress-check
make ops-check
echo "preflight passed for local devnet/testnet deployment package, four-validator consensus lab, production BFT candidate package, and fail-closed BFT Gateway cutover boundary"
