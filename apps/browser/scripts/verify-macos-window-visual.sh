#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="$ROOT/dist/macos/YNX Browser Testnet Preview.app"
BIN="$APP/Contents/MacOS/YNXBrowserNative"
COMMIT="$(git -C "$ROOT/../.." rev-parse --short=12 HEAD)"
OUT="${1:-$ROOT/evidence/macos-window-$COMMIT}"
TMP="$(mktemp -d /tmp/ynx-browser-window-qa.XXXXXX)"
PID=""

cleanup() {
  status=$?
  trap - EXIT INT TERM
  if [[ -n "$PID" ]]; then kill "$PID" 2>/dev/null || true; wait "$PID" 2>/dev/null || true; fi
  exit "$status"
}
trap cleanup EXIT INT TERM

if pgrep -x YNXBrowserNative >/dev/null 2>&1; then
  echo "Close every running YNX Browser before isolated visual QA." >&2
  exit 1
fi

mkdir -p "$OUT" "$TMP/home"
"$ROOT/scripts/build-macos-app.sh" >/dev/null

inspect() {
  local label="$1"
  swift "$ROOT/scripts/inspect-macos-window.swift" "$PID" > "$OUT/$label.json"
  node -e '
    const fs=require("fs"), p=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
    if(p.width<Number(process.argv[2])||p.height<Number(process.argv[3])){
      console.error(`window ${p.width}x${p.height} is below ${process.argv[2]}x${process.argv[3]}`);process.exit(1)
    }
  ' "$OUT/$label.json" "$2" "$3"
  local window_id
  window_id="$(node -p 'require(process.argv[1]).windowId' "$OUT/$label.json")"
  screencapture -x -l "$window_id" "$OUT/$label.png"
  test -s "$OUT/$label.png"
}

launch() {
  local appearance="$1"
  local self_evidence="$2"
  CFFIXED_USER_HOME="$TMP/home" \
  YNX_BROWSER_APPEARANCE="$appearance" \
  YNX_BROWSER_WINDOW_EVIDENCE_FILE="$OUT/$self_evidence" \
  "$BIN" > "$TMP/$self_evidence.log" 2>&1 &
  PID=$!
  for _ in $(seq 1 40); do [[ -s "$OUT/$self_evidence" ]] && return; sleep 0.25; done
  cat "$TMP/$self_evidence.log" >&2
  echo "YNX Browser did not publish stable window evidence" >&2
  exit 1
}

stop_browser() {
  kill "$PID"
  wait "$PID" 2>/dev/null || true
  PID=""
}

launch light standard-self.json
inspect standard-light 920 620
osascript -e 'tell application "System Events" to tell process "YNX Browser" to set size of window 1 to {920, 620}' >/dev/null
sleep 1
inspect minimum-light 920 620
stop_browser

launch light relaunch-self.json
inspect second-launch-light 920 620
stop_browser

launch dark dark-self.json
inspect standard-dark 920 620
osascript -e 'tell application "System Events" to tell process "YNX Browser" to set value of attribute "AXFullScreen" of window 1 to true' >/dev/null
sleep 2
inspect fullscreen-dark 920 620
stop_browser

node -e '
  const fs=require("fs"), path=require("path"), crypto=require("crypto"), out=process.argv[1], commit=process.argv[2];
  const files=fs.readdirSync(out).sort().map(name=>{const body=fs.readFileSync(path.join(out,name));return{name,bytes:body.length,sha256:crypto.createHash("sha256").update(body).digest("hex")}});
  fs.writeFileSync(path.join(out,"manifest.json"),JSON.stringify({schemaVersion:"ynx-browser-macos-window-visual-v1",sourceCommit:commit,passed:true,gates:["standard-light","minimum-light","second-launch-light","standard-dark","fullscreen-dark"],files},null,2)+"\n");
' "$OUT" "$COMMIT"

cat "$OUT/manifest.json"
