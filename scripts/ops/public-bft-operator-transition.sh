#!/usr/bin/env bash
set -Eeuo pipefail

# Separate from first native import. The three explicit phases never initialize
# an App, generate a key, approve a registration, undo HRS, or retry UNKNOWN.
operator_transition_quiesce_all() {
  local -a transition_pids=()
  dispatch_operator_transition_async() { dispatch_operator_transition "$@" & transition_pids+=("$!"); }
  local pid first_failure=0 status
  for transition_action in prepare complete; do
    transition_pids=()
    ynx_ops_each_node dispatch_operator_transition_async
    for pid in "${transition_pids[@]}"; do
      if wait "$pid"; then :; else status="$?"; if [[ "$first_failure" == 0 ]]; then first_failure="$status"; fi; fi
    done
    if [[ "$first_failure" != 0 ]]; then echo "quiesce $transition_action has failed/UNKNOWN roles; preserve all freezes/requests/attempts without stop, resume or retry" >&2; return "$first_failure"; fi
  done
}

operator_transition_capacity_role() {
  local role="$1" user="$2" host="$3" key="$4"
  local local_root="$phase_root/capacity/$role" small upload remote_stage small_archive small_pin request_pin small_size
  mkdir -m 0700 "$local_root" || return $?
  small="$local_root/source"; small_archive="$local_root/source.tar.gz"
  mkdir -m 0700 "$small" "$small/old-package" "$small/old-package/common" "$small/old-role" "$small/old-role/scripts" "$small/old-role/systemd" || return $?
  cp scripts/ops/remote/public-bft-operator-transition.sh "$small/helper.sh" || return $?
  cp "$approval" "$small/approval.json" || return $?
  cp "$old_bundle/SOURCE.json" "$small/old-SOURCE.json" || return $?
  cp "$bundle/SOURCE.json" "$small/SOURCE.json" || return $?
  cp "$old_package/common/operator-plan.json" "$small/old-package/common/operator-plan.json" || return $?
  cp "$old_package/package-manifest.json" "$small/old-package/package-manifest.json" || return $?
  cp "$old_package/roles/$role/role-manifest.json" "$small/old-role/role-manifest.json" || return $?
  cp "$old_package/roles/$role/scripts/start-operator.sh" "$small/old-role/scripts/start-operator.sh" || return $?
  cp "$old_package/roles/$role/systemd/ynx-consensus-operator-candidate.service" "$small/old-role/systemd/ynx-consensus-operator-candidate.service" || return $?
  python3 -B "$payload_helper" capacity-request --catalog "$payload_plan" --binding "$phase_root/$role.binding.json" --bridge "$bridge" --output "$small/request.json" || return $?
  small_size="$(python3 -B "$payload_helper" capacity-size --directory "$small")" || return $?
  (set -o noclobber; tar -czf - -C "$small" . >"$small_archive") || return $?
  small_pin="$(operator_transition_sha "$small_archive")" || return $?
  request_pin="$(operator_transition_sha "$small/request.json")" || return $?
  remote_stage="/opt/ynx-chain/operator-transitions/$tx/$role/capacity"
  upload="/opt/ynx-chain/operator-transitions/$tx/$role/capacity-source.tar.gz"
  # Exclusive read-only preflight staging is retained even if later capacity
  # fails. It is never a freeze, service mutation, alternate package or retry.
  ynx_ops_ssh "$role" "$user" "$host" "$key" "set -Eeuo pipefail; umask 077; parent='/opt/ynx-chain/operator-transitions/$tx/$role'; sudo mkdir -p \"\$parent\"; sudo test \"\$(realpath -e \"\$parent\")\" = \"\$parent\"; free=\$(df -PB1 \"\$parent\" | awk 'NR==2 {print \$4}'); test \"\$free\" -gt '$((small_size * 2 + 1073741824))'; sudo mkdir -m 0700 '$remote_stage'; sudo bash -c 'set -o noclobber; : > \"\$1\"' _ '$upload'; sudo chown \"\$(id -un)\" '$upload'" >"$local_root/reserve.txt" || return $?
  ynx_ops_copy "$role" "$user" "$host" "$key" "$small_archive" "$upload" || return $?
  (set -o noclobber; printf '%s\n' "$request_pin" >"$local_root/dispatched") || return $?
  operator_transition_sync "$local_root/dispatched" "$local_root" || return $?
  (set -o noclobber; ynx_ops_ssh "$role" "$user" "$host" "$key" "set -Eeuo pipefail; printf '%s  %s\\n' '$small_pin' '$upload' | sha256sum --strict -c - >/dev/null; sudo tar --no-same-owner -xzf '$upload' -C '$remote_stage'; printf '%s  %s\\n' '$helper_pin' '$remote_stage/helper.sh' '$request_pin' '$remote_stage/request.json' | sudo sha256sum --strict -c - >/dev/null; sudo bash '$remote_stage/helper.sh' capacity '$tx' '$role' '$remote_stage' '$approval_pin' '$old_pin' '$old_commit' '$old_manifest' '$commit' '$manifest' '$helper_pin' '$request_pin'" >"$local_root/receipt.partial" 2>"$local_root/error.txt") || return $?
  python3 -B "$payload_helper" capacity-accept --request "$small/request.json" --receipt "$local_root/receipt.partial" --binding "$phase_root/$role.binding.json" || return $?
  # Copy the original stdout without reserialization; each remains single-link.
  (set -o noclobber; cat "$local_root/receipt.partial" >"$local_root/receipt.json") || return $?
  operator_transition_sync "$local_root/receipt.json" "$local_root" || return $?
}

