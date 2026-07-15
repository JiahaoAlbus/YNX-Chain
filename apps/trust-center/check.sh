#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TMP="$(mktemp -d)"
cleanup(){ kill "${PID:-}" 2>/dev/null || true; wait "${PID:-}" 2>/dev/null || true; rm -rf "$TMP"; }
trap cleanup EXIT
cd "$ROOT"
YNX_TRUST_CENTER_DEV_HEADER_AUTH=1 YNX_TRUST_CENTER_ADDR=127.0.0.1:16440 YNX_TRUST_CENTER_STORE="$TMP/state.json" go run ./apps/trust-center >"$TMP/server.log" 2>&1 & PID=$!
for _ in {1..80}; do curl -fsS http://127.0.0.1:16440/health >/dev/null 2>&1 && break; sleep .1; done
curl -fsS http://127.0.0.1:16440/health | grep -q '"persistent":true'
curl -fsS -H 'X-YNX-Actor: smoke-reporter' -H 'X-YNX-Role: reporter' -H 'Content-Type: application/json' -d '{"type":"submit_case","idempotencyKey":"smoke-case","subject":"smoke-subject","purpose":"bounded smoke review","requestScope":"one event","requestedAction":"review and explain","evidence":[{"source":"smoke signed record","digest":"sha256:smoke","summary":"bounded test evidence","visibleToSubject":true}]}' http://127.0.0.1:16440/api/actions | grep -q '"status":"submitted"'
curl -fsS http://127.0.0.1:16440/api/transparency | grep -q '"submitted":1'
echo 'trust-center-check: ok'
