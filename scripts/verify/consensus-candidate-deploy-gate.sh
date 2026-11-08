#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."
# shellcheck source=../ops/lib.sh
source scripts/ops/lib.sh
ynx_ops_init
source scripts/ops/public-bft-linux-public-tools.sh

package_root="${CONSENSUS_CANDIDATE_PACKAGE:-}"
[[ -d "$package_root" ]] || { echo "CONSENSUS_CANDIDATE_PACKAGE is required" >&2; exit 1; }
public_bft_linux_tools_enabled || [[ "$(uname -s)" == "Linux" && "$(uname -m)" == "x86_64" ]] || { echo "candidate deploy gate requires the pinned Linux amd64 runtime; no native rebuild fallback is allowed" >&2; exit 1; }
# Sourcing defines the exact runtime parser only; it never starts deployment.
source scripts/deploy/deploy-consensus-candidate.sh
runtime_bundle="${CONSENSUS_CANDIDATE_RUNTIME_BUNDLE:-}"
runtime_commit="${CONSENSUS_CANDIDATE_RUNTIME_COMMIT:-}"
runtime_manifest_sha="${CONSENSUS_CANDIDATE_RUNTIME_MANIFEST_SHA256:-}"
if ! public_bft_linux_tools_enabled; then validate_runtime_bundle "$runtime_bundle" "$runtime_commit" "$runtime_manifest_sha"; fi
[[ "$(git rev-parse HEAD)" == "$runtime_commit" ]] || { echo "candidate deploy gate source differs from pinned runtime commit" >&2; exit 1; }
verifier_bundle="$runtime_bundle"
if public_bft_linux_tools_enabled; then
  verifier_bundle="$(mktemp -d "${PUBLIC_BFT_CUTOVER_TRANSACTION_DIR:?}/public-gate.XXXXXXXX")/runtime"
  public_bft_linux_tool inventory "$verifier_bundle"
elif [[ ! -x "$verifier_bundle/ynx-consensus-package" ]]; then
  verifier_bundle="${CONSENSUS_CANDIDATE_GATE_RUNTIME_DESTINATION:-}"
  [[ -n "$verifier_bundle" ]] || { echo "artifact mode requires an explicit fresh retained CONSENSUS_CANDIDATE_GATE_RUNTIME_DESTINATION; source mode is never changed" >&2; exit 1; }
  prepare_runtime_bundle "$runtime_bundle" "$runtime_commit" "$runtime_manifest_sha" "$verifier_bundle"
fi
verify_candidate_package "$verifier_bundle/ynx-consensus-package" "$package_root" >/dev/null
if [[ "$(git branch --show-current)" != main ]]; then
  # The transaction and its deploy gate use one original source-eligibility
  # callee. Projection JSON or an environment boolean cannot approve a ref.
  case "${PUBLIC_BFT_CUTOVER_MODE:-}" in execute|continue-native|continue-pq-native) ;; *) echo 'full original transaction phase required at deploy gate' >&2; exit 1;; esac
  node scripts/verify/public-bft-release-source.mjs "${PUBLIC_BFT_CUTOVER_APPROVAL_FILE:?original raw approval required}" "${PUBLIC_BFT_CUSTODY_REVIEW_FILE:?original raw review required}" "$PUBLIC_BFT_CUTOVER_MODE"
fi
[[ -z "$(git status --short --untracked-files=no)" ]] || { echo "candidate deploy gate requires no tracked worktree changes" >&2; exit 1; }

