#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
zip="$PWD/.ynx-developer-local/ynx-developer-testnet-preview-macos-unsigned.zip"
[[ -f "$zip" ]] || { echo "Build the local macOS package first." >&2; exit 1; }
work=$(mktemp -d /private/tmp/ynx-developer-install.XXXXXX)
cleanup() {
  if [[ -n "${app_pid:-}" ]]; then kill "$app_pid" >/dev/null 2>&1 || true; wait "$app_pid" 2>/dev/null || true; fi
  rm -rf "$work"
}
trap cleanup EXIT
/usr/bin/ditto -x -k "$zip" "$work"
app="$work/YNX Developer Testnet Preview.app"
[[ -x "$app/Contents/MacOS/YNXDeveloper" ]]
[[ -x "$app/Contents/Resources/runtime/node" ]]
if /usr/bin/xattr -p com.apple.quarantine "$app" >/dev/null 2>&1; then echo "Archive unexpectedly restored quarantine metadata." >&2; exit 1; fi
/usr/bin/codesign --verify --deep --strict --verbose=2 "$app"
signature=$(/usr/bin/codesign -dv --verbose=4 "$app" 2>&1 || true)
grep -Fq 'Signature=adhoc' <<<"$signature"
grep -Fq 'TeamIdentifier=not set' <<<"$signature"
"$app/Contents/MacOS/YNXDeveloper" --self-test "$app/Contents/Resources"
"$app/Contents/MacOS/YNXDeveloper" >"$work/cold-launch.log" 2>&1 &
app_pid=$!
server_pid=""
for _ in {1..50}; do
  if ! kill -0 "$app_pid" 2>/dev/null; then
    cat "$work/cold-launch.log" >&2
    echo "Extracted macOS Testnet Preview exited during cold launch." >&2
    exit 1
  fi
  server_pid=$(/usr/bin/pgrep -P "$app_pid" 2>/dev/null || true)
  [[ -n "$server_pid" ]] && break
  sleep 0.1
done
[[ -n "$server_pid" ]] || { cat "$work/cold-launch.log" >&2; echo "Bundled local server did not start during cold launch." >&2; exit 1; }
server_command=$(/bin/ps -o command= -p "$server_pid")
[[ "$server_command" == *"Contents/Resources/runtime/node"* && "$server_command" == *"Contents/Resources/server.mjs"* ]] || { echo "Cold launch started an unexpected child process: $server_command" >&2; exit 1; }
kill "$app_pid"
wait "$app_pid" 2>/dev/null || true
app_pid=""
for _ in {1..30}; do
  kill -0 "$server_pid" 2>/dev/null || break
  sleep 0.1
done
if kill -0 "$server_pid" 2>/dev/null; then
  kill "$server_pid" >/dev/null 2>&1 || true
  echo "Bundled local server survived App termination." >&2
  exit 1
fi
echo "Extracted macOS Testnet Preview resource self-test, cold launch and child cleanup passed: $app"
