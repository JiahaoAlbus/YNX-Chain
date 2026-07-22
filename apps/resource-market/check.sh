#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TMP="$(mktemp -d)"
cleanup(){ kill "${PID:-}" 2>/dev/null || true; wait "${PID:-}" 2>/dev/null || true; rm -rf "$TMP"; }
trap cleanup EXIT
cd "$ROOT"
YNX_RESOURCE_MARKET_DEV_HEADER_AUTH=1 YNX_RESOURCE_MARKET_ADDR=127.0.0.1:16441 YNX_RESOURCE_MARKET_STORE="$TMP/state.json" YNX_RESOURCE_MARKET_ENGINE_STORE="$TMP/market.json" go run ./apps/resource-market >"$TMP/server.log" 2>&1 & PID=$!
for _ in {1..300}; do curl -fsS http://127.0.0.1:16441/health >/dev/null 2>&1 && break; sleep .1; done
curl -fsS http://127.0.0.1:16441/health | jq -e '.status == "ready" and .checks.marketEngineInitialized == "pass" and .coverage == "local process initialization only"' >/dev/null
curl -fsS http://127.0.0.1:16441/version | jq -e '.marketSchemaVersion == 5 and .releaseClass == "unreleased-local-candidate"' >/dev/null
curl -fsS http://127.0.0.1:16441/status | jq -e '.status == "operational" and .source == "current-process SLO guardrails"' >/dev/null
curl -fsS http://127.0.0.1:16441/resource-market | grep -q '<title>YNX Resource Market — Verifiable Infrastructure Capacity</title>'
EXPIRY="$(date -u -v+1d '+%Y-%m-%dT%H:%M:%SZ')"
curl -fsS -H 'X-YNX-Actor: smoke-owner' -H 'X-YNX-Role: user' -H 'Content-Type: application/json' -d "{\"type\":\"create_pool\",\"idempotencyKey\":\"smoke-pool\",\"resourceType\":\"Bandwidth\",\"limit\":100,\"source\":\"smoke-staking-proof\",\"expiry\":\"$EXPIRY\",\"fee\":1,\"policy\":{\"maxPerGrant\":25,\"revocable\":true}}" http://127.0.0.1:16441/api/actions | grep -q '"status":"pending_capacity_evidence"'
curl -fsS -H 'X-YNX-Actor: smoke-owner' -H 'X-YNX-Role: user' http://127.0.0.1:16441/api/state | grep -q '"assetMovement":false'
AS_OF="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
PROVIDER_ID="$(curl -fsS -H 'X-YNX-Actor: smoke-provider' -H 'X-YNX-Role: user' -H 'Content-Type: application/json' -d "{\"type\":\"register_provider\",\"provider\":{\"wallet\":\"smoke-provider\",\"name\":\"Smoke CPU Provider\",\"region\":\"local-testnet\",\"hardware\":[\"ephemeral-smoke-worker\"],\"securityBond\":100,\"source\":{\"kind\":\"test_attestation\",\"asOf\":\"$AS_OF\",\"version\":\"1\",\"coverage\":\"smoke only\",\"status\":\"available\"}}}" http://127.0.0.1:16441/api/market/actions | jq -er '.result.id')"
curl -fsS -H 'X-YNX-Actor: smoke-verifier' -H 'X-YNX-Role: resource_verifier' -H 'Content-Type: application/json' -d "{\"type\":\"verify_provider\",\"providerId\":\"$PROVIDER_ID\",\"provider\":{\"evidence\":[\"smoke-attestation-digest\"]}}" http://127.0.0.1:16441/api/market/actions | jq -e '.result.status == "verified"' >/dev/null
OFFER_ID="$(curl -fsS -H 'X-YNX-Actor: smoke-provider' -H 'X-YNX-Role: user' -H 'Content-Type: application/json' -d "{\"type\":\"publish_offer\",\"offer\":{\"providerId\":\"$PROVIDER_ID\",\"resource\":\"cpu_compute\",\"unit\":\"vcpu-second\",\"pricing\":\"fixed\",\"currency\":\"YNXT-testnet\",\"unitPrice\":2,\"capacity\":1000,\"minUnits\":1,\"maxUnits\":500,\"source\":{\"kind\":\"test_capacity\",\"asOf\":\"$AS_OF\",\"version\":\"1\",\"coverage\":\"smoke only\",\"status\":\"available\"},\"expiresAt\":\"$EXPIRY\"}}" http://127.0.0.1:16441/api/market/actions | jq -er '.result.id')"
curl -fsS -H 'X-YNX-Actor: smoke-buyer' -H 'X-YNX-Role: user' -H 'Content-Type: application/json' -d "{\"type\":\"create_quote\",\"offerId\":\"$OFFER_ID\",\"units\":100,\"protocolFee\":5}" http://127.0.0.1:16441/api/market/actions | jq -e '.result.status == "quote" and .result.grossCost == 205' >/dev/null
curl -fsS -H 'X-YNX-Actor: smoke-buyer' -H 'X-YNX-Role: user' 'http://127.0.0.1:16441/api/market/matches?resource=cpu_compute&units=100' | jq -e '.offers | length == 1' >/dev/null
echo 'resource-market-check: ok'
