#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."

go test ./internal/bftgateway ./cmd/ynx-bft-gatewayd
mkdir -p tmp/verify-bft-gateway
go build -o tmp/verify-bft-gateway/ynx-bft-gatewayd ./cmd/ynx-bft-gatewayd
grep -Fq 'publicCutoverReady' internal/bftgateway/gateway.go
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
grep -Fq '127.0.0.1:27620' .env.bft-gateway.example
grep -Fq '127.0.0.1:27757' .env.bft-gateway.example

echo "bft-gateway-check passed: native and signed AI action compatibility handlers are implemented while unproven cutover capabilities remain fail-closed"
