#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."
# shellcheck source=../deploy/lib.sh
source scripts/deploy/lib.sh

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

flaky_connection() {
  local count=0
  [[ -f "$tmp/count" ]] && count="$(cat "$tmp/count")"
  count=$((count + 1))
  printf '%s' "$count" > "$tmp/count"
  (( count >= 3 )) && return 0
  return 255
}

ordinary_failure() {
  printf x >> "$tmp/ordinary"
  return 1
}

YNX_DEPLOY_CONNECTION_ATTEMPTS=3 YNX_DEPLOY_CONNECTION_RETRY_DELAY_SECONDS=0 \
  ynx_connection_retry "self-test" flaky_connection
[[ "$(cat "$tmp/count")" == "3" ]] || { echo "connection retry did not reach the successful third attempt"; exit 1; }

if YNX_DEPLOY_CONNECTION_ATTEMPTS=3 YNX_DEPLOY_CONNECTION_RETRY_DELAY_SECONDS=0 \
  ynx_connection_retry "self-test" ordinary_failure; then
  echo "ordinary command failure was incorrectly retried as success"
  exit 1
fi
[[ "$(cat "$tmp/ordinary")" == "x" ]] || { echo "ordinary command failure was retried"; exit 1; }

if YNX_DEPLOY_CONNECTION_ATTEMPTS=6 ynx_connection_retry "self-test" true; then
  echo "out-of-range attempt count was accepted"
  exit 1
fi

mkdir -p "$tmp/bin"
cat > "$tmp/bin/ssh" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$@" > "${YNX_FAKE_SSH_LOG:?}"
EOF
cat > "$tmp/bin/scp" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$@" > "${YNX_FAKE_SCP_LOG:?}"
EOF
chmod +x "$tmp/bin/ssh" "$tmp/bin/scp"

export PATH="$tmp/bin:$PATH"
export YNX_FAKE_SSH_LOG="$tmp/ssh.log"
export YNX_FAKE_SCP_LOG="$tmp/scp.log"
export YNX_SSH_CONTROL_DIR="$tmp/control"
SERVER_USER=tester SERVER_HOST=example.invalid SSH_KEY_PATH="$tmp/key" ynx_ssh true
SERVER_USER=tester SERVER_HOST=example.invalid SSH_KEY_PATH="$tmp/key" ynx_scp "$tmp/source" /tmp/dest

[[ "$(stat -f '%Lp' "$tmp/control" 2>/dev/null || stat -c '%a' "$tmp/control")" == "700" ]] || {
  echo "SSH control directory is not mode 0700"
  exit 1
}
for log in "$tmp/ssh.log" "$tmp/scp.log"; do
  grep -Fxq 'IdentitiesOnly=yes' "$log"
  grep -Fxq 'StrictHostKeyChecking=yes' "$log"
  grep -Fxq 'ControlMaster=auto' "$log"
  grep -Fxq 'ControlPersist=60s' "$log"
  grep -Fxq "ControlPath=$tmp/control/ynx-%C" "$log"
done

if YNX_SSH_CONTROL_DIR="$tmp/insecure" YNX_SSH_CONTROL_PERSIST_SECONDS=301 ynx_ssh_control_path >/dev/null 2>&1; then
  echo "out-of-range SSH control persistence was accepted"
  exit 1
fi

echo "deploy-connection-retry-check passed: exit 255 is retried, command failures are not retried, and strict multiplexed SSH transport is bounded"
