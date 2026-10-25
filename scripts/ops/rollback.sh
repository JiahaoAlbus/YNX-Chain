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
    checks="$checks && test -x '/opt/ynx-chain/releases/$release/bin/ynx-indexerd' && test -x '/opt/ynx-chain/releases/$release/bin/ynx-explorerd' && test -x '/opt/ynx-chain/releases/$release/bin/ynx-faucetd' && test -x '/opt/ynx-chain/releases/$release/bin/ynx-ai-gatewayd' && test -x '/opt/ynx-chain/releases/$release/bin/ynx-payd' && test -x '/opt/ynx-chain/releases/$release/bin/ynx-trustd' && test -x '/opt/ynx-chain/releases/$release/bin/ynx-resourced'"
    installs="$installs && sudo install -m 0755 '/opt/ynx-chain/releases/$release/bin/ynx-indexerd' /usr/local/bin/ynx-indexerd && sudo install -m 0755 '/opt/ynx-chain/releases/$release/bin/ynx-explorerd' /usr/local/bin/ynx-explorerd && sudo install -m 0755 '/opt/ynx-chain/releases/$release/bin/ynx-faucetd' /usr/local/bin/ynx-faucetd && sudo install -m 0755 '/opt/ynx-chain/releases/$release/bin/ynx-ai-gatewayd' /usr/local/bin/ynx-ai-gatewayd && sudo install -m 0755 '/opt/ynx-chain/releases/$release/bin/ynx-payd' /usr/local/bin/ynx-payd && sudo install -m 0755 '/opt/ynx-chain/releases/$release/bin/ynx-trustd' /usr/local/bin/ynx-trustd && sudo install -m 0755 '/opt/ynx-chain/releases/$release/bin/ynx-resourced' /usr/local/bin/ynx-resourced"
    installs="$installs && { if test -s '/opt/ynx-chain/releases/$release/config/ynx-wallet-gatewayd.env' && test -s '/opt/ynx-chain/releases/$release/systemd/ynx-wallet-gatewayd.service' && test -s '/opt/ynx-chain/releases/$release/wallet-gateway/cmd/ynx-wallet-gatewayd/main.mjs'; then sudo install -m 0600 '/opt/ynx-chain/releases/$release/config/ynx-wallet-gatewayd.env' /etc/ynx/ynx-wallet-gatewayd.env && sudo install -m 0644 '/opt/ynx-chain/releases/$release/systemd/ynx-wallet-gatewayd.service' /etc/systemd/system/ynx-wallet-gatewayd.service && sudo systemctl daemon-reload && sudo systemctl restart ynx-wallet-gatewayd; elif test -f /etc/systemd/system/ynx-wallet-gatewayd.service; then sudo systemctl disable --now ynx-wallet-gatewayd && sudo rm -f /etc/systemd/system/ynx-wallet-gatewayd.service /etc/ynx/ynx-wallet-gatewayd.env && sudo systemctl daemon-reload; fi; }"
  fi
  ynx_ops_ssh "$role" "$user" "$host" "$key" "echo '== $role $host =='; $checks && { $installs; for service in $services; do sudo systemctl restart \"\$service\"; systemctl --no-pager --full status \"\$service\"; done; }"
}

ynx_ops_each_node rollback_node