operator_transition_capacity_all() {
  mkdir -m 0700 "$phase_root/capacity" || return $?
  # Probe all four independent original hosts without a freeze. Explicit
  # status retention prevents Bash conditional/last-callback masking.
  local first_failure=0 code
  if operator_transition_capacity_role primary "$PRIMARY_NODE_USER" "$PRIMARY_NODE_HOST" "$PRIMARY_NODE_SSH_KEY"; then :; else code=$?; first_failure="$code"; fi
  if operator_transition_capacity_role singapore "$SG_NODE_USER" "$SG_NODE_HOST" "$SG_NODE_SSH_KEY"; then :; else code=$?; [[ "$first_failure" != 0 ]] || first_failure="$code"; fi
  if operator_transition_capacity_role silicon-valley "$SILICON_VALLEY_NODE_USER" "$SILICON_VALLEY_NODE_HOST" "$SILICON_VALLEY_NODE_SSH_KEY"; then :; else code=$?; [[ "$first_failure" != 0 ]] || first_failure="$code"; fi
  if operator_transition_capacity_role seoul "$SEOUL_NODE_USER" "$SEOUL_NODE_HOST" "$SEOUL_NODE_SSH_KEY"; then :; else code=$?; [[ "$first_failure" != 0 ]] || first_failure="$code"; fi
  [[ "$first_failure" == 0 ]] || return "$first_failure"
  mkdir -m 0700 "$payload/capacity-receipts" || return $?
  local role
  for role in primary singapore silicon-valley seoul; do
    cp "$phase_root/capacity/$role/receipt.json" "$payload/capacity-receipts/$role.json" || return $?
  done
  python3 -B "$payload_helper" capacity-set --directory "$phase_root/capacity" --bindings "$phase_root" --output "$payload/capacity-receipts/manifest.json" || return $?
}

