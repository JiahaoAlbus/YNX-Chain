#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
TMP="$(mktemp -d)"
PORT="${YNX_CLOUD_SMOKE_PORT:-18092}"
cleanup(){ if [[ -n "${PID:-}" ]]; then kill "$PID" 2>/dev/null || true; wait "$PID" 2>/dev/null || true; fi; rm -rf "$TMP"; }
trap cleanup EXIT
cd "$ROOT"
go run ./apps/cloud/cmd/ynx-cloudd -addr "127.0.0.1:${PORT}" -data "$TMP/data" -dev-wallet >"$TMP/server.log" 2>&1 & PID=$!
READY=""
for _ in {1..200}; do if curl -fsS "http://127.0.0.1:${PORT}/health" >/dev/null 2>&1; then READY=yes; break; fi; sleep .1; done
if [[ "$READY" != yes ]]; then cat "$TMP/server.log"; exit 1; fi
node apps/cloud/scripts/canonical-smoke.mjs "http://127.0.0.1:${PORT}/api/v1"
kill "$PID"; wait "$PID" 2>/dev/null || true; PID=""
go run ./apps/cloud/cmd/ynx-cloudd -data "$TMP/data" -backup "$TMP/backup"
go run ./apps/cloud/cmd/ynx-cloudd -data "$TMP/restored" -restore "$TMP/backup"
cmp "$TMP/data/state.json" "$TMP/restored/state.json"
echo "YNX Cloud & Docs backup/restore smoke passed"
