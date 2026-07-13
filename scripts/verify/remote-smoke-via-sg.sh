#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."
# shellcheck source=../deploy/lib.sh
source scripts/deploy/lib.sh
ynx_load_env

SG_NODE_HOST="${SG_NODE_HOST:-43.134.23.58}"
SG_NODE_USER="${SG_NODE_USER:-root}"
SG_NODE_SSH_KEY="${SG_NODE_SSH_KEY:-${PRIMARY_NODE_SSH_KEY:-${SSH_KEY_PATH:-}}}"
PRIMARY_NODE_HOST="${PRIMARY_NODE_HOST:-${SERVER_HOST:-}}"
ynx_require_env SG_NODE_HOST SG_NODE_USER SG_NODE_SSH_KEY PRIMARY_NODE_HOST
[[ -r "$SG_NODE_SSH_KEY" ]] || { echo "Singapore SSH key is not readable: $SG_NODE_SSH_KEY"; exit 1; }

local_port="$(node -e 'const s=require("node:net").createServer();s.listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close()})')"
work="$(mktemp -d)"
tunnel_log="$work/tunnel.log"
tunnel_pid=""

cleanup() {
  if [[ -n "$tunnel_pid" ]] && kill -0 "$tunnel_pid" 2>/dev/null; then
    kill "$tunnel_pid" 2>/dev/null || true
    wait "$tunnel_pid" 2>/dev/null || true
  fi
  rm -rf "$work"
}
trap cleanup EXIT INT TERM

ssh -N -i "$SG_NODE_SSH_KEY" \
  -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes \
  -o ConnectTimeout=10 -o ServerAliveInterval=15 -o ServerAliveCountMax=4 \
  -o ExitOnForwardFailure=yes \
  -L "127.0.0.1:${local_port}:${PRIMARY_NODE_HOST}:443" \
  "${SG_NODE_USER}@${SG_NODE_HOST}" >"$tunnel_log" 2>&1 &
tunnel_pid=$!

ready=0
for _ in $(seq 1 20); do
  if ! kill -0 "$tunnel_pid" 2>/dev/null; then
    cat "$tunnel_log" >&2
    echo "Singapore proof tunnel exited before becoming ready" >&2
    exit 1
  fi
  if nc -z 127.0.0.1 "$local_port" >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 0.5
done
[[ "$ready" == "1" ]] || { cat "$tunnel_log" >&2; echo "Singapore proof tunnel did not become ready" >&2; exit 1; }

echo "running remote smoke through operator-controlled Singapore cross-region route"
YNX_REMOTE_CONNECT_HOST=127.0.0.1 \
YNX_REMOTE_CONNECT_PORT="$local_port" \
YNX_REMOTE_PROOF_ROUTE="operator-controlled-cross-region:ssh:singapore" \
  bash scripts/verify/remote-smoke-test.sh
