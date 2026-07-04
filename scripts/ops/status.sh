#!/usr/bin/env bash
set -euo pipefail

# shellcheck source=lib.sh
source "$(dirname "$0")/lib.sh"
ynx_ops_init

status_node() {
  local role="$1" user="$2" host="$3" key="$4" kind="$5"
  local services
  services="$(ynx_ops_services_for_kind "$kind")"
  local endpoints="curl -fsS http://127.0.0.1:6420/status || true"
  if [[ "$kind" == "full" ]]; then
    endpoints="$endpoints; curl -fsS http://127.0.0.1:6426/health || true; curl -fsS http://127.0.0.1:6427/health || true; curl -fsS http://127.0.0.1:6428/health || true"
  fi
  ynx_ops_ssh "$role" "$user" "$host" "$key" "echo '== $role $host =='; for service in $services; do systemctl --no-pager --full status \"\$service\" || true; done; echo '--- local endpoints'; $endpoints"
}

ynx_ops_each_node status_node
