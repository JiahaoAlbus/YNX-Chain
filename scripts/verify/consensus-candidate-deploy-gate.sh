#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."
# shellcheck source=../ops/lib.sh
source scripts/ops/lib.sh
ynx_ops_init

package_root="${CONSENSUS_CANDIDATE_PACKAGE:-}"
[[ -d "$package_root" ]] || { echo "CONSENSUS_CANDIDATE_PACKAGE is required" >&2; exit 1; }
go run ./cmd/ynx-consensus-package -verify-package "$package_root" >/dev/null
[[ "$(git branch --show-current)" == "main" ]] || { echo "candidate deploy gate requires main branch" >&2; exit 1; }
[[ -z "$(git status --short --untracked-files=no)" ]] || { echo "candidate deploy gate requires no tracked worktree changes" >&2; exit 1; }

preflight_candidate_role() {
  local role="$1" user="$2" host="$3" key="$4" _kind="$5"
  local key_dir="/etc/ynx/consensus-candidate/$role"
  ynx_ops_ssh "$role" "$user" "$host" "$key" "systemctl is-active ynx-chaind >/dev/null && systemctl is-active ynx-consensus-overlay.service >/dev/null && sudo test \"\$(sudo stat -c %a /etc/ynx/consensus-candidate)\" = 750 && sudo test \"\$(sudo stat -c %a '$key_dir/priv_validator_key.json')\" = 600 && sudo test \"\$(sudo stat -c %a '$key_dir/node_key.json')\" = 600 && sudo test ! -e /var/lib/ynx-chain/consensus-candidate && ! systemctl is-active --quiet ynx-consensus-comet-candidate.service && ! systemctl is-active --quiet ynx-consensus-abci-candidate.service && ! ss -ltn | awk '{print \$4}' | grep -Eq ':(27656|27757|27858)$' && test \"\$(df -Pk /var/lib/ynx-chain | awk 'NR==2 {print \$4}')\" -gt 2097152"
}
ynx_ops_each_node preflight_candidate_role

CONSENSUS_OVERLAY_PACKAGE="${CONSENSUS_OVERLAY_PACKAGE:-tmp/consensus-overlay-deploy/package}" \
  bash scripts/verify/verify-consensus-overlay.sh >/dev/null
echo "consensus candidate deploy gate passed: package, strict SSH, host keys, private overlay, free paths/ports, disk, and authoritative service"
