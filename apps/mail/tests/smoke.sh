#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname "$0")/../../.." && pwd)
PORT=${YNX_MAIL_SMOKE_PORT:-18095}
DATA=$(mktemp -d)
LOG=$(mktemp)
cleanup(){ kill "$PID" 2>/dev/null || true; rm -rf "$DATA" "$LOG"; }
trap cleanup EXIT INT TERM
(cd "$ROOT" && YNX_MAIL_ADDR="127.0.0.1:$PORT" YNX_MAIL_DATA_DIR="$DATA" go run ./apps/mail) >"$LOG" 2>&1 &
PID=$!
i=0
until curl -fsS "http://127.0.0.1:$PORT/v1/health" | grep -q '"internet_delivery":false'; do i=$((i+1)); [ "$i" -lt 120 ] || { sed -n '1,120p' "$LOG"; exit 1; }; sleep 0.25; done
curl -fsS "http://127.0.0.1:$PORT/" | grep -q 'YNX Mail'
curl -fsS "http://127.0.0.1:$PORT/app.js" | grep -q 'mail:account'
echo "YNX Mail smoke passed on $PORT"
