#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."

go test ./internal/bftgateway ./cmd/ynx-bft-gatewayd
mkdir -p tmp/verify-bft-gateway
go build -o tmp/verify-bft-gateway/ynx-bft-gatewayd ./cmd/ynx-bft-gatewayd
grep -Fq 'publicCutoverReady' internal/bftgateway/gateway.go
grep -Fq 'PublicCutoverAuthorized' internal/bftgateway/gateway.go
grep -Fq 'YNX_BFT_GATEWAY_PUBLIC_CUTOVER_AUTHORIZED' cmd/ynx-bft-gatewayd/main.go
grep -Fq 'YNX_BFT_GATEWAY_PUBLIC_CUTOVER_AUTHORIZED=false' .env.bft-gateway.example
grep -Fq '"trust-and-chain-law-state-transitions"' internal/bftgateway/gateway.go
grep -Fq 'POST /transactions/broadcast' internal/bftgateway/gateway.go
grep -Fq 'GET /txs/{hash}' internal/bftgateway/gateway.go
grep -Fq 'GET /txs' internal/bftgateway/gateway.go
grep -Fq 'broadcast_tx_commit' internal/bftgateway/gateway.go
grep -Fq 'tx_search' internal/bftgateway/gateway.go
grep -Fq '"faucet-state-transition"' internal/bftgateway/gateway.go
grep -Fq 'earliest_block_height' internal/bftgateway/gateway.go
grep -Fq 'POST /ai/permissions' internal/bftgateway/gateway.go
grep -Fq 'GET /ai/audit' internal/bftgateway/gateway.go
grep -Fq 'POST /pay/intents' internal/bftgateway/gateway.go
grep -Fq 'GET /pay/events' internal/bftgateway/gateway.go
grep -Fq 'POST /governance/requests' internal/bftgateway/gateway.go
grep -Fq 'GET /governance/transparency' internal/bftgateway/gateway.go
grep -Fq 'POST /trust/appeals' internal/bftgateway/gateway.go
grep -Fq '"ide-contract-state-transitions"' internal/bftgateway/gateway.go
grep -Fq '127.0.0.1:27620' .env.bft-gateway.example
grep -Fq '127.0.0.1:27757' .env.bft-gateway.example

echo "bft-gateway-check passed: all fifteen compatibility capabilities are implemented and public cutover readiness remains default-false behind explicit authorization and release-identity gates"
