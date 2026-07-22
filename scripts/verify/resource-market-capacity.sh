#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TMP="$(mktemp -d)"
PORT="${YNX_CAPACITY_PORT:-16442}"
cleanup(){ kill "${PID:-}" 2>/dev/null || true; wait "${PID:-}" 2>/dev/null || true; rm -rf "$TMP"; }
trap cleanup EXIT
cd "$ROOT"
YNX_RESOURCE_MARKET_DEV_HEADER_AUTH=1 \
YNX_RESOURCE_MARKET_ADDR="127.0.0.1:$PORT" \
YNX_RESOURCE_MARKET_STORE="$TMP/product.json" \
YNX_RESOURCE_MARKET_ENGINE_STORE="$TMP/market.json" \
go run ./apps/resource-market >"$TMP/server.log" 2>&1 & PID=$!
for _ in {1..300}; do curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null 2>&1 && break; sleep .1; done
curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null
YNX_RESOURCE_MARKET_URL="http://127.0.0.1:$PORT" node scripts/verify/resource-market-capacity.mjs
