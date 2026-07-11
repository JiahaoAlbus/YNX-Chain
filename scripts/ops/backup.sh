#!/usr/bin/env bash
set -euo pipefail

# shellcheck source=lib.sh
source "$(dirname "$0")/lib.sh"
ynx_ops_init
ynx_require_env BACKUP_STORAGE_PATH
stamp="$(date -u +%Y%m%dT%H%M%SZ)"

backup_node() {
  local role="$1" user="$2" host="$3" key="$4" kind="$5"
  local name="ynx-chain-testnet-${stamp}-${role}.tar.gz"
  local extra_paths="/var/lib/ynx-chain/testnet /var/log/ynx-chain /etc/ynx/ynx-chaind.env /etc/systemd/system/ynx-chaind.service /home/ubuntu/.ynx-v2 /root/.ynx-v2 /var/lib/ynx-ops-observer /etc/systemd/system/ynx-v2-peer.service"
  if [[ "$kind" == "full" ]]; then
    extra_paths="$extra_paths /var/lib/ynx-chain/indexer /etc/ynx/ynx-faucetd.env /etc/ynx/ynx-ai-gatewayd.env /etc/systemd/system/ynx-indexerd.service /etc/systemd/system/ynx-explorerd.service /etc/systemd/system/ynx-faucetd.service /etc/systemd/system/ynx-ai-gatewayd.service /etc/systemd/system/ynx-v2-node.service /etc/systemd/system/ynx-v2-indexer.service /etc/systemd/system/ynx-v2-explorer.service /etc/systemd/system/ynx-v2-faucet.service /etc/systemd/system/ynx-v2-ai-gateway.service /etc/systemd/system/ynx-v2-web4-hub.service /etc/systemd/system/ynx-v2-bridge-service.service /etc/systemd/system/caddy.service /etc/nginx/conf.d/ynx-chain.conf /etc/caddy/Caddyfile"
  fi
  ynx_ops_ssh "$role" "$user" "$host" "$key" "sudo install -d -m 0700 '$BACKUP_STORAGE_PATH' && sudo tar --ignore-failed-read -czf '$BACKUP_STORAGE_PATH/$name' $extra_paths 2>/dev/null && sudo ls -lh '$BACKUP_STORAGE_PATH/$name'"
}

ynx_ops_each_node backup_node