preflight_candidate_role() {
  local role="$1" user="$2" host="$3" key="$4" _kind="$5"
  local key_dir="/etc/ynx/consensus-candidate/$role" candidate_port_pattern=':(27656|27660|27757|27858)$' port_guard
  [[ "$role" != primary ]] || candidate_port_pattern=':(27620|27656|27660|27757|27858)$'
  port_guard="candidate_listen_output=\$(LC_ALL=C ss -H -ltn) || { printf '%s\\n' 'cannot read candidate listening ports' >&2; exit 1; }
[ -n \"\$candidate_listen_output\" ] || { printf '%s\\n' 'candidate listening port output is empty' >&2; exit 1; }
candidate_port_state=\$(printf '%s' \"\$candidate_listen_output\" | awk -v candidate_ports='$candidate_port_pattern' '
  NF != 5 || \$1 != \"LISTEN\" || \$2 !~ /^[0-9]+$/ || \$3 !~ /^[0-9]+$/ || \$4 !~ /^[^[:space:]]+:[1-9][0-9]*$/ || \$5 !~ /^[^[:space:]]+:(\\*|[0-9]+)$/ { invalid=1; exit }
  { port=\$4; sub(/^.*:/, \"\", port); if (port+0 < 1 || port+0 > 65535) { invalid=1; exit }; if (\$4 ~ candidate_ports) occupied=1 }
  END { if (invalid) exit 2; if (occupied) print \"occupied\"; else print \"free\" }
') || { printf '%s\\n' 'cannot parse candidate listening ports' >&2; exit 1; }
[ \"\$candidate_port_state\" = free ] || { printf '%s\\n' 'candidate port already listening' >&2; exit 1; }"
  echo "candidate deploy gate checking $role"
  if [[ -n "${CONSENSUS_CANDIDATE_OPERATOR_PLAN_SHA256:-}" ]]; then
    # Retain original operator key/HRS isolation; this is read-only preflight.
    ynx_ops_ssh "$role" "$user" "$host" "$key" "set -eu
systemctl is-active ynx-chaind >/dev/null; systemctl is-active ynx-consensus-overlay.service >/dev/null; sudo test ! -e /var/lib/ynx-chain/consensus-candidate; sudo test ! -L /var/lib/ynx-chain/consensus-candidate; sudo test ! -e /etc/systemd/system/ynx-consensus-operator-candidate.service; sudo test ! -L /etc/systemd/system/ynx-consensus-operator-candidate.service; ! systemctl is-active --quiet ynx-consensus-operator-candidate.service; ! systemctl is-active --quiet ynx-consensus-comet-candidate.service; ! systemctl is-active --quiet ynx-consensus-abci-candidate.service
$port_guard
test \"\$(df -Pk /var/lib/ynx-chain | awk 'NR==2 {print \$4}')\" -gt 2097152"
    return
  fi
  ynx_ops_ssh "$role" "$user" "$host" "$key" "set -eu
systemctl is-active ynx-chaind >/dev/null; systemctl is-active ynx-consensus-overlay.service >/dev/null; sudo test \"\$(sudo stat -c %a /etc/ynx/consensus-candidate)\" = 750; sudo test \"\$(sudo stat -c %a '$key_dir/priv_validator_key.json')\" = 600; sudo test \"\$(sudo stat -c %a '$key_dir/priv_validator_state.json')\" = 600; sudo test \"\$(sudo stat -c %a '$key_dir/node_key.json')\" = 600; sudo test ! -e /var/lib/ynx-chain/consensus-candidate; ! systemctl is-active --quiet ynx-consensus-comet-candidate.service; ! systemctl is-active --quiet ynx-consensus-abci-candidate.service
$port_guard
test \"\$(df -Pk /var/lib/ynx-chain | awk 'NR==2 {print \$4}')\" -gt 2097152"
}
ynx_ops_each_node preflight_candidate_role

CONSENSUS_OVERLAY_PACKAGE="${CONSENSUS_OVERLAY_PACKAGE:-tmp/consensus-overlay-deploy/package}" \
  CONSENSUS_OVERLAY_PACKAGE_MANIFEST_SHA256="${CONSENSUS_OVERLAY_PACKAGE_MANIFEST_SHA256:-}" \
  bash scripts/verify/verify-consensus-overlay.sh >/dev/null
echo "consensus candidate deploy gate passed: package, strict SSH, host keys, private overlay, free paths/ports, disk, and authoritative service"
