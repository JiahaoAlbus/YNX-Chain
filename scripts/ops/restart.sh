#!/usr/bin/env bash
set -euo pipefail

# shellcheck source=lib.sh
source "$(dirname "$0")/lib.sh"
ynx_ops_init

restart_node() {
  local role="$1" user="$2" host="$3" key="$4" kind="$5"
  local services
  services="$(ynx_ops_services_for_kind "$kind")"
  ynx_ops_ssh "$role" "$user" "$host" "$key" "echo '== $role $host =='; for service in $services; do sudo systemctl restart \"\$service\"; systemctl --no-pager --full status \"\$service\"; done"
}

ynx_ops_each_node restart_node
