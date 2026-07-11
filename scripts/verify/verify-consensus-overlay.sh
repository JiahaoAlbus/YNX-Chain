#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."
# shellcheck source=../ops/lib.sh
source scripts/ops/lib.sh
ynx_ops_init

package="${CONSENSUS_OVERLAY_PACKAGE:-}"
[[ -d "$package/roles" ]] || { echo "CONSENSUS_OVERLAY_PACKAGE is required" >&2; exit 1; }

verify_overlay_role() {
  local role="$1" user="$2" host="$3" key="$4" _kind="$5" peers=""
  case "$role" in
    primary) peers="10.77.42.2 10.77.42.3 10.77.42.4" ;;
    singapore) peers="10.77.42.1 10.77.42.3 10.77.42.4" ;;
    silicon-valley) peers="10.77.42.1 10.77.42.2 10.77.42.4" ;;
    seoul) peers="10.77.42.1 10.77.42.2 10.77.42.3" ;;
  esac
  ynx_ops_ssh "$role" "$user" "$host" "$key" "systemctl is-active ynx-consensus-overlay.service >/dev/null && systemctl is-active ynx-chaind >/dev/null && ip link show ynxwg0 >/dev/null && for peer in $peers; do ping -c 2 -W 2 \"\$peer\" >/dev/null || exit 1; done && sudo wg show ynxwg0 latest-handshakes | awk 'NF==2 && \$2>0 {count++} END {exit count<3}'"
}
ynx_ops_each_node verify_overlay_role
if [[ "${DEPLOY_DRY_RUN:-0}" == "1" ]]; then
  echo "consensus overlay verification dry-run completed; no remote reachability evidence was generated"
else
  echo "consensus overlay verification passed: four roles, three reachable encrypted peers each, authoritative service active"
fi
