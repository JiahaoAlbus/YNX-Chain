#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
TMP="$(mktemp -d)"
PORT="${YNX_CLOUD_SMOKE_PORT:-18092}"
cleanup() { if test -n "${PID:-}"; then kill "$PID" 2>/dev/null || true; wait "$PID" 2>/dev/null || true; fi; rm -rf "$TMP"; }
trap cleanup EXIT
cd "$ROOT"
go run ./apps/cloud/cmd/ynx-cloudd -addr "127.0.0.1:${PORT}" -data "$TMP/data" -dev-wallet >"$TMP/server.log" 2>&1 & PID=$!
for _ in $(seq 1 240); do curl -fs "http://127.0.0.1:${PORT}/health" > /dev/null 2>&1 && break; sleep .1; done
curl -fsS "http://127.0.0.1:${PORT}/health" > /dev/null || { sed -n '1,120p' "$TMP/server.log"; exit 1; }
EXPIRES="$(date -u -v+4M '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null || date -u -d '+4 minutes' '+%Y-%m-%dT%H:%M:%SZ')"
SESSION="$(curl -fsS -X POST "http://127.0.0.1:${PORT}/api/v1/session" -H 'Content-Type: application/json' --data "{\"product\":\"cloud\",\"clientId\":\"com.ynx.cloud.web\",\"callback\":\"/cloud/auth/callback\",\"account\":\"ynx1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqp7h6v\",\"chainId\":\"ynx_6423-1\",\"scopes\":[\"files.read\",\"files.write\",\"permissions.manage\",\"audit.read\",\"ai.use\"],\"nonce\":\"smoke\",\"expiresAt\":\"$EXPIRES\",\"devicePublicKey\":\"local-smoke-device\",\"signature\":\"dev-signed\"}" | sed -E 's/.*\"token\":\"([^\"]+)\".*/\1/')"
curl -fsS -X POST "http://127.0.0.1:${PORT}/api/v1/objects" -H "Authorization: Bearer $SESSION" -H 'Content-Type: application/json' --data '{"kind":"folder","name":"Smoke folder","content":"","encryption":{"clientSide":false}}' > "$TMP/object.json"
curl -fsS "http://127.0.0.1:${PORT}/api/v1/objects" -H "Authorization: Bearer $SESSION" | grep -q 'Smoke folder'
curl -fsS "http://127.0.0.1:${PORT}/cloud/" | grep -q 'YNX Cloud'
curl -fsS "http://127.0.0.1:${PORT}/docs/" | grep -q 'YNX Docs'
echo "YNX Cloud & Docs smoke passed"
