#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."
# shellcheck source=../ops/lib.sh
source scripts/ops/lib.sh
ynx_ops_init

package_root="${CONSENSUS_CANDIDATE_PACKAGE:-}"
[[ -d "$package_root" ]] || { echo "CONSENSUS_CANDIDATE_PACKAGE is required" >&2; exit 1; }
[[ "$(uname -s)" == "Linux" && "$(uname -m)" == "x86_64" ]] || { echo "candidate deploy gate requires the pinned Linux amd64 runtime; no native rebuild fallback is allowed" >&2; exit 1; }
# Sourcing defines the exact runtime parser only; it never starts deployment.
source scripts/deploy/deploy-consensus-candidate.sh
runtime_bundle="${CONSENSUS_CANDIDATE_RUNTIME_BUNDLE:-}"
runtime_commit="${CONSENSUS_CANDIDATE_RUNTIME_COMMIT:-}"
runtime_manifest_sha="${CONSENSUS_CANDIDATE_RUNTIME_MANIFEST_SHA256:-}"
validate_runtime_bundle "$runtime_bundle" "$runtime_commit" "$runtime_manifest_sha"
[[ "$(git rev-parse HEAD)" == "$runtime_commit" ]] || { echo "candidate deploy gate source differs from pinned runtime commit" >&2; exit 1; }
verifier_bundle="$runtime_bundle"
if [[ ! -x "$verifier_bundle/ynx-consensus-package" ]]; then
  verifier_bundle="${CONSENSUS_CANDIDATE_GATE_RUNTIME_DESTINATION:-}"
  [[ -n "$verifier_bundle" ]] || { echo "artifact mode requires an explicit fresh retained CONSENSUS_CANDIDATE_GATE_RUNTIME_DESTINATION; source mode is never changed" >&2; exit 1; }
  prepare_runtime_bundle "$runtime_bundle" "$runtime_commit" "$runtime_manifest_sha" "$verifier_bundle"
fi
verify_candidate_package "$verifier_bundle/ynx-consensus-package" "$package_root" >/dev/null
[[ "$(git branch --show-current)" == "main" ]] || { echo "candidate deploy gate requires main branch" >&2; exit 1; }
[[ -z "$(git status --short --untracked-files=no)" ]] || { echo "candidate deploy gate requires no tracked worktree changes" >&2; exit 1; }

preflight_candidate_role() {
  local role="$1" user="$2" host="$3" key="$4" _kind="$5"
  local key_dir="/etc/ynx/consensus-candidate/$role"
  echo "candidate deploy gate checking $role"
  if [[ -n "${CONSENSUS_CANDIDATE_OPERATOR_PLAN_SHA256:-}" ]]; then
    # Original key/HRS paths and remote custody are independently pinned in the
    # operator plan and checked by its actual installer/normal startup. Do not
    # require a remote signer's private key to be copied to this client host.
    ynx_ops_ssh "$role" "$user" "$host" "$key" "systemctl is-active ynx-chaind >/dev/null && systemctl is-active ynx-consensus-overlay.service >/dev/null && sudo test ! -e /var/lib/ynx-chain/consensus-candidate && sudo test ! -L /var/lib/ynx-chain/consensus-candidate && sudo test ! -e /etc/systemd/system/ynx-consensus-operator-candidate.service && sudo test ! -L /etc/systemd/system/ynx-consensus-operator-candidate.service && ! systemctl is-active --quiet ynx-consensus-operator-candidate.service && ! systemctl is-active --quiet ynx-consensus-comet-candidate.service && ! systemctl is-active --quiet ynx-consensus-abci-candidate.service && ! ss -ltn | awk '{print \$4}' | grep -Eq ':(27656|27757|27858)$' && test \"\$(df -Pk /var/lib/ynx-chain | awk 'NR==2 {print \$4}')\" -gt 2097152"
    return
  fi
  ynx_ops_ssh "$role" "$user" "$host" "$key" "systemctl is-active ynx-chaind >/dev/null && systemctl is-active ynx-consensus-overlay.service >/dev/null && sudo test \"\$(sudo stat -c %a /etc/ynx/consensus-candidate)\" = 750 && sudo test \"\$(sudo stat -c %a '$key_dir/priv_validator_key.json')\" = 600 && sudo test \"\$(sudo stat -c %a '$key_dir/priv_validator_state.json')\" = 600 && sudo test \"\$(sudo stat -c %a '$key_dir/node_key.json')\" = 600 && sudo test ! -e /var/lib/ynx-chain/consensus-candidate && ! systemctl is-active --quiet ynx-consensus-comet-candidate.service && ! systemctl is-active --quiet ynx-consensus-abci-candidate.service && ! ss -ltn | awk '{print \$4}' | grep -Eq ':(27656|27757|27858)$' && test \"\$(df -Pk /var/lib/ynx-chain | awk 'NR==2 {print \$4}')\" -gt 2097152"
}
ynx_ops_each_node preflight_candidate_role

CONSENSUS_OVERLAY_PACKAGE="${CONSENSUS_OVERLAY_PACKAGE:-tmp/consensus-overlay-deploy/package}" \
  bash scripts/verify/verify-consensus-overlay.sh >/dev/null
echo "consensus candidate deploy gate passed: package, strict SSH, host keys, private overlay, free paths/ports, disk, and authoritative service"
