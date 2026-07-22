#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TMP="$(mktemp -d)"
cleanup(){ kill "${PID:-}" 2>/dev/null || true; wait "${PID:-}" 2>/dev/null || true; rm -rf "$TMP"; }
trap cleanup EXIT
cd "$ROOT"
YNX_TRUST_CENTER_DEV_HEADER_AUTH=1 YNX_TRUST_CENTER_ADDR=127.0.0.1:16440 YNX_TRUST_CENTER_STORE="$TMP/state.json" go run ./apps/trust-center >"$TMP/server.log" 2>&1 & PID=$!
for _ in {1..300}; do curl -fsS http://127.0.0.1:16440/health >/dev/null 2>&1 && break; sleep .1; done
curl -fsS http://127.0.0.1:16440/health | grep -q '"persistent":true'
DIGEST="$(printf 'a%.0s' {1..64})"
EXPIRY="$(date -u -v+1d '+%Y-%m-%dT%H:%M:%SZ')"
curl -fsS -H 'X-YNX-Actor: smoke-reporter' -H 'X-YNX-Role: reporter' -H 'Content-Type: application/json' -d "{\"type\":\"submit_case\",\"idempotencyKey\":\"smoke-case\",\"subject\":\"smoke-subject\",\"requester\":\"smoke-reporter\",\"authority\":\"YNX Test Review Unit\",\"jurisdiction\":\"YNX Testnet / smoke case\",\"requestScope\":\"one subject, one event, one day\",\"purpose\":\"bounded smoke review\",\"requestedAction\":\"human review and advisory explanation\",\"assetBoundary\":\"YNXT: advisory record only; no freeze, seize, transfer or blacklist\",\"requestExpiresAt\":\"$EXPIRY\",\"evidence\":[{\"packet\":\"$DIGEST\",\"source\":\"smoke signed record\",\"digest\":\"$DIGEST\",\"sourceHash\":\"$DIGEST\",\"authority\":\"YNX Test Review Unit\",\"jurisdiction\":\"YNX Testnet / smoke case\",\"scope\":\"one signed event\",\"assets\":[\"YNXT evidence only\"],\"expiresAt\":\"$EXPIRY\",\"summary\":\"bounded test evidence visible to the subject\",\"visibleToSubject\":true}]}" http://127.0.0.1:16440/api/actions | grep -q '"status":"governance_review"'
curl -fsS http://127.0.0.1:16440/api/transparency | grep -q '"governance_review":1'
echo 'trust-center-check: ok'
