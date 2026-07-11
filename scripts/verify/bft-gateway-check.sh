#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."

go test ./internal/bftgateway ./cmd/ynx-bft-gatewayd
mkdir -p tmp/verify-bft-gateway
go build -o tmp/verify-bft-gateway/ynx-bft-gatewayd ./cmd/ynx-bft-gatewayd
grep -Fq 'publicCutoverReady' internal/bftgateway/gateway.go
grep -Fq '"trust-and-chain-law-state-transitions"' internal/bftgateway/gateway.go
grep -Fq '127.0.0.1:27620' .env.bft-gateway.example
grep -Fq '127.0.0.1:27757' .env.bft-gateway.example

echo "bft-gateway-check passed: CometBFT-backed compatibility APIs are implemented and incomplete cutover capabilities remain fail-closed"