operator_transition_driver() {
  [[ "$#" == 1 && ( "$1" == quiesce || "$1" == install || "$1" == start ) ]] || return 64
  local phase="$1" repo tx work approval approval_pin old_package old_pin next_package next_pin
  repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
  cd "$repo"
  source scripts/ops/lib.sh
  ynx_ops_init
  source scripts/deploy/deploy-consensus-candidate.sh
  source scripts/ops/remote/public-bft-operator-transition.sh
  source scripts/ops/public-bft-linux-public-tools.sh
  local bridge=0
  if public_bft_linux_tools_enabled; then bridge=1; fi
  [[ "${DEPLOY_DRY_RUN:-0}" == 0 ]] || operator_transition_fail 'no dry-run can produce stopped/installed/started authority; use the isolated source controls'
  [[ "$bridge" == 1 || ( "$(uname -s)" == Linux && "$(uname -m)" == x86_64 ) ]] || operator_transition_fail 'the original pinned Linux amd64 tools are required; no rebuild fallback'
  tx="${YNX_OPERATOR_TRANSITION_ID:-}"; work="${YNX_OPERATOR_TRANSITION_WORK_ROOT:-}"
  approval="${YNX_OPERATOR_TRANSITION_APPROVAL:-}"; approval_pin="${YNX_OPERATOR_TRANSITION_APPROVAL_SHA256:-}"
  old_package="${YNX_OPERATOR_OLD_PACKAGE:-}"; old_pin="${YNX_OPERATOR_OLD_PLAN_SHA256:-}"
  next_package="${YNX_OPERATOR_NEXT_PACKAGE:--}"; next_pin="${YNX_OPERATOR_NEXT_PLAN_SHA256:--}"
  local old_bundle="${YNX_OPERATOR_OLD_RUNTIME_BUNDLE:-}" old_commit="${YNX_OPERATOR_OLD_RUNTIME_COMMIT:-}" old_manifest="${YNX_OPERATOR_OLD_RUNTIME_MANIFEST_SHA256:-}"
  local bundle="${YNX_OPERATOR_RUNTIME_BUNDLE:-}" commit="${YNX_OPERATOR_RUNTIME_COMMIT:-}" manifest="${YNX_OPERATOR_RUNTIME_MANIFEST_SHA256:-}"
  [[ "$tx" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$ && "$work" =~ ^/[A-Za-z0-9._/-]+$ && "$work" != *..* && -d "$work" && ! -L "$work" ]] || operator_transition_fail 'existing canonical private work parent and transition identity required'
  python3 -B - "$work" <<'PYMODE'
import os,pathlib,stat,sys
p=pathlib.Path(sys.argv[1]);s=p.lstat();assert p.is_absolute() and str(p.resolve(strict=True))==str(p) and stat.S_ISDIR(s.st_mode) and stat.S_IMODE(s.st_mode)==0o700 and s.st_uid==os.geteuid()
PYMODE
  for file in "$approval" "$old_package/common/operator-plan.json"; do [[ "$file" == /* ]]; operator_transition_file "$file"; done
  [[ "$commit" =~ ^[0-9a-f]{40}$ && "$(git rev-parse HEAD)" == "$commit" ]] || operator_transition_fail 'caller source differs from independently pinned tool runtime commit'
  git ls-files --error-unmatch scripts/ops/public-bft-operator-transition.sh scripts/ops/remote/public-bft-operator-transition.sh scripts/ops/public-bft-transition-payload.py scripts/ops/public-bft-linux-public-tools.py >/dev/null
  git diff --quiet HEAD -- scripts/ops/public-bft-operator-transition.sh scripts/ops/remote/public-bft-operator-transition.sh scripts/ops/public-bft-transition-payload.py scripts/ops/public-bft-linux-public-tools.py || operator_transition_fail 'uncommitted transition code is not an approved deployment caller'
  if [[ "$bridge" == 0 ]]; then
    validate_runtime_bundle "$old_bundle" "$old_commit" "$old_manifest"
    validate_runtime_bundle "$bundle" "$commit" "$manifest"
  else
    [[ "$old_commit" == "$commit" && "$old_manifest" == "$manifest" && "$commit" == "$CONSENSUS_CANDIDATE_RUNTIME_COMMIT" && "$manifest" == "$CONSENSUS_CANDIDATE_RUNTIME_MANIFEST_SHA256" ]] || operator_transition_fail 'bridge transition requires the same independently pinned original runtime'
  fi
  local root="$work/$tx" phase_root
  umask 077
  if [[ "$phase" == quiesce ]]; then mkdir -m 0700 "$root"; else test -d "$root" && test ! -L "$root"; fi
  phase_root="$root/$phase-attempt"
  mkdir -m 0700 "$phase_root" || operator_transition_fail 'phase already attempted, including uncertain local/remote results; reconcile the original instead of resending'
  if [[ "$bridge" == 1 ]]; then
    [[ "${PUBLIC_BFT_CUTOVER_TRANSACTION_DIR##*/}" == "$tx" ]]
    public_bft_linux_tool inventory "$phase_root/runtime"
    old_bundle="$phase_root/runtime"; bundle="$phase_root/runtime"
  else
    prepare_runtime_bundle "$bundle" "$commit" "$manifest" "$phase_root/runtime"
  fi
  local verifier="$phase_root/runtime/ynx-consensus-package"
  public_bft_package_call "$verifier" -verify-package "$old_package" -operator-plan-hash "$old_pin" >"$phase_root/old-package-validation.txt"
  if [[ "$phase" != quiesce ]]; then public_bft_package_call "$verifier" -verify-package "$next_package" -operator-plan-hash "$next_pin" >"$phase_root/new-package-validation.txt"; fi
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
  if [[ "$bridge" == 0 ]]; then cp "$phase_root/runtime/ynx-comet" "$phase_root/runtime/ynx-consensus-package" "$phase_root/runtime/ynx-consensus-keycheck" "$payload/bin/"; fi
  # Retain complete public catalogs, but stream the already verified five
  # original single-link migrations directly. No duplicate local cp-R tree.
  local payload_helper=scripts/ops/public-bft-transition-payload.py
  local payload_plan="$phase_root/payload-plan.json" payload_catalog="$phase_root/payload-catalog.json"
  python3 -B "$payload_helper" inspect --payload "$payload" --old-package "$old_package" --old-pin "$old_pin" --new-package "$next_package" --new-pin "$next_pin" --phase "$phase" --catalog "$payload_plan" || return $?
  if [[ "$phase" == quiesce ]]; then
    # Every role must pass the complete cumulative original-source capacity
    # check before the first freeze/phase dispatch on any role.
    operator_transition_capacity_all || return $?
  else
    python3 -B "$payload_helper" phase-budget --catalog "$payload_plan" --capacity "$root/quiesce-attempt/capacity" --bindings "$phase_root" --phase "$phase" --bridge "$bridge" || return $?
  fi
  python3 -B "$payload_helper" inspect --payload "$payload" --old-package "$old_package" --old-pin "$old_pin" --new-package "$next_package" --new-pin "$next_pin" --phase "$phase" --catalog "$payload_catalog" || return $?
  python3 -B "$payload_helper" pack --payload "$payload" --old-package "$old_package" --old-pin "$old_pin" --new-package "$next_package" --new-pin "$next_pin" --phase "$phase" --catalog "$payload_catalog" --archive "$archive" || return $?
  archive_pin="$(operator_transition_sha "$archive")"
  size="$(python3 -B -c 'import json,sys;print(json.load(open(sys.argv[1]))["stageBytesBound"])' "$payload_catalog")"
  local transition_action=run
  # Normal transport and original host-key verification remain in lib.sh.
  # Every remote destination is reserved before cat-based copy can write it.
  dispatch_operator_transition() {
    local role="$1" user="$2" host="$3" key="$4" _kind="$5"
    local remote_parent="/opt/ynx-chain/operator-transitions/$tx/$role" remote_stage
    remote_stage="$remote_parent/$phase"
    local upload="$remote_stage/source.tar.gz" extracted="$remote_stage/source" extract_command='' receipt="$role.result"
    if [[ "$transition_action" == prepare ]]; then receipt="$role.prepared"; fi
    if [[ "$transition_action" != complete ]]; then
      ynx_ops_ssh "$role" "$user" "$host" "$key" "set -Eeuo pipefail; umask 077; sudo mkdir -p '$remote_parent'; sudo test \"\$(realpath -e '$remote_parent')\" = '$remote_parent'; free=\$(df -PB1 '$remote_parent' | awk 'NR==2 {print \$4}'); test \"\$free\" -gt '$((size * 2 + 1073741824))'; sudo mkdir -m 0700 '$remote_stage'; sudo chown \"\$(id -un)\" '$remote_stage'; (set -o noclobber; : > '$upload')" >"$phase_root/$role.reserve.txt"
      ynx_ops_copy "$role" "$user" "$host" "$key" "$archive" "$upload"
      if [[ "$bridge" == 1 ]]; then
        ynx_ops_ssh "$role" "$user" "$host" "$key" "set -Eeuo pipefail; printf '%s  %s\\n' '$archive_pin' '$upload' | sha256sum --strict -c - >/dev/null; sudo mkdir -m 0700 '$extracted'; sudo tar -xzf '$upload' -C '$extracted'; sudo chmod 0700 '$extracted/bin'" >"$phase_root/$role.stage.txt"
        public_bft_linux_stage "$role" "transition-$phase"
      else
        extract_command="sudo mkdir -m 0700 '$extracted'; sudo tar -xzf '$upload' -C '$extracted'; sudo chmod 0755 '$extracted/bin/ynx-comet' '$extracted/bin/ynx-consensus-package' '$extracted/bin/ynx-consensus-keycheck';"
      fi
    fi
    # Mark dispatch before SSH: lost replies are UNKNOWN even if no remote
    # success receipt reached this host. No phase retries or automatic undo.
    (set -o noclobber; printf '%s\n' "$archive_pin" >"$phase_root/$role.$transition_action.dispatched")
    operator_transition_sync "$phase_root/$role.$transition_action.dispatched" "$phase_root"
    (set -o noclobber; ynx_ops_ssh "$role" "$user" "$host" "$key" "set -Eeuo pipefail; printf '%s  %s\\n' '$archive_pin' '$upload' | sha256sum --strict -c - >/dev/null; $extract_command sudo bash '$extracted/helper.sh' '$phase' '$tx' '$role' '$extracted' '$approval_pin' '$old_pin' '$old_commit' '$old_manifest' '$next_pin' '$commit' '$manifest' '$helper_pin' '$archive_pin' '$old_comet_pin' '$comet_pin' '$verifier_pin' '$keycheck_pin' '$transition_action'" >"$phase_root/$receipt.partial" 2>"$phase_root/$role.$transition_action.error.txt")
    python3 -B - "$phase_root/$role.binding.json" "$phase_root/$receipt.partial" "$transition_action" <<'PY'
import json,sys
b,r=(json.load(open(p)) for p in sys.argv[1:3]); assert r['version']=='YNX-OPERATOR-TRANSITION-RESULT/v1'
for k in ('transitionId','phase','role','approvalSHA256','oldOperatorPlanSHA256','nextOperatorPlanSHA256','oldRuntimeCommit','oldRuntimeManifestSHA256','runtimeCommit','runtimeManifestSHA256','quiesceMode','heightHaltSessionId','futureTargetHeight'): assert b[k]==r[k]
assert r['status']==('prepared_not_stopped' if sys.argv[3]=='prepare' else {'quiesce':'stopped','install':'installed_not_started','start':'started_activation_unproven'}[b['phase']])
if sys.argv[3]=='prepare': assert r['checkpoint'] is None and r['backupSHA256'] is None
elif b['phase']=='quiesce' and b['quiesceMode']=='height-halt': assert r['checkpoint']['height']==b['futureTargetHeight']
assert r['originalMaterialRetained'] is True and r['pqActivationVerified'] is False and r['independentFinalityVerified'] is False
PY
    ln "$phase_root/$receipt.partial" "$phase_root/$receipt.json"
    operator_transition_sync "$phase_root/$receipt.json" "$phase_root"
  }
  if [[ "$phase" == quiesce ]]; then
    # No role publishes a halt request (or stops a legacy operator) until all
    # four live original processes and independently approved freezes pass.
    operator_transition_quiesce_all
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


operator_transition_sync() {
  python3 -B - "$@" <<'PY'
import os,sys
for p in sys.argv[1:]:
    fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW)
    try:os.fsync(fd)
    finally:os.close(fd)
PY
}

operator_light_capture_driver() {
  [[ "$#" == 1 ]] || return 64
  local phase="$1" repo root tx work approval approval_pin packet packet_pin bootstrap bootstrap_pin
  [[ "$phase" == capture || "$phase" == resume ]] || return 64
  repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"; cd "$repo"
  source scripts/ops/lib.sh; ynx_ops_init
  source scripts/deploy/deploy-consensus-candidate.sh
  source scripts/ops/remote/public-bft-operator-transition.sh
  source scripts/ops/public-bft-linux-public-tools.sh
  [[ "${DEPLOY_DRY_RUN:-0}" == 0 ]] || operator_transition_fail 'no dry-run capture/resume'
  tx="${YNX_OPERATOR_TRANSITION_ID:-}"; work="${YNX_OPERATOR_TRANSITION_WORK_ROOT:-}"
  approval="${YNX_OPERATOR_TRANSITION_APPROVAL:-}"; approval_pin="${YNX_OPERATOR_TRANSITION_APPROVAL_SHA256:-}"
  root="${PUBLIC_BFT_CUTOVER_TRANSACTION_DIR:-}"
  bootstrap="${YNX_OPERATOR_OLD_PACKAGE:-}/common/operator-plan.json"; bootstrap_pin="${YNX_OPERATOR_OLD_PLAN_SHA256:-}"
  packet="${YNX_OPERATOR_CONTINUATION_INPUT:-}"; packet_pin="${YNX_OPERATOR_CONTINUATION_INPUT_SHA256:-}"
  local bundle="${YNX_OPERATOR_RUNTIME_BUNDLE:-}" commit="${YNX_OPERATOR_RUNTIME_COMMIT:-}" manifest="${YNX_OPERATOR_RUNTIME_MANIFEST_SHA256:-}"
  [[ "$commit" =~ ^[0-9a-f]{40}$ && "$(git rev-parse HEAD)" == "$commit" ]] || operator_transition_fail 'exact runtime/source caller required'
  git diff --quiet HEAD -- scripts/ops/public-bft-operator-transition.sh scripts/ops/remote/public-bft-operator-transition.sh scripts/ops/public-bft-quiet-continuation.py
  local phase_root="$work/$tx/$phase-attempt" bridge=0 runtime
  python3 -B - "$root" "$work" "$tx" <<'PY'
import os,pathlib,re,stat,sys
assert re.fullmatch('[A-Za-z0-9][A-Za-z0-9._-]{7,127}',sys.argv[3])
for n in sys.argv[1:3]:
 p=pathlib.Path(n);s=p.lstat();assert p.is_absolute() and str(p.resolve(strict=True))==n and stat.S_ISDIR(s.st_mode) and stat.S_IMODE(s.st_mode)==0o700 and s.st_uid==os.geteuid()
assert pathlib.Path(sys.argv[1]).name==sys.argv[3]
p=pathlib.Path(sys.argv[2])/sys.argv[3];assert p.is_dir() and not p.is_symlink()
PY
  umask 077; mkdir -m 0700 "$phase_root" || operator_transition_fail 'phase/UNKNOWN exists; reconcile original without redispatch'
  runtime="$phase_root/runtime"
  if public_bft_linux_tools_enabled; then
    bridge=1
    [[ "$commit" == "$CONSENSUS_CANDIDATE_RUNTIME_COMMIT" && "$manifest" == "$CONSENSUS_CANDIDATE_RUNTIME_MANIFEST_SHA256" ]]
    public_bft_linux_tool inventory "$runtime"
  else
    [[ "$(uname -s)" == Linux && "$(uname -m)" == x86_64 ]]
    prepare_runtime_bundle "$bundle" "$commit" "$manifest" "$runtime"
  fi
  local binding="$phase_root/binding.json" current_package role output
  (set -o noclobber; python3 -B scripts/ops/public-bft-quiet-continuation.py capture-binding --transaction "$root" --plan "$bootstrap" --plan-sha256 "$bootstrap_pin" --input "$packet" --input-sha256 "$packet_pin" --approval "$approval" --approval-sha256 "$approval_pin" --phase "$phase" --runtime "$runtime" >"$binding")
  [[ "$(operator_transition_value transitionId)" == "$tx" && "$(operator_transition_value runtimeCommit)" == "$commit" && "$(operator_transition_value runtimeManifestSHA256)" == "$manifest" ]]
  role="$(operator_transition_value role)"; output="$(operator_transition_value output)"
  current_package="$(python3 -B -c 'import json,sys;print(json.load(open(sys.argv[1]))["currentPackage"])' "$packet")"
  [[ "$(python3 -B -c 'import json,sys;print(json.load(open(sys.argv[1]))["transitionRoot"])' "$packet")" == "$work/$tx" ]]
  public_bft_package_call "$runtime/ynx-consensus-package" -verify-package "$current_package" -operator-plan-hash "$(operator_transition_value operatorPlanSHA256)" >"$phase_root/package-validation.txt"
  local payload="$phase_root/payload" archive="$phase_root/source.tar.gz" archive_pin size binding_pin helper_pin quiet_pin
  mkdir -m 0700 "$payload" "$payload/bin"
  cp "$binding" "$payload/binding.json"; cp "$approval" "$payload/approval.json"; cp "$runtime/SOURCE.json" "$payload/SOURCE.json"
  cp "$root/approval.json" "$payload/cutover-approval.json"
  local source_plan; source_plan="$(python3 -B -c 'import json,sys;print(json.load(open(sys.argv[1]))["proof"]["sourcePlan"])' "$packet")"
  cp "$source_plan" "$payload/source-plan.json"
  cp scripts/ops/remote/public-bft-operator-transition.sh "$payload/helper.sh"; cp scripts/ops/public-bft-quiet-continuation.py "$payload/quiet.py"
  cp -R "$current_package" "$payload/current-package"
  if [[ "$bridge" == 0 ]]; then cp "$runtime/ynx-comet" "$runtime/ynx-consensus-package" "$runtime/ynx-consensus-keycheck" "$payload/bin/"; fi
  binding_pin="$(operator_transition_sha "$binding")"; helper_pin="$(operator_transition_sha "$payload/helper.sh")"; quiet_pin="$(operator_transition_sha "$payload/quiet.py")"
  (set -o noclobber; tar -czf - -C "$payload" . >"$archive")
  archive_pin="$(operator_transition_sha "$archive")"; size="$(du -sk "$payload" | awk '{printf "%.0f\n", $1*1024}')"
  # Existing one-role inventory selection and transport; never dispatch peer
  # roles or copy a host's private App/HRS/custody into coordinator storage.
  capture_selected_role() {
    local selected="$1" user="$2" host="$3" key="$4" _kind="$5"
    [[ "$selected" == "$role" ]] || return 0
    local remote="/opt/ynx-chain/operator-transitions/$tx/$role/$phase" extracted upload
    extracted="$remote/source"; upload="$remote/source.tar.gz"
    ynx_ops_ssh "$role" "$user" "$host" "$key" "set -Eeuo pipefail; umask 077; sudo test -d '/opt/ynx-chain/operator-transitions/$tx/$role'; test \"\$(df -PB1 /opt/ynx-chain | awk 'NR==2 {print \$4}')\" -gt '$((size*2+1073741824))'; sudo mkdir -m 0700 '$remote'; sudo chown \"\$(id -un)\" '$remote'; (set -o noclobber; : > '$upload')" >"$phase_root/$role.reserve.txt"
    ynx_ops_copy "$role" "$user" "$host" "$key" "$archive" "$upload"
    ynx_ops_ssh "$role" "$user" "$host" "$key" "set -Eeuo pipefail; printf '%s  %s\\n' '$archive_pin' '$upload' | sha256sum --strict -c - >/dev/null; sudo mkdir -m 0700 '$extracted'; sudo tar -xzf '$upload' -C '$extracted'; sudo chmod 0700 '$extracted' '$extracted/bin'" >"$phase_root/$role.stage.txt"
    if [[ "$bridge" == 1 ]]; then public_bft_linux_stage "$role" "transition-$phase"; else
      ynx_ops_ssh "$role" "$user" "$host" "$key" "sudo chmod 0755 '$extracted/bin/ynx-comet' '$extracted/bin/ynx-consensus-package' '$extracted/bin/ynx-consensus-keycheck'" >"$phase_root/$role.permissions.txt"
    fi
    (set -o noclobber; printf '%s\n' "$archive_pin" >"$phase_root/$role.dispatched")
    operator_transition_sync "$phase_root/$role.dispatched" "$phase_root"
    (set -o noclobber; ynx_ops_ssh "$role" "$user" "$host" "$key" "sudo bash '$extracted/helper.sh' light-capture '$phase' '$tx' '$role' '$extracted' '$binding_pin' '$helper_pin' '$quiet_pin' '$manifest' '$archive_pin'" >"$phase_root/$role.result.partial" 2>"$phase_root/$role.error.txt")
    python3 -B - scripts/ops/public-bft-quiet-continuation.py "$binding" "$phase_root/$role.result.partial" "$phase_root/$role.result.json" <<'PY'
import importlib.util,sys
s=importlib.util.spec_from_file_location('q',sys.argv[1]);q=importlib.util.module_from_spec(s);s.loader.exec_module(q)
q.retain_capture_result(sys.argv[2],sys.argv[3],sys.argv[4])
PY
    operator_transition_sync "$phase_root/$role.result.json" "$phase_root"
  }
  ynx_ops_each_node capture_selected_role
  test -s "$phase_root/$role.result.json"
  printf 'operator %s completed for %s; original public receipt retained; no automatic retry or public ingress change\n' "$phase" "$role"
}


operator_light_reconcile_driver() {
  # Read only the same dispatched phase's fixed small public result. No service
  # action, package math, new operation, export or automatic retry is performed.
  local phase="$1" repo tx work root attempt role binding
  [[ "$phase" == capture || "$phase" == resume ]] || return 64
  repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)";cd "$repo"
  source scripts/ops/lib.sh;ynx_ops_init
  source scripts/ops/remote/public-bft-operator-transition.sh
  tx="${YNX_OPERATOR_TRANSITION_ID:-}";work="${YNX_OPERATOR_TRANSITION_WORK_ROOT:-}"
  [[ "$tx" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$ ]]
  root="$work/$tx/$phase-attempt";binding="$root/binding.json"
  operator_transition_file "$binding"
  role="$(operator_transition_value role)"
  [[ "$role" =~ ^(primary|singapore|silicon-valley|seoul)$ && "$(operator_transition_value phase)" == "$phase" && "$(operator_transition_value transitionId)" == "$tx" ]]
  [[ "$(git rev-parse HEAD)" == "$(operator_transition_value runtimeCommit)" ]]
  git diff --quiet HEAD -- scripts/ops/public-bft-operator-transition.sh scripts/ops/remote/public-bft-operator-transition.sh scripts/ops/public-bft-quiet-continuation.py
  operator_transition_file "$root/$role.dispatched"
  [[ "$(cat "$root/$role.dispatched")" == "$(operator_transition_sha "$root/source.tar.gz")" ]]
  if [[ -e "$root/$role.result.json" || -L "$root/$role.result.json" ]]; then
    python3 -B - scripts/ops/public-bft-quiet-continuation.py "$binding" "$root/$role.result.json" <<'PYDONE'
import importlib.util,sys
s=importlib.util.spec_from_file_location('q',sys.argv[1]);q=importlib.util.module_from_spec(s);s.loader.exec_module(q)
q.retain_capture_result(sys.argv[2],sys.argv[3],sys.argv[3])
PYDONE
    cat "$root/$role.result.json";return
  fi
  python3 -B - scripts/ops/public-bft-quiet-continuation.py "$root" <<'PYROOT'
import importlib.util,sys
s=importlib.util.spec_from_file_location('q',sys.argv[1]);q=importlib.util.module_from_spec(s);s.loader.exec_module(q);q.private_root(sys.argv[2])
PYROOT
  umask 077;attempt="$(mktemp -d "$root/reconcile-read.XXXXXXXX")"
  read_capture_role() {
    local selected="$1" user="$2" host="$3" key="$4" _kind="$5"
    [[ "$selected" == "$role" ]] || return 0
    local file="/var/lib/ynx-chain/operator-transitions/$tx/$role/$phase-attempt/result.json" command
    command="$(python3 -B - "$file" <<'PYCOMMAND'
import shlex,sys
code="""import os,pathlib,stat,sys
p=pathlib.Path(sys.argv[1]);assert str(p.resolve(strict=True))==str(p)
fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW)
try:
 s=os.fstat(fd);assert stat.S_ISREG(s.st_mode) and s.st_uid==0 and stat.S_IMODE(s.st_mode)==0o600 and s.st_nlink==1 and 0<s.st_size<=1048576
 raw=os.read(fd,1048577);a=os.fstat(fd);b=p.lstat();ident=lambda v:(v.st_dev,v.st_ino,v.st_mode,v.st_uid,v.st_nlink,v.st_size,v.st_mtime_ns,v.st_ctime_ns)
 assert len(raw)==s.st_size and ident(s)==ident(a)==ident(b)
 sys.stdout.buffer.write(raw)
finally:os.close(fd)
"""
print('sudo -n /usr/bin/timeout --signal=TERM --kill-after=5 60 /usr/bin/python3 -B -c '+shlex.quote(code)+' '+shlex.quote(sys.argv[1]))
PYCOMMAND
)"
    printf '%s\n' "$command" >"$attempt/command.sh"
    (set -o noclobber;ynx_ops_ssh "$role" "$user" "$host" "$key" "$command" >"$attempt/result.raw" 2>"$attempt/error.txt")
    python3 -B - scripts/ops/public-bft-quiet-continuation.py "$binding" "$attempt/result.raw" "$root/$role.result.json" <<'PYRETAIN'
import importlib.util,sys
s=importlib.util.spec_from_file_location('q',sys.argv[1]);q=importlib.util.module_from_spec(s);s.loader.exec_module(q)
q.retain_capture_result(sys.argv[2],sys.argv[3],sys.argv[4])
PYRETAIN
  }
  ynx_ops_each_node read_capture_role
  test -s "$root/$role.result.json";cat "$root/$role.result.json"
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  case "${1:-}" in
    capture|resume) operator_light_capture_driver "$@" ;;
    reconcile-capture) [[ "$#" == 1 ]] || exit 64; operator_light_reconcile_driver capture ;;
    reconcile-resume) [[ "$#" == 1 ]] || exit 64; operator_light_reconcile_driver resume ;;
    *) operator_transition_driver "$@" ;;
  esac
fi
