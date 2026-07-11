#!/usr/bin/env bash
set -euo pipefail

# shellcheck source=lib.sh
source "$(dirname "$0")/lib.sh"
ynx_ops_init
release="${ROLLBACK_RELEASE:-}"
[[ -n "$release" ]] || { echo "Missing required env: ROLLBACK_RELEASE"; exit 1; }

rollback_node() {
  local role="$1" user="$2" host="$3" key="$4" kind="$5"
  local services
  services="$(ynx_ops_services_for_kind "$kind")"
  local checks="test -x '/opt/ynx-chain/releases/$release/bin/ynx-chaind'"
  local installs="sudo install -m 0755 '/opt/ynx-chain/releases/$release/bin/ynx-chaind' /usr/local/bin/ynx-chaind"
  if [[ "$kind" == "full" ]]; then
    checks="$checks && test -x '/opt/ynx-chain/releases/$release/bin/ynx-indexerd' && test -x '/opt/ynx-chain/releases/$release/bin/ynx-explorerd' && test -x '/opt/ynx-chain/releases/$release/bin/ynx-faucetd' && test -x '/opt/ynx-chain/releases/$release/bin/ynx-ai-gatewayd' && test -x '/opt/ynx-chain/releases/$release/bin/ynx-payd'"
    installs="$installs && sudo install -m 0755 '/opt/ynx-chain/releases/$release/bin/ynx-indexerd' /usr/local/bin/ynx-indexerd && sudo install -m 0755 '/opt/ynx-chain/releases/$release/bin/ynx-explorerd' /usr/local/bin/ynx-explorerd && sudo install -m 0755 '/opt/ynx-chain/releases/$release/bin/ynx-faucetd' /usr/local/bin/ynx-faucetd && sudo install -m 0755 '/opt/ynx-chain/releases/$release/bin/ynx-ai-gatewayd' /usr/local/bin/ynx-ai-gatewayd && sudo install -m 0755 '/opt/ynx-chain/releases/$release/bin/ynx-payd' /usr/local/bin/ynx-payd"
  fi
  ynx_ops_ssh "$role" "$user" "$host" "$key" "echo '== $role $host =='; $checks && { $installs; for service in $services; do sudo systemctl restart \"\$service\"; systemctl --no-pager --full status \"\$service\"; done; }"
}

ynx_ops_each_node rollback_node
