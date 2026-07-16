#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname "$0")/../../.." && pwd)
PORT=${YNX_CALENDAR_SMOKE_PORT:-18096}
DATA=$(mktemp -d)
LOG=$(mktemp)
cleanup(){ kill "$PID" 2>/dev/null || true; rm -rf "$DATA" "$LOG"; }
trap cleanup EXIT INT TERM
(cd "$ROOT" && YNX_CALENDAR_ADDR="127.0.0.1:$PORT" YNX_CALENDAR_DATA_DIR="$DATA" go run ./apps/calendar) >"$LOG" 2>&1 &
PID=$!
i=0
until curl -fsS "http://127.0.0.1:$PORT/v1/health" | grep -q '"production_scheduling":false'; do i=$((i+1)); [ "$i" -lt 120 ] || { sed -n '1,120p' "$LOG"; exit 1; }; sleep 0.25; done
curl -fsS "http://127.0.0.1:$PORT/" | grep -q 'YNX Calendar'
curl -fsS "http://127.0.0.1:$PORT/app.js" | grep -q 'calendar:account'
echo "YNX Calendar smoke passed on $PORT"
