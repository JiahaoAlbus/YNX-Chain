#!/usr/bin/env bash
set -Eeuo pipefail

# Separate from first native import. The three explicit phases never initialize
# an App, generate a key, approve a registration, undo HRS, or retry UNKNOWN.
operator_transition_driver() {
  [[ "$#" == 1 && ( "$1" == quiesce || "$1" == install || "$1" == start ) ]] || return 64
  local phase="$1" repo tx work approval approval_pin old_package old_pin next_package next_pin
  repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
  cd "$repo"
  source scripts/ops/lib.sh
  ynx_ops_init
  source scripts/deploy/deploy-consensus-candidate.sh
  source scripts/ops/remote/public-bft-operator-transition.sh
  [[ "${DEPLOY_DRY_RUN:-0}" == 0 ]] || operator_transition_fail 'no dry-run can produce stopped/installed/started authority; use the isolated source controls'
  [[ "$(uname -s)" == Linux && "$(uname -m)" == x86_64 ]] || operator_transition_fail 'the original pinned Linux amd64 tools are required; no rebuild fallback'
  tx="${YNX_OPERATOR_TRANSITION_ID:-}"; work="${YNX_OPERATOR_TRANSITION_WORK_ROOT:-}"
  approval="${YNX_OPERATOR_TRANSITION_APPROVAL:-}"; approval_pin="${YNX_OPERATOR_TRANSITION_APPROVAL_SHA256:-}"
  old_package="${YNX_OPERATOR_OLD_PACKAGE:-}"; old_pin="${YNX_OPERATOR_OLD_PLAN_SHA256:-}"
  next_package="${YNX_OPERATOR_NEXT_PACKAGE:--}"; next_pin="${YNX_OPERATOR_NEXT_PLAN_SHA256:--}"
  local old_bundle="${YNX_OPERATOR_OLD_RUNTIME_BUNDLE:-}" old_commit="${YNX_OPERATOR_OLD_RUNTIME_COMMIT:-}" old_manifest="${YNX_OPERATOR_OLD_RUNTIME_MANIFEST_SHA256:-}"
  local bundle="${YNX_OPERATOR_RUNTIME_BUNDLE:-}" commit="${YNX_OPERATOR_RUNTIME_COMMIT:-}" manifest="${YNX_OPERATOR_RUNTIME_MANIFEST_SHA256:-}"
  [[ "$tx" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$ && "$work" =~ ^/[A-Za-z0-9._/-]+$ && "$work" != *..* && -d "$work" && ! -L "$work" && "$(realpath -e "$work")" == "$work" ]] || operator_transition_fail 'existing canonical private work parent and transition identity required'
  [[ "$(stat -c %a "$work")" == 700 && "$(stat -c %u "$work")" == "$(id -u)" ]] || operator_transition_fail 'work parent must be private and owned by this operator'
  for file in "$approval" "$old_package/common/operator-plan.json"; do [[ "$file" == /* ]]; operator_transition_file "$file"; done
  [[ "$commit" =~ ^[0-9a-f]{40}$ && "$(git rev-parse HEAD)" == "$commit" ]] || operator_transition_fail 'caller source differs from independently pinned tool runtime commit'
  git ls-files --error-unmatch scripts/ops/public-bft-operator-transition.sh scripts/ops/remote/public-bft-operator-transition.sh >/dev/null
  git diff --quiet HEAD -- scripts/ops/public-bft-operator-transition.sh scripts/ops/remote/public-bft-operator-transition.sh || operator_transition_fail 'uncommitted transition code is not an approved deployment caller'
  validate_runtime_bundle "$old_bundle" "$old_commit" "$old_manifest"
  validate_runtime_bundle "$bundle" "$commit" "$manifest"
  local root="$work/$tx" phase_root
  umask 077
  if [[ "$phase" == quiesce ]]; then mkdir -m 0700 "$root"; else test -d "$root" && test ! -L "$root"; fi
  phase_root="$root/$phase-attempt"
  mkdir -m 0700 "$phase_root" || operator_transition_fail 'phase already attempted, including uncertain local/remote results; reconcile the original instead of resending'
  prepare_runtime_bundle "$bundle" "$commit" "$manifest" "$phase_root/runtime"
  local verifier="$phase_root/runtime/ynx-consensus-package"
  "$verifier" -verify-package "$old_package" -operator-plan-hash "$old_pin" >"$phase_root/old-package-validation.txt"
  if [[ "$phase" != quiesce ]]; then "$verifier" -verify-package "$next_package" -operator-plan-hash "$next_pin" >"$phase_root/new-package-validation.txt"; fi
  # Bind all four roles BEFORE dispatching a single host mutation. Old/new
  # paths, original identity, exact P/U/A, approvals and checkpoint are fixed.
  local role
  for role in primary singapore silicon-valley seoul; do
    operator_transition_binding "$phase" "$tx" "$role" "$approval" "$approval_pin" "$old_package" "$old_pin" "$old_bundle/SOURCE.json" "$old_commit" "$old_manifest" "$next_package" "$next_pin" "$bundle/SOURCE.json" "$commit" "$manifest" >"$phase_root/$role.binding.json"
  done
  if [[ "$phase" != quiesce ]]; then
    python3 -B - "$phase_root" "$root" <<'PY'
import json,pathlib,sys
p,r=map(pathlib.Path,sys.argv[1:])
for role in ('primary','singapore','silicon-valley','seoul'):
    b=json.loads((p/(role+'.binding.json')).read_bytes()); old=json.loads((r/'quiesce-attempt'/(role+'.result.json')).read_bytes())
    assert old['version']=='YNX-OPERATOR-TRANSITION-RESULT/v1' and old['status']=='stopped'
    for k in ('transitionId','role','oldOperatorPlanSHA256','oldRuntimeCommit','oldRuntimeManifestSHA256','backupSHA256'): assert b[k]==old[k]
    for k,v in b['checkpoint'].items(): assert old['checkpoint'][k]==v
    if b['phase']=='start':
        installed=json.loads((r/'install-attempt'/(role+'.result.json')).read_bytes())
        assert installed['status']=='installed_not_started'
        for k in ('transitionId','role','nextOperatorPlanSHA256','runtimeCommit','runtimeManifestSHA256','backupSHA256'): assert b[k]==installed[k]
        for k,v in b['checkpoint'].items(): assert installed['checkpoint'][k]==v
PY
  fi
  local helper_pin old_comet_pin comet_pin verifier_pin keycheck_pin binding="$phase_root/primary.binding.json"
  helper_pin="$(operator_transition_sha scripts/ops/remote/public-bft-operator-transition.sh)"
  old_comet_pin="$(operator_transition_value oldCometSHA256)"; comet_pin="$(operator_transition_value cometSHA256)"
  verifier_pin="$(operator_transition_value packageVerifierSHA256)"; keycheck_pin="$(operator_transition_value keycheckSHA256)"
  # Shared public stage contains complete normally verified packages; no keys,
  # HRS, vaults or recovery credentials are copied from a signer host.
  local payload="$phase_root/payload" archive="$phase_root/source.tar.gz" archive_pin size
  mkdir -m 0700 "$payload" "$payload/bin"
  cp scripts/ops/remote/public-bft-operator-transition.sh "$payload/helper.sh"
  cp "$approval" "$payload/approval.json"
  if [[ "$phase" == quiesce ]]; then
    local freezes="${YNX_OPERATOR_TRANSITION_FREEZE_MARKERS:-}"
    [[ "$freezes" == /* && -d "$freezes" && ! -L "$freezes" ]] || operator_transition_fail 'four independently approved existing freeze marker files are required'
    mkdir -m 0700 "$payload/freeze-markers"
    for role in primary singapore silicon-valley seoul; do
      operator_transition_file "$freezes/$role.json"
      binding="$phase_root/$role.binding.json"
      [[ "$(operator_transition_sha "$freezes/$role.json")" == "$(operator_transition_value freezeSHA256)" ]] || operator_transition_fail 'freeze marker differs from independent approval'
      cp "$freezes/$role.json" "$payload/freeze-markers/$role.json"
    done
    binding="$phase_root/primary.binding.json"
  fi
  cp "$old_bundle/SOURCE.json" "$payload/old-SOURCE.json"; cp "$bundle/SOURCE.json" "$payload/SOURCE.json"
  cp "$phase_root/runtime/ynx-comet" "$phase_root/runtime/ynx-consensus-package" "$phase_root/runtime/ynx-consensus-keycheck" "$payload/bin/"
  cp -R "$old_package" "$payload/old-package"
  if [[ "$phase" != quiesce ]]; then cp -R "$next_package" "$payload/new-package"; fi
  (set -o noclobber; tar -czf - -C "$payload" . >"$archive")
  archive_pin="$(operator_transition_sha "$archive")"; size="$(du -sk "$payload" | awk '{printf "%.0f\n", $1*1024}')"
  # Normal transport and original host-key verification remain in lib.sh.
  # Every remote destination is reserved before cat-based copy can write it.
  dispatch_operator_transition() {
    local role="$1" user="$2" host="$3" key="$4" _kind="$5"
    local remote_parent="/opt/ynx-chain/operator-transitions/$tx/$role" remote_stage
    remote_stage="$remote_parent/$phase"
    local upload="$remote_stage/source.tar.gz" extracted="$remote_stage/source"
    ynx_ops_ssh "$role" "$user" "$host" "$key" "set -Eeuo pipefail; umask 077; sudo mkdir -p '$remote_parent'; sudo test \"\$(realpath -e '$remote_parent')\" = '$remote_parent'; free=\$(df -PB1 '$remote_parent' | awk 'NR==2 {print \$4}'); test \"\$free\" -gt '$((size * 2 + 1073741824))'; sudo mkdir -m 0700 '$remote_stage'; sudo chown \"\$(id -un)\" '$remote_stage'; (set -o noclobber; : > '$upload')" >"$phase_root/$role.reserve.txt"
    ynx_ops_copy "$role" "$user" "$host" "$key" "$archive" "$upload"
    # Mark dispatch before SSH: lost replies are UNKNOWN even if no remote
    # success receipt reached this host. No phase retries or automatic undo.
    (set -o noclobber; printf '%s\n' "$archive_pin" >"$phase_root/$role.dispatched")
    ynx_ops_ssh "$role" "$user" "$host" "$key" "set -Eeuo pipefail; printf '%s  %s\\n' '$archive_pin' '$upload' | sha256sum --strict -c - >/dev/null; sudo mkdir -m 0700 '$extracted'; sudo tar -xzf '$upload' -C '$extracted'; sudo chmod 0755 '$extracted/bin/ynx-comet' '$extracted/bin/ynx-consensus-package' '$extracted/bin/ynx-consensus-keycheck'; sudo bash '$extracted/helper.sh' '$phase' '$tx' '$role' '$extracted' '$approval_pin' '$old_pin' '$old_commit' '$old_manifest' '$next_pin' '$commit' '$manifest' '$helper_pin' '$archive_pin' '$old_comet_pin' '$comet_pin' '$verifier_pin' '$keycheck_pin'" >"$phase_root/$role.result.partial" 2>"$phase_root/$role.error.txt"
    python3 -B - "$phase_root/$role.binding.json" "$phase_root/$role.result.partial" <<'PY'
import json,sys
b,r=(json.load(open(p)) for p in sys.argv[1:]); assert r['version']=='YNX-OPERATOR-TRANSITION-RESULT/v1'
for k in ('transitionId','phase','role','approvalSHA256','oldOperatorPlanSHA256','nextOperatorPlanSHA256','oldRuntimeCommit','oldRuntimeManifestSHA256','runtimeCommit','runtimeManifestSHA256'): assert b[k]==r[k]
assert r['status']=={'quiesce':'stopped','install':'installed_not_started','start':'started_activation_unproven'}[b['phase']]
assert r['originalMaterialRetained'] is True and r['pqActivationVerified'] is False and r['independentFinalityVerified'] is False
PY
    ln "$phase_root/$role.result.partial" "$phase_root/$role.result.json"
  }
  if [[ "$phase" == quiesce ]]; then
    # Sequential stops can leave the first node one block behind a remaining
    # quorum. Dispatch the four normal stop callers together; still require
    # exact equal DB checkpoints afterwards, never round a lagging height up.
    local -a transition_pids=()
    dispatch_operator_transition_async() { dispatch_operator_transition "$@" & transition_pids+=("$!"); }
    ynx_ops_each_node dispatch_operator_transition_async
    local pid first_failure=0 status
    for pid in "${transition_pids[@]}"; do
      if wait "$pid"; then :; else status="$?"; if [[ "$first_failure" == 0 ]]; then first_failure="$status"; fi; fi
    done
    if [[ "$first_failure" != 0 ]]; then echo 'quiesce has failed/UNKNOWN roles; preserve every original attempt without resume or retry' >&2; return "$first_failure"; fi
    python3 -B - "$phase_root" <<'PY'
import json,pathlib,sys
p=pathlib.Path(sys.argv[1]); expected=None
for role in ('primary','singapore','silicon-valley','seoul'):
    c=json.loads((p/(role+'.result.json')).read_bytes())['checkpoint']
    key=tuple(c[k] for k in ('chainId','height','appHash','appVersion','registryRoot','registryEventCount','consensusGenesisSHA256','stateLayout'))
    if expected is None: expected=key
    if key!=expected: raise SystemExit('original stopped checkpoints differ; all files retained, explicit reconciliation required, no automatic bootstrap restart')
PY
  else
    ynx_ops_each_node dispatch_operator_transition
  fi
  printf 'operator transition phase=%s complete; original state/HRS retained; activation and independent finality are not established by process status\n' "$phase"
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then operator_transition_driver "$@"; fi
