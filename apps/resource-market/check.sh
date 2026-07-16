#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TMP="$(mktemp -d)"
cleanup(){ kill "${PID:-}" 2>/dev/null || true; wait "${PID:-}" 2>/dev/null || true; rm -rf "$TMP"; }
trap cleanup EXIT
cd "$ROOT"
YNX_RESOURCE_MARKET_DEV_HEADER_AUTH=1 YNX_RESOURCE_MARKET_ADDR=127.0.0.1:16441 YNX_RESOURCE_MARKET_STORE="$TMP/state.json" go run ./apps/resource-market >"$TMP/server.log" 2>&1 & PID=$!
for _ in {1..300}; do curl -fsS http://127.0.0.1:16441/health >/dev/null 2>&1 && break; sleep .1; done
curl -fsS http://127.0.0.1:16441/health | grep -q '"persistent":true'
EXPIRY="$(date -u -v+1d '+%Y-%m-%dT%H:%M:%SZ')"
curl -fsS -H 'X-YNX-Actor: smoke-owner' -H 'X-YNX-Role: user' -H 'Content-Type: application/json' -d "{\"type\":\"create_pool\",\"idempotencyKey\":\"smoke-pool\",\"resourceType\":\"Bandwidth\",\"limit\":100,\"source\":\"smoke-staking-proof\",\"expiry\":\"$EXPIRY\",\"fee\":1,\"policy\":{\"maxPerGrant\":25,\"revocable\":true}}" http://127.0.0.1:16441/api/actions | grep -q '"status":"active"'
curl -fsS -H 'X-YNX-Actor: smoke-owner' -H 'X-YNX-Role: user' http://127.0.0.1:16441/api/state | grep -q '"assetMovement":false'
echo 'resource-market-check: ok'
