#!/usr/bin/env bash
set -euo pipefail

ynx_ops_init() {
  cd "$(dirname "${BASH_SOURCE[0]}")/../.." || exit 1
  # shellcheck source=../deploy/lib.sh
  source scripts/deploy/lib.sh
  ynx_load_env
  PRIMARY_NODE_HOST="${PRIMARY_NODE_HOST:-${SERVER_HOST:-}}"
  PRIMARY_NODE_USER="${PRIMARY_NODE_USER:-${SERVER_USER:-}}"
  PRIMARY_NODE_SSH_KEY="${PRIMARY_NODE_SSH_KEY:-${SSH_KEY_PATH:-}}"
  SG_NODE_HOST="${SG_NODE_HOST:-43.134.23.58}"
  SG_NODE_USER="${SG_NODE_USER:-root}"
  SG_NODE_SSH_KEY="${SG_NODE_SSH_KEY:-${PRIMARY_NODE_SSH_KEY:-}}"
  SILICON_VALLEY_NODE_HOST="${SILICON_VALLEY_NODE_HOST:-43.162.100.54}"
  SILICON_VALLEY_NODE_USER="${SILICON_VALLEY_NODE_USER:-ubuntu}"
  SILICON_VALLEY_NODE_SSH_KEY="${SILICON_VALLEY_NODE_SSH_KEY:-${PRIMARY_NODE_SSH_KEY:-}}"
  SEOUL_NODE_HOST="${SEOUL_NODE_HOST:-43.164.132.81}"
  SEOUL_NODE_USER="${SEOUL_NODE_USER:-root}"
  SEOUL_NODE_SSH_KEY="${SEOUL_NODE_SSH_KEY:-${PRIMARY_NODE_SSH_KEY:-}}"
  ynx_require_env PRIMARY_NODE_HOST PRIMARY_NODE_USER PRIMARY_NODE_SSH_KEY SG_NODE_HOST SG_NODE_USER SG_NODE_SSH_KEY SILICON_VALLEY_NODE_HOST SILICON_VALLEY_NODE_USER SILICON_VALLEY_NODE_SSH_KEY SEOUL_NODE_HOST SEOUL_NODE_USER SEOUL_NODE_SSH_KEY
}

ynx_ops_each_node() {
  local callback="$1"
  "$callback" primary "$PRIMARY_NODE_USER" "$PRIMARY_NODE_HOST" "$PRIMARY_NODE_SSH_KEY" full
  "$callback" singapore "$SG_NODE_USER" "$SG_NODE_HOST" "$SG_NODE_SSH_KEY" validator
  "$callback" silicon-valley "$SILICON_VALLEY_NODE_USER" "$SILICON_VALLEY_NODE_HOST" "$SILICON_VALLEY_NODE_SSH_KEY" validator
  "$callback" seoul "$SEOUL_NODE_USER" "$SEOUL_NODE_HOST" "$SEOUL_NODE_SSH_KEY" validator
}

ynx_ops_ssh() {
  local role="$1" user="$2" host="$3" key="$4"
  shift 4
  local remote="${user}@${host}"
  if [[ "${DEPLOY_DRY_RUN:-0}" == "1" ]]; then
    printf 'DRY RUN [%s] ssh -i %q %q' "$role" "$key" "$remote"
    printf ' %q' "$@"
    printf '\n'
    return 0
  fi
  ssh -i "$key" -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new "$remote" "$@"
}

ynx_ops_services_for_kind() {
  local kind="$1"
  if [[ "$kind" == "full" ]]; then
    printf 'ynx-chaind ynx-indexerd ynx-explorerd ynx-faucetd'
  else
    printf 'ynx-chaind'
  fi
}
