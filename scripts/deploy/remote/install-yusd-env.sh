#!/usr/bin/env bash
set -euo pipefail

template="${1:?YUSD environment template is required}"
destination="${2:-/etc/ynx/ynx-yusd-sandboxd.env}"

[[ -f "$template" && ! -L "$template" ]] || { echo "YUSD environment template must be a regular file"; exit 1; }
grep -Fxq 'YNX_YUSD_SANDBOX_ADDR=127.0.0.1:6490' "$template"
grep -Fxq 'YNX_YUSD_SANDBOX_STATE_PATH=/var/lib/ynx-chain/yusd-sandbox/state.json' "$template"
grep -Fxq 'YNX_MUTATION_FREEZE_FILE=/var/lib/ynx-chain/mutation-freeze.json' "$template"
if grep -Eq '^YNX_YUSD_SANDBOX_API_KEY=' "$template"; then
  echo "YUSD release template must not contain the runtime API key"
  exit 1
fi

api_key=""
if [[ -f "$destination" ]]; then
  api_key="$(sed -n 's/^YNX_YUSD_SANDBOX_API_KEY=//p' "$destination" | tail -1)"
fi
if [[ ! "$api_key" =~ ^[0-9a-f]{64}$ ]]; then
  api_key="$(openssl rand -hex 32)"
fi

temp="$(mktemp)"
cleanup() { rm -f "$temp"; }
trap cleanup EXIT
cp "$template" "$temp"
printf 'YNX_YUSD_SANDBOX_API_KEY=%s\n' "$api_key" >>"$temp"
install -d -m 0750 -o root -g ynx "$(dirname "$destination")"
install -m 0640 -o root -g ynx "$temp" "$destination"
