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

echo "deploy-connection-retry-check passed: exit 255 is retried within bounds; command failures are not retried"
