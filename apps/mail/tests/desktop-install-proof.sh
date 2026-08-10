#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname "$0")/../../.." && pwd)
OUT=${1:-"$ROOT/dist"}
PORT=${YNX_MAIL_DESKTOP_PROOF_PORT:-28095}
ARCHIVE=$("$ROOT/apps/mail/scripts/package-desktop.sh" "$OUT" | tail -1)
INSTALL=$(mktemp -d "${TMPDIR:-/tmp}/ynx-mail-installed.XXXXXX")
DATA="$INSTALL/data"
LOG="$INSTALL/mail.log"
EXPECTED=$(git -C "$ROOT" rev-parse HEAD)
cleanup() {
  status=$?
  trap - EXIT INT TERM
  test -z "${PID:-}" || kill "$PID" 2>/dev/null || true
  rm -rf "$INSTALL"
  exit "$status"
}
trap cleanup EXIT INT TERM
tar -C "$INSTALL" -xzf "$ARCHIVE"
BIN=$(find "$INSTALL" -type f -path '*/bin/ynx-maild' -print -quit)
test -x "$BIN"

launch() {
  START=$(perl -MTime::HiRes=time -e 'print time')
  YNX_MAIL_ADDR="127.0.0.1:$PORT" YNX_MAIL_DATA_DIR="$DATA" "$BIN" > "$LOG" 2>&1 &
  PID=$!
  i=0
  until HEALTH=$(curl -fsS "http://127.0.0.1:$PORT/v1/health" 2>/dev/null); do
    i=$((i + 1))
    test "$i" -lt 200 || { sed -n '1,120p' "$LOG"; exit 1; }
    sleep 0.05
  done
  END=$(perl -MTime::HiRes=time -e 'print time')
  ELAPSED=$(awk -v start="$START" -v end="$END" 'BEGIN { printf "%.3f", end - start }')
  printf '%s' "$HEALTH" | jq -e --arg commit "$EXPECTED" '.ok == true and .build.commit == $commit and .internet_delivery == false' >/dev/null
  curl -fsS "http://127.0.0.1:$PORT/" | grep -q 'YNX Mail'
}

launch
FIRST_SECONDS=$ELAPSED
kill "$PID"
wait "$PID" 2>/dev/null || true
PID=
test -f "$DATA/sender.ed25519"
launch
RESTART_SECONDS=$ELAPSED
kill "$PID"
wait "$PID" 2>/dev/null || true
PID=

SHA=$(shasum -a 256 "$ARCHIVE" | awk '{print $1}')
BYTES=$(stat -f %z "$ARCHIVE" 2>/dev/null || stat -c %s "$ARCHIVE")
EVIDENCE="$OUT/ynx-mail-0.2.0-testnet-preview-darwin-arm64-desktop-install-evidence.json"
jq -n \
  --arg product 'YNX Mail' \
  --arg commit "$EXPECTED" \
  --arg archive "$(basename "$ARCHIVE")" \
  --arg sha256 "$SHA" \
  --argjson bytes "$BYTES" \
  --argjson coldStartSeconds "$FIRST_SECONDS" \
  --argjson restartSeconds "$RESTART_SECONDS" \
  '{product:$product,commit:$commit,platform:"darwin-arm64",install:"extracted-and-executable",coldStartSeconds:$coldStartSeconds,restartSeconds:$restartSeconds,healthBoundary:"internet_delivery=false",signingClass:"unsigned-local",archive:$archive,sha256:$sha256,bytes:$bytes}' > "$EVIDENCE"
jq . "$EVIDENCE"
