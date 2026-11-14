#!/usr/bin/env bash
set -Eeuo pipefail

cd "$(dirname "$0")/../.."
# shellcheck source=lib.sh
source scripts/ops/lib.sh
ynx_ops_init
# Source only the already reviewed runtime verifier/copy helpers. Sourcing this
# file does not initialize deployment or execute any build or remote command.
source scripts/deploy/deploy-consensus-candidate.sh
source scripts/ops/public-bft-linux-public-tools.sh

action="${1:-rehearse}"
export PUBLIC_BFT_LINUX_TOOL_PHASE="$action"
if [[ "$action" == prepare_testnet_assets ]]; then
  # The explicit asset phase is handled below; it is never inserted into the
  # original automatic cutover/rehearsal sequence.
  testnet_assets_action=true
else
  testnet_assets_action=false
fi
[[ "$testnet_assets_action" == true || "$action" == "capture_snapshot_source" || "$action" == "abort_native_preflight" || "$action" == "rehearse" || "$action" == "preflight" || "$action" == "backup" || "$action" == "freeze_mutations" || "$action" == "unfreeze_mutations" || "$action" == "pause_authoritative" || "$action" == "resume_authoritative" || "$action" == "export_final_snapshot" || "$action" == "derive_frozen_bootstrap" || "$action" == "verify_frozen_snapshot" || "$action" == "initialize_candidate" || "$action" == "deploy_candidate" || "$action" == "start_candidate" || "$action" == "verify_candidate" || "$action" == "verify_pq_continuation" || "$action" == "rollback_candidate" || "$action" == "start_dependencies" || "$action" == "verify_continuity" || "$action" == "rollback_dependencies" || "$action" == "switch_ingress" || "$action" == "verify_public" || "$action" == "rollback_ingress" || "$action" == "verify_recovery" ]] || {
  echo "production driver phase $action is not implemented; public cutover remains blocked" >&2
  exit 64
}

public_bft_native_context() {
  native_commit="$commit"
  native_full_commit=""
  native_binary_pin=""
  native_source_json=""
  native_systemd_json=""
  native_approval_path=""
  native_transaction_id=""
  native_state=/var/lib/ynx-chain/testnet/devnet-state.json
  native_integrity=/var/lib/ynx-chain/testnet/devnet-state.integrity-version
  native_pause=/var/lib/ynx-chain/block-production-pause.json
  native_mutation=/var/lib/ynx-chain/mutation-freeze.json
  [[ -n "${PUBLIC_BFT_CUTOVER_TRANSACTION_DIR:-}" ]] || return 0
  local approved values approved_path="$PUBLIC_BFT_CUTOVER_TRANSACTION_DIR/approval.json"
  local -a approval_mode=()
  # Standalone legacy backup/rehearsal keeps its original same-source contract;
  # no missing file or environment variable can enable an independent native.
  if [[ "${PUBLIC_BFT_CUTOVER_MODE:-}" == abort-native ]]; then
    case "$action" in abort_native_preflight|resume_authoritative|unfreeze_mutations|verify_recovery) ;; *) return 1 ;; esac
    python3 -B scripts/ops/public-bft-quiet-continuation.py abort-check --transaction "$PUBLIC_BFT_CUTOVER_TRANSACTION_DIR" --phase "$action" || return $?
    approved_path="$PUBLIC_BFT_CUTOVER_TRANSACTION_DIR/preparation-approval.json"
    approval_mode=(--prepare-native)
  elif [[ "${PUBLIC_BFT_CUTOVER_MODE:-}:$action" == export-native:export_final_snapshot || "${PUBLIC_BFT_CUTOVER_MODE:-}:$action" == export-native:derive_frozen_bootstrap ]]; then
    [[ ! -e "$approved_path" && ! -L "$approved_path" ]] || { echo 'frozen snapshot phase cannot replace a final approval' >&2; return 1; }
    approved_path="$PUBLIC_BFT_CUTOVER_TRANSACTION_DIR/snapshot-approval.json"
    approval_mode=(--export-native)
  elif [[ ! -e "$approved_path" && ! -L "$approved_path" ]]; then
    approved_path="$PUBLIC_BFT_CUTOVER_TRANSACTION_DIR/preparation-approval.json"
    if [[ ! -e "$approved_path" && ! -L "$approved_path" ]]; then return 0; fi
    case "$action" in preflight|backup|freeze_mutations|pause_authoritative|capture_snapshot_source|prepare_testnet_assets) ;; *) echo "native preparation cannot authorize this phase; retain paused original state" >&2; return 1 ;; esac
    approval_mode=(--prepare-native)
  fi
  [[ -f "$approved_path" && ! -L "$approved_path" ]] || { echo "original protected approval projection must be a regular non-symlink file" >&2; return 1; }
  approved="$(node scripts/verify/validate-public-bft-cutover-approval-evidence.mjs "$approved_path" "$commit" "ynx-bft-gateway-$commit" ${approval_mode[@]+"${approval_mode[@]}"})" || return $?
  values="$(printf '%s' "$approved" | node -e 'let s="";process.stdin.on("data",x=>s+=x);process.stdin.on("end",()=>{const a=JSON.parse(s);if(!a.authoritativeCommit)return;console.log([a.authoritativeCommit,a.authoritativeRelease,a.authoritativeBinarySha256,JSON.stringify(a.authoritativeSource),...Object.values(a.authoritativeSource),Object.hasOwn(a,"authoritativeSystemd")?JSON.stringify(a.authoritativeSystemd):"-"].join("\n"))})')" || return $?
  [[ -n "$values" ]] || return 0
  local identity_line
  local -a identity=()
  while IFS= read -r identity_line; do
    identity+=("$identity_line")
  done <<<"$values"
  (( ${#identity[@]} == 9 )) || { echo "incomplete approved native source identity" >&2; return 1; }
  native_full_commit="${identity[0]}"; native_commit="${native_full_commit:0:12}"
  release="${identity[1]}"; native_binary_pin="${identity[2]}"; native_source_json="${identity[3]}"
  native_approval_path="$approved_path"
  native_transaction_id="$(basename "$PUBLIC_BFT_CUTOVER_TRANSACTION_DIR")"
  native_state="${identity[4]}"; native_integrity="${identity[5]}"; native_pause="${identity[6]}"; native_mutation="${identity[7]}"
  [[ "${identity[8]}" == - ]] || native_systemd_json="${identity[8]}"
  # The original scoped backup covers this precise existing native layout. A
  # different live data directory needs its own preservation implementation,
  # never a service reconfiguration or a new empty DB to fit this contract.
  [[ "$native_state" == /var/lib/ynx-chain/testnet/devnet-state.json ]] || { echo "approved native data path is outside the original scoped backup layout" >&2; return 1; }
  [[ "$native_pause" == /var/lib/ynx-chain/block-production-pause.json && "$native_mutation" == /var/lib/ynx-chain/mutation-freeze.json ]] || { echo "approved marker paths are outside the original shared native/gateway marker contract" >&2; return 1; }
}

public_bft_native_role_context() {
  local role="$1" values
  role_native_full="${native_full_commit:-}"
  role_native_release="$release"
  role_native_binary="${native_binary_pin:-}"
  role_native_state="${native_state:-/var/lib/ynx-chain/testnet/devnet-state.json}"
  role_native_integrity="${native_integrity:-/var/lib/ynx-chain/testnet/devnet-state.integrity-version}"
  role_native_pause="${native_pause:-/var/lib/ynx-chain/block-production-pause.json}"
  role_native_mutation="${native_mutation:-/var/lib/ynx-chain/mutation-freeze.json}"
  role_native_systemd_json=""
  [[ -n "$role_native_full" ]] || return 0
  values="$(node --input-type=module - "$native_approval_path" "$role" <<'NODE'
import fs from 'node:fs';import {roleAuthoritativeIdentity} from './scripts/verify/lib/public-bft-native-source.mjs';
const a=roleAuthoritativeIdentity(JSON.parse(fs.readFileSync(process.argv[2])),process.argv[3]);
console.log([a.authoritativeCommit,a.authoritativeRelease,a.authoritativeBinarySha256,...Object.values(a.authoritativeSource),Object.hasOwn(a,'authoritativeSystemd')?JSON.stringify(a.authoritativeSystemd):'-'].join('\n'));
NODE
)" || return $?
  local identity_line
  local -a identity=()
  while IFS= read -r identity_line; do
    identity+=("$identity_line")
  done <<<"$values"
  (( ${#identity[@]} == 8 )) || { echo "incomplete approved original role identity" >&2; return 1; }
  role_native_full="${identity[0]}"; role_native_release="${identity[1]}"; role_native_binary="${identity[2]}"
  role_native_state="${identity[3]}"; role_native_integrity="${identity[4]}"; role_native_pause="${identity[5]}"; role_native_mutation="${identity[6]}"
  [[ "${identity[7]}" == - ]] || role_native_systemd_json="${identity[7]}"
  [[ "$role_native_state" == /var/lib/ynx-chain/testnet/devnet-state.json && "$role_native_pause" == /var/lib/ynx-chain/block-production-pause.json && "$role_native_mutation" == /var/lib/ynx-chain/mutation-freeze.json ]] || { echo "approved role paths are outside original scoped preservation layout" >&2; return 1; }
}

public_bft_native_qualify() {
  local role="$1" user="$2" host="$3" key="$4" output="$5" tx systemd_arg=""
  public_bft_native_role_context "$role" || return $?
  [[ -n "${native_full_commit:-}" ]] || return 0
  tx="$(basename "$PUBLIC_BFT_CUTOVER_TRANSACTION_DIR")"
  # The normalized closed profile contains only fixed keys, canonical ASCII
  # paths and lowercase hashes; no quote, control or shell syntax is admitted.
  [[ -z "$role_native_systemd_json" ]] || systemd_arg=" '$role_native_systemd_json'"
  # The script is streamed through the existing transport; there is no native
  # install/start/restart or path inferred from the release's build label.
  # Keep any partial observation on error; it cannot authorize a later phase.
  (set -C; ynx_ops_ssh "$role" "$user" "$host" "$key" "sudo env -i PATH=/usr/bin:/bin python3 -B - '$role_native_full' '$role_native_release' '$role_native_binary' '$tx' '$commit' '$role' '$role_native_state' '$role_native_integrity' '$role_native_pause' '$role_native_mutation'$systemd_arg" <scripts/ops/remote/public-bft-native-identity.py >"$output")
}

abort_native_observe_role() {
  local role="$1" user="$2" host="$3" key="$4" _kind="${5:-}" dir request
  dir="$PUBLIC_BFT_CUTOVER_TRANSACTION_DIR/abort-attempt/$action"
  public_bft_native_qualify "$role" "$user" "$host" "$key" "$dir/$role-native.json" || return $?
  request="$(python3 -B scripts/ops/public-bft-quiet-continuation.py abort-observation --transaction "$PUBLIC_BFT_CUTOVER_TRANSACTION_DIR" --role "$role" --phase "$action" --evidence "${BACKUP_STORAGE_PATH:-/var/backups/ynx-chain}/public-bft-cutover/$(basename "$PUBLIC_BFT_CUTOVER_TRANSACTION_DIR")")" || return $?
  # base64 has no shell metacharacters; the remote input has only the exact
  # already-approved public paths and original marker pins, never key bodies.
  (set -C; ynx_ops_ssh "$role" "$user" "$host" "$key" "sudo env -i PATH=/usr/bin:/bin python3 -B - abort-remote-observe --input '$request'" <scripts/ops/public-bft-quiet-continuation.py >"$dir/$role-markers.json") || return $?
  python3 -B scripts/ops/public-bft-quiet-continuation.py abort-observation-result --transaction "$PUBLIC_BFT_CUTOVER_TRANSACTION_DIR" --role "$role" --phase "$action" --evidence "${BACKUP_STORAGE_PATH:-/var/backups/ynx-chain}/public-bft-cutover/$(basename "$PUBLIC_BFT_CUTOVER_TRANSACTION_DIR")" || return $?
}

abort_native_preflight_phase() {
  [[ "${PUBLIC_BFT_CUTOVER_MODE:-}" == abort-native ]] || return 1
  # No unguarded 'each_node' loop: its caller must stop on the first UNKNOWN.
  abort_native_observe_role primary "$PRIMARY_NODE_USER" "$PRIMARY_NODE_HOST" "$PRIMARY_NODE_SSH_KEY" || return $?
  abort_native_observe_role singapore "$SG_NODE_USER" "$SG_NODE_HOST" "$SG_NODE_SSH_KEY" || return $?
  abort_native_observe_role silicon-valley "$SILICON_VALLEY_NODE_USER" "$SILICON_VALLEY_NODE_HOST" "$SILICON_VALLEY_NODE_SSH_KEY" || return $?
  abort_native_observe_role seoul "$SEOUL_NODE_USER" "$SEOUL_NODE_HOST" "$SEOUL_NODE_SSH_KEY" || return $?
}

authoritative_production_phase() {
  local operation="$1"
  if [[ "$operation" == "pause" ]]; then
    [[ "${PUBLIC_BFT_PRODUCTION_PAUSE_APPROVED:-}" == "yes" ]] || {
      echo "PUBLIC_BFT_PRODUCTION_PAUSE_APPROVED=yes is required" >&2
      exit 1
    }
  fi
  [[ "${PUBLIC_BFT_CUTOVER_COMMIT:-}" == "$commit" ]] || {
    echo "authoritative production commit does not match current HEAD" >&2
    exit 1
  }
  local bft_release="ynx-bft-gateway-${commit}"
  [[ "${PUBLIC_BFT_CUTOVER_RELEASE:-}" == "$bft_release" ]] || {
    echo "authoritative production BFT release does not match current HEAD" >&2
    exit 1
  }
  local transaction_dir="${PUBLIC_BFT_CUTOVER_TRANSACTION_DIR:-}"
  [[ -n "$transaction_dir" && -d "$transaction_dir" ]] || {
    echo "PUBLIC_BFT_CUTOVER_TRANSACTION_DIR must be an existing directory" >&2
    exit 1
  }
  if [[ "$operation" == resume && ( -e "$transaction_dir/candidate/initialize-attempt" || -L "$transaction_dir/candidate/initialize-attempt" || -e "$transaction_dir/candidate/start-attempt" || -L "$transaction_dir/candidate/start-attempt" ) ]]; then
    echo "native producer resume is refused after an initialization/start attempt; reconcile original UNKNOWN and writer state without creating a second producer" >&2
    exit 1
  fi
  local transaction_id evidence_dir observation
  transaction_id="$(basename "$transaction_dir")"
  [[ "$transaction_id" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$ ]] || {
    echo "invalid authoritative production transaction id" >&2
    exit 1
  }
  evidence_dir="$transaction_dir/roles"
  mkdir -p "$evidence_dir"
  if [[ "$operation" == "pause" ]]; then
    local role freeze_evidence
    for role in primary singapore silicon-valley seoul; do
      freeze_evidence="$evidence_dir/${role}-freeze.txt"
      test -s "$freeze_evidence"
      grep -Fq "transactionId=$transaction_id" "$freeze_evidence"
      grep -Fq "role=$role" "$freeze_evidence"
      grep -Fq "commit=$commit" "$freeze_evidence"
      grep -Fq "bftRelease=$bft_release" "$freeze_evidence"
      grep -Fq 'mutationStateVerified=true' "$freeze_evidence"
    done
  fi
  observation="${PUBLIC_BFT_PRODUCTION_PAUSE_OBSERVATION_SECONDS:-4}"
  [[ "$observation" =~ ^[0-9]+$ ]] && (( observation >= 1 && observation <= 15 )) || {
    echo "PUBLIC_BFT_PRODUCTION_PAUSE_OBSERVATION_SECONDS must be between 1 and 15" >&2
    exit 1
  }
  local remote_root="${BACKUP_STORAGE_PATH:-/var/backups/ynx-chain}/public-bft-cutover/${transaction_id}"
  local remote_helper="/tmp/ynx-public-bft-authoritative-pause-${transaction_id}.sh"
  if [[ -n "${native_full_commit:-}" ]]; then public_bft_native_qualify primary "$PRIMARY_NODE_USER" "$PRIMARY_NODE_HOST" "$PRIMARY_NODE_SSH_KEY" "$evidence_dir/primary-${operation}-native-identity.json" || return $?; fi
  if [[ "${PUBLIC_BFT_CUTOVER_MODE:-}" == abort-native ]]; then
    [[ ! -e "$evidence_dir/primary-resume-authoritative.txt" && ! -L "$evidence_dir/primary-resume-authoritative.txt" ]] || return 1
    abort_native_observe_role primary "$PRIMARY_NODE_USER" "$PRIMARY_NODE_HOST" "$PRIMARY_NODE_SSH_KEY" || return $?
  fi
  ynx_ops_copy primary "$PRIMARY_NODE_USER" "$PRIMARY_NODE_HOST" "$PRIMARY_NODE_SSH_KEY" scripts/ops/remote/public-bft-authoritative-pause.sh "$remote_helper" || return $?
  ynx_ops_ssh primary "$PRIMARY_NODE_USER" "$PRIMARY_NODE_HOST" "$PRIMARY_NODE_SSH_KEY" "set -euo pipefail; trap 'rm -f \"$remote_helper\"' EXIT; chmod 0700 '$remote_helper'; sudo bash '$remote_helper' '$operation' '$transaction_id' '$commit' '$release' '$bft_release' '${native_pause:-/var/lib/ynx-chain/block-production-pause.json}' '${native_mutation:-/var/lib/ynx-chain/mutation-freeze.json}' '$remote_root' http://127.0.0.1:6420 / '$observation' '${native_full_commit:-}'" >"$evidence_dir/primary-${operation}-authoritative.txt"
  echo "production BFT authoritative $operation passed: transaction=$transaction_id evidence=$evidence_dir"
}

public_bft_runtime_prepare() {
  local parent="$1" retained
  local bundle="${CONSENSUS_CANDIDATE_RUNTIME_BUNDLE:-}"
  local full_commit="${CONSENSUS_CANDIDATE_RUNTIME_COMMIT:-}"
  local manifest_pin="${CONSENSUS_CANDIDATE_RUNTIME_MANIFEST_SHA256:-}"
  public_bft_linux_tools_enabled || [[ "$(uname -s)" == Linux && "$(uname -m)" == x86_64 ]] || { echo "public candidate verifier requires the pinned Linux amd64 runtime; no rebuild fallback" >&2; return 1; }
  [[ "$full_commit" =~ ^[0-9a-f]{40}$ && "$manifest_pin" =~ ^[0-9a-f]{64}$ && "$(git rev-parse HEAD)" == "$full_commit" ]] || { echo "public candidate requires the independent current full runtime commit and SOURCE.json SHA256" >&2; return 1; }
  if ! public_bft_linux_tools_enabled; then validate_runtime_bundle "$bundle" "$full_commit" "$manifest_pin" || return $?; fi
  [[ -d "$parent" && ! -L "$parent" ]] || { echo "original transaction directory is required" >&2; return 1; }
  parent="$(cd "$parent" && pwd -P)" || return $?
  # Retain every verifier copy, including a failed/UNKNOWN preparation. Artifact
  # files may be 0644; only the verified exclusive copy becomes executable.
  retained="$(umask 077; mktemp -d "$parent/runtime-verifier.XXXXXXXX")" || return $?
  if public_bft_linux_tools_enabled; then
    public_bft_linux_tool inventory "$retained/runtime" || return $?
  else
    prepare_runtime_bundle "$bundle" "$full_commit" "$manifest_pin" "$retained/runtime" || return $?
  fi
  public_package_verifier="$retained/runtime/ynx-consensus-package"
  public_bft_linux_tools_enabled || [[ -x "$public_package_verifier" ]] || { echo "verified package verifier is unavailable" >&2; return 1; }
  # Selected only after the original runtime's independent commit/SOURCE pins
  # and all eight ELF bytes have passed the existing normal verifier.
  export PUBLIC_BFT_MIGRATION_VERIFIER="$public_package_verifier"
}

public_bft_operator_inputs() {
  candidate_operator_plan="${PUBLIC_BFT_PRODUCTION_OPERATOR_PLAN:-}"
  candidate_operator_pin="${PUBLIC_BFT_PRODUCTION_OPERATOR_PLAN_SHA256:-}"
  if [[ -n "${native_approval_path:-}" && "$native_approval_path" == "$PUBLIC_BFT_CUTOVER_TRANSACTION_DIR/preparation-approval.json" ]]; then
    candidate_operator_plan="$PUBLIC_BFT_CUTOVER_TRANSACTION_DIR/preparation-operator-plan.json"
    candidate_operator_pin="$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1])).operatorPreparationPlanSha256)' "$native_approval_path")" || return $?
  fi
  [[ "$candidate_operator_plan" == /* && -f "$candidate_operator_plan" && ! -L "$candidate_operator_plan" && "$candidate_operator_pin" =~ ^[0-9a-f]{64}$ && "$candidate_operator_pin" != "$(printf '0%.0s' {1..64})" ]] || { echo "public candidate requires an existing absolute public operator plan and independent nonzero SHA256 pin" >&2; return 1; }
  # Pass the identical external pins into the normal deployment and readback
  # callers. A package's own operatorPlanHash can never select this value.
  export CONSENSUS_CANDIDATE_OPERATOR_PLAN_SHA256="$candidate_operator_pin"
  export PUBLIC_BFT_LINUX_TOOL_OPERATOR_PLAN="$candidate_operator_plan"
}

public_bft_preflight_services() {
  local kind="$1" approved profile
  if [[ -z "${PUBLIC_BFT_CUTOVER_TRANSACTION_DIR:-}" ]]; then
    # The original standalone/full rehearsal keeps its existing service set.
    ynx_ops_services_for_kind "$kind"
    return
  fi
  [[ -n "${PUBLIC_BFT_CUTOVER_APPROVAL_FILE:-}" && -n "${PUBLIC_BFT_CUSTODY_REVIEW_FILE:-}" ]] || { echo "original protected approval and custody evidence are required for scoped preflight" >&2; return 1; }
  local -a approval_mode=()
  [[ "${native_approval_path:-}" != "$PUBLIC_BFT_CUTOVER_TRANSACTION_DIR/preparation-approval.json" ]] || approval_mode=(--prepare-native)
  approved="$(node scripts/verify/validate-public-bft-cutover-approval.mjs "$PUBLIC_BFT_CUTOVER_APPROVAL_FILE" "$commit" "ynx-bft-gateway-$commit" "$PUBLIC_BFT_CUSTODY_REVIEW_FILE" ${approval_mode[@]+"${approval_mode[@]}"})" || return $?
  printf '%s\n' "$approved" | cmp - "${native_approval_path:-$PUBLIC_BFT_CUTOVER_TRANSACTION_DIR/approval.json}" >/dev/null || { echo "preflight profile differs from the original protected approval projection" >&2; return 1; }
  profile="$(printf '%s' "$approved" | node -e 'let s="";process.stdin.on("data",x=>s+=x);process.stdin.on("end",()=>process.stdout.write(JSON.parse(s).custodyProfile || "legacy-full"))')" || return $?
  if [[ "$profile" == single-app-gateway/v1 || "$profile" == single-app-same-owner-inplace/v1 ]]; then
    printf '%s' ynx-chaind
  elif [[ "$profile" == legacy-full ]]; then
    ynx_ops_services_for_kind "$kind"
  else
    echo "unsupported approved preflight custody profile" >&2
    return 1
  fi
}

final_snapshot_phase() {
  [[ "${PUBLIC_BFT_PRODUCTION_SNAPSHOT_APPROVED:-}" == "yes" ]] || {
    echo "PUBLIC_BFT_PRODUCTION_SNAPSHOT_APPROVED=yes is required" >&2
    exit 1
  }
  [[ "${PUBLIC_BFT_CUTOVER_COMMIT:-}" == "$commit" ]] || {
    echo "final snapshot commit does not match current HEAD" >&2
    exit 1
  }
  local bft_release="ynx-bft-gateway-${commit}"
  [[ "${PUBLIC_BFT_CUTOVER_RELEASE:-}" == "$bft_release" ]] || {
    echo "final snapshot BFT release does not match current HEAD" >&2
    exit 1
  }
  local transaction_dir="${PUBLIC_BFT_CUTOVER_TRANSACTION_DIR:-}"
  [[ -n "$transaction_dir" && -d "$transaction_dir" ]] || {
    echo "PUBLIC_BFT_CUTOVER_TRANSACTION_DIR must be an existing directory" >&2
    exit 1
  }
  local transaction_id evidence_dir pause_evidence observation remote_root remote_helper
  local source_input exporter_bundle full_commit source_pin exporter_pin pins local_root remote_stage helper_sha name
  local public_data_root migration_file
  local native_remote_args=""
  local -a native_args=() approval_mode=()
  transaction_id="$(basename "$transaction_dir")"
  [[ "$transaction_id" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$ ]] || { echo "invalid final snapshot transaction id" >&2; exit 1; }
  evidence_dir="$transaction_dir/roles"
  pause_evidence="$evidence_dir/primary-pause-authoritative.txt"
  test -s "$pause_evidence"
  grep -Fq "transactionId=$transaction_id" "$pause_evidence"
  grep -Fq "commit=$commit" "$pause_evidence"
  grep -Fq "bftRelease=$bft_release" "$pause_evidence"
  grep -Fq 'productionStateVerified=true' "$pause_evidence"
  observation="${PUBLIC_BFT_PRODUCTION_SNAPSHOT_OBSERVATION_SECONDS:-2}"
  [[ "$observation" =~ ^[0-9]+$ ]] && (( observation >= 1 && observation <= 15 )) || {
    echo "PUBLIC_BFT_PRODUCTION_SNAPSHOT_OBSERVATION_SECONDS must be between 1 and 15" >&2
    exit 1
  }
  remote_root="${BACKUP_STORAGE_PATH:-/var/backups/ynx-chain}/public-bft-cutover/${transaction_id}"
  source_input="${PUBLIC_BFT_PRODUCTION_SNAPSHOT_SOURCE:-}"
  exporter_bundle="${PUBLIC_BFT_PRODUCTION_EXPORTER_BUNDLE:-}"
  full_commit="$(git rev-parse HEAD)"
  # Validate the original protected approval projection. Environment variables
  # select input locations only; neither the input nor SOURCE can authorize its
  # own hash, and the operator 8-ELF runtime does not contain this exporter.
  local approval_path="$transaction_dir/approval.json"
  if [[ "${PUBLIC_BFT_CUTOVER_MODE:-}" == export-native ]]; then
    approval_path="$transaction_dir/snapshot-approval.json"
    approval_mode=(--export-native)
    [[ "${DEPLOY_DRY_RUN:-0}" != 1 && "$source_input" == "$transaction_dir/snapshot-source-capture/snapshot-source.json" ]] || { echo 'original frozen source capture is required for snapshot-only export' >&2; return 1; }
    [[ -d "$transaction_dir/snapshot-export-attempt" && ! -L "$transaction_dir/snapshot-export-attempt" && -f "$transaction_dir/snapshot-export-attempt/intent.json" && ! -e "$transaction_dir/snapshot-export-attempt/result.json" && ! -L "$transaction_dir/snapshot-export-attempt/result.json" ]] || { echo 'original exclusive snapshot export intent is required' >&2; return 1; }
    # A missing acknowledgement cannot be used to dispatch a second export.
    local YNX_DEPLOY_CONNECTION_ATTEMPTS=1
    export YNX_DEPLOY_CONNECTION_ATTEMPTS
  fi
  pins="$(node scripts/verify/validate-public-bft-cutover-approval-evidence.mjs "$approval_path" "$commit" "$bft_release" ${approval_mode[@]+"${approval_mode[@]}"})"
  source_pin="$(printf '%s' "$pins" | node -e 'let s="";process.stdin.on("data",x=>s+=x);process.stdin.on("end",()=>process.stdout.write(JSON.parse(s).snapshotSourceSha256))')"
  exporter_pin="$(printf '%s' "$pins" | node -e 'let s="";process.stdin.on("data",x=>s+=x);process.stdin.on("end",()=>process.stdout.write(JSON.parse(s).exporterManifestSha256))')"
  public_bft_linux_tools_enabled || [[ "$(uname -s)" == Linux && "$(uname -m)" == x86_64 ]] || { echo "final export requires the approved Linux amd64 offline tools; no installed-binary fallback" >&2; exit 1; }
  for name in "$transaction_dir" "$remote_root"; do
    [[ "$name" =~ ^/[A-Za-z0-9._/-]+$ && "$name" != *..* ]] || { echo "invalid final snapshot staging path" >&2; exit 1; }
  done
  if public_bft_linux_tools_enabled; then
    local exporter_retained
    exporter_retained="$(mktemp -d "$transaction_dir/public-exporter.XXXXXXXX")"
    public_bft_linux_tool_for_role "${PUBLIC_BFT_PRODUCTION_EXPORTER_ROLE:-singapore}" exporter-files "$exporter_bundle" "$exporter_pin" "$exporter_retained/bundle" || return
    exporter_bundle="$exporter_retained/bundle"
  fi
  local_root="$transaction_dir/final-snapshot"
  public_data_root="$(public_bft_public_data_root "$transaction_dir")" || return
  migration_file="$public_data_root/final-snapshot/migration.json"
  if [[ "$public_data_root" != "$transaction_dir" ]]; then
    (umask 077; mkdir -m 0700 "$public_data_root/final-snapshot") || { echo "original public snapshot destination exists/UNKNOWN" >&2; return 1; }
  fi
  if [[ -n "${native_full_commit:-}" ]]; then
    public_bft_native_qualify primary "$PRIMARY_NODE_USER" "$PRIMARY_NODE_HOST" "$PRIMARY_NODE_SSH_KEY" "$evidence_dir/primary-export-native-identity.json"
    native_args=("$native_full_commit" "$native_binary_pin" "$native_source_json")
    native_remote_args=" '$native_full_commit' '$native_binary_pin' '$native_source_json'"
    if [[ -n "$native_systemd_json" ]]; then
      native_args+=("$native_systemd_json")
      native_remote_args+=" '$native_systemd_json'"
    fi
  fi
  # An existing local attempt, even an empty/partial one, prevents redispatch.
  # Preparation reserves this directory exclusively and preserves every error.
  bash scripts/ops/remote/public-bft-final-snapshot.sh --prepare "$source_input" "$exporter_bundle" "$full_commit" "$source_pin" "$exporter_pin" "$transaction_id" "$commit" "$release" "$bft_release" "$local_root" ${native_args[@]+"${native_args[@]}"}
  remote_stage="/tmp/ynx-public-bft-final-snapshot-${transaction_id}"
  remote_helper="$remote_stage/export.sh"
  helper_sha="$(shasum -a 256 scripts/ops/remote/public-bft-final-snapshot.sh | awk '{print $1}')"
  # Atomic fresh directory + noclobber copies: no scp/cat overwrite of an old
  # request or executable, and no EXIT cleanup of uncertain remote effects.
  ynx_ops_ssh primary "$PRIMARY_NODE_USER" "$PRIMARY_NODE_HOST" "$PRIMARY_NODE_SSH_KEY" "umask 077; mkdir -m 0700 '$remote_stage' && mkdir -m 0700 '$remote_stage/tools'"
  ynx_ops_ssh primary "$PRIMARY_NODE_USER" "$PRIMARY_NODE_HOST" "$PRIMARY_NODE_SSH_KEY" "set -C; umask 077; cat > '$remote_helper'" <scripts/ops/remote/public-bft-final-snapshot.sh
  ynx_ops_ssh primary "$PRIMARY_NODE_USER" "$PRIMARY_NODE_HOST" "$PRIMARY_NODE_SSH_KEY" "set -C; umask 077; cat > '$remote_stage/snapshot-source.json'" <"$local_root/snapshot-source.json"
  for name in SOURCE.json ynx-chaind ynx-consensus-package; do
    ynx_ops_ssh primary "$PRIMARY_NODE_USER" "$PRIMARY_NODE_HOST" "$PRIMARY_NODE_SSH_KEY" "set -C; umask 077; cat > '$remote_stage/tools/$name'" <"$local_root/tools/$name"
  done
  (set -C; ynx_ops_ssh primary "$PRIMARY_NODE_USER" "$PRIMARY_NODE_HOST" "$PRIMARY_NODE_SSH_KEY" "set -euo pipefail; test \"\$(sha256sum '$remote_helper' | cut -d' ' -f1)\" = '$helper_sha'; chmod 0700 '$remote_stage/tools/ynx-chaind' '$remote_stage/tools/ynx-consensus-package'; sudo bash '$remote_helper' '$transaction_id' '$commit' '$release' '$bft_release' '${native_pause:-/var/lib/ynx-chain/block-production-pause.json}' '${native_mutation:-/var/lib/ynx-chain/mutation-freeze.json}' '$remote_root' http://127.0.0.1:6420 / '$remote_stage/tools' '$observation' '$remote_stage/snapshot-source.json' '$source_pin' '$exporter_pin' '$full_commit'$native_remote_args" >"$evidence_dir/primary-export-final-snapshot.txt")
  if [[ "${DEPLOY_DRY_RUN:-0}" == "1" ]]; then
    (set -C; printf 'transactionId=%s\ncommit=%s\nrelease=%s\ndryRun=true\n' "$transaction_id" "$commit" "$release" >"$local_root/dry-run.txt")
    echo "production BFT final snapshot dry-run passed: transaction=$transaction_id evidence=$transaction_dir/final-snapshot"
    return
  fi
  (set -C; ynx_ops_ssh primary "$PRIMARY_NODE_USER" "$PRIMARY_NODE_HOST" "$PRIMARY_NODE_SSH_KEY" "sudo cat '$remote_root/final-migration-state.evidence.json'" >"$local_root/remote-evidence.json")
  if public_bft_linux_tools_enabled; then
    local migration_pin
    migration_pin="$(sed -n 's/^sha256=\([0-9a-f]\{64\}\)$/\1/p' "$evidence_dir/primary-export-final-snapshot.txt")"
    [[ "$migration_pin" =~ ^[0-9a-f]{64}$ ]] || { echo 'original final snapshot pin is missing' >&2; return 1; }
    ynx_ops_ssh primary "$PRIMARY_NODE_USER" "$PRIMARY_NODE_HOST" "$PRIMARY_NODE_SSH_KEY" "sudo cat '$remote_root/final-migration-state.json'" | python3 -B scripts/ops/public-bft-linux-public-tools.py retain-migration "$transaction_dir" "$migration_pin" "$full_commit"
  else
    (set -C; ynx_ops_ssh primary "$PRIMARY_NODE_USER" "$PRIMARY_NODE_HOST" "$PRIMARY_NODE_SSH_KEY" "sudo cat '$remote_root/final-migration-state.json'" >"$migration_file")
  fi
  chmod 0600 "$migration_file" "$transaction_dir/final-snapshot/remote-evidence.json"
  local expected_sha actual_sha
  expected_sha="$(sed -n 's/^sha256=\([0-9a-f]\{64\}\)$/\1/p' "$evidence_dir/primary-export-final-snapshot.txt")"
  actual_sha="$(shasum -a 256 "$migration_file" | awk '{print $1}')"
  [[ -n "$expected_sha" && "$actual_sha" == "$expected_sha" ]] || { echo "downloaded final snapshot checksum mismatch" >&2; exit 1; }
  if public_bft_linux_tools_enabled; then
    (set -C; public_bft_package_call "$local_root/tools/ynx-consensus-package" -verify-migration-state "$migration_file" >"$local_root/local-validation.txt")
  else
    (set -C; env -i PATH=/usr/bin:/bin "$local_root/tools/ynx-consensus-package" -verify-migration-state "$migration_file" >"$local_root/local-validation.txt")
  fi
  echo "production BFT final snapshot passed: transaction=$transaction_id evidence=$transaction_dir/final-snapshot"
}

frozen_snapshot_path() {
  local transaction_dir="$1" data_root
  data_root="$(public_bft_public_data_root "$transaction_dir")" || return $?
  printf '%s\n' "$data_root/final-snapshot/migration.json"
}

derive_frozen_bootstrap_phase() {
  [[ "${PUBLIC_BFT_CUTOVER_MODE:-}" == export-native && "${DEPLOY_DRY_RUN:-0}" != 1 ]] || return 1
  local transaction_dir="${PUBLIC_BFT_CUTOVER_TRANSACTION_DIR:?original native transaction required}"
  local validators="${PUBLIC_BFT_PRODUCTION_VALIDATOR_MANIFEST:-}" genesis_time="${PUBLIC_BFT_PRODUCTION_CANDIDATE_GENESIS_TIME:-}" validator_pin migration full_commit
  migration="$(frozen_snapshot_path "$transaction_dir")" || return $?
  full_commit="$(git rev-parse HEAD)" || return $?
  validator_pin="$(node scripts/verify/public-bft-candidate-binding.mjs --frozen-snapshot "$transaction_dir" "$migration" "$full_commit" "$native_approval_path")" || return $?
  [[ "$validators" == /* && "$genesis_time" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$ ]] || { echo 'original public validator manifest and explicit genesis time are required' >&2; return 1; }
  # Keep the exact source provenance and four-role identities. The derive
  # action publishes only DATA for the independently approved final plan.
  [[ -f "$validators" && ! -L "$validators" && "$(shasum -a 256 "$validators" | awk '{print $1}')" == "$validator_pin" ]] || { echo 'validator manifest differs from the reviewed original bytes' >&2; return 1; }
  local runtime_pin
  runtime_pin="$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1])).runtimeManifestSha256)' "$native_approval_path")" || return $?
  [[ "${CONSENSUS_CANDIDATE_RUNTIME_MANIFEST_SHA256:-}" == "$runtime_pin" ]] || { echo 'derivation runtime differs from the independent original approval' >&2; return 1; }
  public_bft_runtime_prepare "$transaction_dir" || return $?
  if public_bft_linux_tools_enabled; then
    public_bft_linux_tool_for_role primary derive-bootstrap "$migration" "$validators" "$validator_pin" "$genesis_time"
  else
    env -i PATH=/usr/bin:/bin "$public_package_verifier" -derive-bootstrap -migration-state "$migration" -validator-manifest "$validators" -genesis-time "$genesis_time"
  fi
}

capture_snapshot_source_phase() {
  [[ "${PUBLIC_BFT_PRODUCTION_SOURCE_CAPTURE_APPROVED:-}" == yes ]] || { echo 'explicit normal snapshot-source capture approval is required' >&2; return 1; }
  [[ "$PRIMARY_NODE_HOST" == 43.153.202.237 && "$PRIMARY_NODE_USER" == ubuntu ]] || { echo 'source capture is scoped to the original primary' >&2; return 1; }
  [[ "${PUBLIC_BFT_CUTOVER_COMMIT:-}" == "$commit" && "${PUBLIC_BFT_CUTOVER_RELEASE:-}" == "ynx-bft-gateway-$commit" ]] || { echo 'source capture version differs from normal preparation' >&2; return 1; }
  local transaction_dir="${PUBLIC_BFT_CUTOVER_TRANSACTION_DIR:-}" tx remote_root preparation_pin
  [[ -n "$transaction_dir" && -d "$transaction_dir" && ! -L "$transaction_dir" ]] || { echo 'original protected transaction is required' >&2; return 1; }
  [[ "${native_approval_path:-}" == "$transaction_dir/preparation-approval.json" && -n "${native_full_commit:-}" && -f "$native_approval_path" && ! -L "$native_approval_path" ]] || { echo 'original normalized native preparation is required; capture cannot manufacture custody or approval' >&2; return 1; }
  tx="$(basename "$transaction_dir")"
  [[ "$tx" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$ ]] || return 1
  remote_root="${BACKUP_STORAGE_PATH:-/var/backups/ynx-chain}/public-bft-cutover/$tx"
  [[ "$remote_root" =~ ^/[A-Za-z0-9._/-]+$ && "$remote_root" != *..* ]] || return 1
  local freeze_pin="${PUBLIC_BFT_PRODUCTION_PRIMARY_FREEZE_SHA256:-}" pause_pin="${PUBLIC_BFT_PRODUCTION_PRIMARY_PAUSE_SHA256:-}" pin
  for pin in "$freeze_pin" "$pause_pin"; do
    [[ "$pin" =~ ^[0-9a-f]{64}$ && "$pin" != "$(printf '0%.0s' {1..64})" ]] || { echo 'independent original freeze/pause evidence pins are required' >&2; return 1; }
  done
  local observation="${PUBLIC_BFT_PRODUCTION_SOURCE_CAPTURE_OBSERVATION_SECONDS:-4}"
  [[ "$observation" =~ ^[0-9]+$ ]] && (( observation >= 1 && observation <= 15 )) || return 1
  local helper=scripts/ops/remote/public-bft-capture-snapshot-source.py native=scripts/ops/remote/public-bft-native-identity.py
  local helper_pin native_pin local_root="$transaction_dir/snapshot-source-capture" remote_stage="/tmp/ynx-public-bft-snapshot-source-$tx"
  helper_pin="$(shasum -a 256 "$helper" | awk '{print $1}')"
  native_pin="$(shasum -a 256 "$native" | awk '{print $1}')"
  preparation_pin="$(shasum -a 256 "$native_approval_path" | awk '{print $1}')"
  local YNX_DEPLOY_CONNECTION_ATTEMPTS=1
  export YNX_DEPLOY_CONNECTION_ATTEMPTS
  (umask 077; mkdir -m 0700 "$local_root") || { echo 'original capture/UNKNOWN attempt exists; retain and reconcile it' >&2; return 1; }
  (set -C; printf 'transactionId=%s\npreparationSHA256=%s\nfreezeSHA256=%s\npauseSHA256=%s\nhelperSHA256=%s\nnativeToolSHA256=%s\nretry=false\n' "$tx" "$preparation_pin" "$freeze_pin" "$pause_pin" "$helper_pin" "$native_pin" >"$local_root/intent.txt")
  ynx_ops_ssh primary "$PRIMARY_NODE_USER" "$PRIMARY_NODE_HOST" "$PRIMARY_NODE_SSH_KEY" "umask 077; mkdir -m 0700 '$remote_stage'"
  ynx_ops_copy primary "$PRIMARY_NODE_USER" "$PRIMARY_NODE_HOST" "$PRIMARY_NODE_SSH_KEY" "$helper" "$remote_stage/public-bft-capture-snapshot-source.py"
  ynx_ops_copy primary "$PRIMARY_NODE_USER" "$PRIMARY_NODE_HOST" "$PRIMARY_NODE_SSH_KEY" "$native" "$remote_stage/public-bft-native-identity.py"
  ynx_ops_copy primary "$PRIMARY_NODE_USER" "$PRIMARY_NODE_HOST" "$PRIMARY_NODE_SSH_KEY" "$native_approval_path" "$remote_stage/preparation-approval.json"
  local remote_command root_body
  root_body="$(cat <<'CAPTURE_ROOT'
set -Eeuo pipefail
umask 077
stage=$1 helper_pin=$2 native_pin=$3 preparation_pin=$4
shift 4
[[ $EUID == 0 && -d $stage && ! -L $stage && $(realpath -e -- "$stage") == "$stage" && $(stat -c %a -- "$stage") == 700 ]]
# First freeze the transport namespace. A copy into a NEW private root dir is
# also needed: chown alone cannot revoke a former owner's already-open writeFD.
chown root:root -- "$stage"
chmod 0700 -- "$stage"
verified="$stage/verified"
mkdir -m 0700 -- "$verified"
for name in public-bft-capture-snapshot-source.py public-bft-native-identity.py preparation-approval.json; do
  [[ -f $stage/$name && ! -L $stage/$name && $(stat -c %h -- "$stage/$name") == 1 ]]
  # Never follow a swapped final symlink. The original caller's public pins
  # qualify only the new root-owned copy, not the mutable transport inode.
  cp -P -- "$stage/$name" "$verified/$name"
  [[ -f $verified/$name && ! -L $verified/$name && $(stat -c '%u:%h' -- "$verified/$name") == 0:1 ]]
  chmod 0600 -- "$verified/$name"
done
[[ $(sha256sum "$verified/public-bft-capture-snapshot-source.py" | cut -d' ' -f1) == "$helper_pin" ]]
[[ $(sha256sum "$verified/public-bft-native-identity.py" | cut -d' ' -f1) == "$native_pin" ]]
[[ $(sha256sum "$verified/preparation-approval.json" | cut -d' ' -f1) == "$preparation_pin" ]]
exec /usr/bin/python3 -B "$verified/public-bft-capture-snapshot-source.py" --preparation-approval "$verified/preparation-approval.json" --preparation-approval-sha256 "$preparation_pin" "$@"
CAPTURE_ROOT
)"
  printf -v remote_command '%q ' sudo -n /usr/bin/timeout --signal=TERM --kill-after=1 25 env -i PATH=/usr/bin:/bin /bin/bash -c "$root_body" bash "$remote_stage" "$helper_pin" "$native_pin" "$preparation_pin" \
    --transaction-id "$tx" \
    --primary-evidence-dir "$remote_root" --primary-pause-sha256 "$pause_pin" --primary-freeze-sha256 "$freeze_pin" \
    --native-identity-sha256 "$native_pin" --output-dir "$remote_root/snapshot-source-capture" --observation-seconds "$observation"
  # Copy only the existing normal producers and already validated projection.
  # No source state, private key/HRS, env, service or marker is modified here.
  (set -C; ynx_ops_ssh primary "$PRIMARY_NODE_USER" "$PRIMARY_NODE_HOST" "$PRIMARY_NODE_SSH_KEY" "$remote_command" >"$local_root/receipt.json.partial")
  # Only the bounded PUBLIC source fingerprint returns over transport. Neither
  # a capture nor its receipt approves the final export or starts any candidate.
  (set -C; ynx_ops_ssh primary "$PRIMARY_NODE_USER" "$PRIMARY_NODE_HOST" "$PRIMARY_NODE_SSH_KEY" "sudo -n head -c 16385 -- '$remote_root/snapshot-source-capture/snapshot-source.json'" >"$local_root/snapshot-source.json.partial")
  if [[ "${DEPLOY_DRY_RUN:-0}" == 1 ]]; then
    echo "source capture dry-run retained: $local_root; no capture or checkpoint authority"
    return 0
  fi
  node --input-type=module - "$local_root" "$tx" "$commit" "$remote_root" "$preparation_pin" "$freeze_pin" "$pause_pin" "$native_pin" <<'NODE'
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import assert from 'node:assert/strict';
const [root,tx,commit,remote,preparation,freeze,pause,native]=process.argv.slice(2);
const bounded=file=>{const p=path.join(root,file),s=fs.lstatSync(p);assert.ok(s.isFile()&&!s.isSymbolicLink()&&s.size>0&&s.size<=16384);return fs.readFileSync(p);};
const receipt=JSON.parse(bounded('receipt.json.partial')),raw=bounded('snapshot-source.json.partial'),source=JSON.parse(raw);
assert.equal(receipt.version,'YNX-PUBLIC-BFT-SNAPSHOT-SOURCE-CAPTURE/v1');assert.equal(receipt.transactionId,tx);assert.equal(receipt.commit,commit);
assert.equal(receipt.preparationApprovalSHA256,preparation);assert.equal(receipt.primaryFreezeEvidenceSHA256,freeze);assert.equal(receipt.primaryPauseEvidenceSHA256,pause);assert.equal(receipt.nativeIdentityToolSHA256,native);
assert.equal(receipt.snapshotSourcePath,remote+'/snapshot-source-capture/snapshot-source.json');assert.equal(receipt.snapshotSourceBytes,raw.length);assert.equal(receipt.snapshotSourceSHA256,crypto.createHash('sha256').update(raw).digest('hex'));
assert.equal(receipt.readOnly,true);for(const name of ['exported','finalApproval','nativeRootAuthorized'])assert.equal(receipt[name],false);
assert.equal(source.version,'YNX-PUBLIC-BFT-SNAPSHOT-SOURCE/v1');assert.equal(source.transactionId,tx);assert.equal(source.commit,commit);assert.equal(source.bftRelease,'ynx-bft-gateway-'+commit);
// Successful publication cannot retain a .partial alias: the original
// continue-native guard correctly rejects every partial/UNKNOWN in this tree.
// Rename only these verified local public results; failures keep all originals.
for(const name of ['snapshot-source.json','receipt.json']){
  const destination=path.join(root,name);let absent=false;try{fs.lstatSync(destination);}catch(error){if(error.code==='ENOENT')absent=true;else throw error;}assert.equal(absent,true,'original publication/UNKNOWN exists');
  fs.renameSync(destination+'.partial',destination);const fd=fs.openSync(destination,'r');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  }
const fd=fs.openSync(root,'r');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
NODE
  echo "source capture completed: $local_root; final snapshot authorization, export and activation remain separate"
}

prepare_testnet_assets_phase() {
  [[ "${PUBLIC_BFT_TESTNET_ASSET_PREPARATION_APPROVED:-}" == yes ]] || { echo "explicit testnet asset preparation approval is required" >&2; return 1; }
  local phase="${PUBLIC_BFT_TESTNET_ASSET_PHASE:-}"
  [[ "$phase" == extract-public-identity || "$phase" == archive-original-assets ]] || { echo "select exactly one testnet asset phase" >&2; return 1; }
  [[ "$PRIMARY_NODE_HOST" == 43.153.202.237 && "$PRIMARY_NODE_USER" == ubuntu ]] || { echo "testnet asset preparation is scoped to the original primary" >&2; return 1; }
  [[ "${PUBLIC_BFT_CUTOVER_COMMIT:-}" == "$commit" && "${PUBLIC_BFT_CUTOVER_RELEASE:-}" == "ynx-bft-gateway-$commit" ]] || { echo "asset preparation version differs from normal cutover" >&2; return 1; }
  local transaction_dir="${PUBLIC_BFT_CUTOVER_TRANSACTION_DIR:-}" tx source source_pin freeze_pin pause_pin identity_pin
  [[ -n "$transaction_dir" && -d "$transaction_dir" && ! -L "$transaction_dir" ]] || { echo "original protected transaction directory is required" >&2; return 1; }
  tx="$(basename "$transaction_dir")"
  [[ "$tx" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$ ]] || return 1
  local remote_root="${BACKUP_STORAGE_PATH:-/var/backups/ynx-chain}/public-bft-cutover/$tx"
  [[ "$remote_root" =~ ^/[A-Za-z0-9._/-]+$ && "$remote_root" != *..* ]] || return 1
  source="${PUBLIC_BFT_TESTNET_ASSET_SNAPSHOT_SOURCE:-}"
  source_pin="${PUBLIC_BFT_TESTNET_ASSET_SNAPSHOT_SOURCE_SHA256:-}"
  freeze_pin="${PUBLIC_BFT_TESTNET_ASSET_PRIMARY_FREEZE_SHA256:-}"
  pause_pin="${PUBLIC_BFT_TESTNET_ASSET_PRIMARY_PAUSE_SHA256:-}"
  [[ "$source" == "$remote_root/"* && "$source" == */snapshot-source.json && "$source" =~ ^/[A-Za-z0-9._/-]+$ && "$source" != *..* ]] || { echo "existing normal snapshot-source path is required" >&2; return 1; }
  local pin
  for pin in "$source_pin" "$freeze_pin" "$pause_pin"; do
    [[ "$pin" =~ ^[0-9a-f]{64}$ && "$pin" != "$(printf '0%.0s' {1..64})" ]] || { echo "independent source/freeze/pause pins are required" >&2; return 1; }
  done
  local -a identity_args=()
  if [[ "$phase" == archive-original-assets ]]; then
    identity_pin="${PUBLIC_BFT_TESTNET_ASSET_PUBLIC_IDENTITY_SHA256:-}"
    [[ "$identity_pin" =~ ^[0-9a-f]{64}$ && "$identity_pin" != "$(printf '0%.0s' {1..64})" ]] || { echo "independent original extraction pin is required before archive" >&2; return 1; }
    local original_pid="${PUBLIC_BFT_TESTNET_ASSET_ORIGINAL_PID:-}"
    [[ "$original_pid" =~ ^[1-9][0-9]{0,9}$ ]] || { echo "original PID from the current normal stop evidence is required" >&2; return 1; }
    identity_args=(--public-identity "$remote_root/testnet-assets-extract-public-identity/public-identity.json" --public-identity-sha256 "$identity_pin" --original-pid "$original_pid")
  else
    [[ -z "${PUBLIC_BFT_TESTNET_ASSET_PUBLIC_IDENTITY_SHA256:-}" ]] || { echo "extract does not consume an existing identity" >&2; return 1; }
  fi
  # Existing transport, but exactly one attempt. An SSH255 after a rename is
  # UNKNOWN, not permission to repeat a mutating command through a retry loop.
  local YNX_DEPLOY_CONNECTION_ATTEMPTS=1
  export YNX_DEPLOY_CONNECTION_ATTEMPTS
  local local_root="$transaction_dir/testnet-assets-$phase" remote_stage="/tmp/ynx-public-bft-testnet-assets-$tx-$phase"
  local helper=scripts/ops/remote/public-bft-prepare-testnet-assets.py capture=scripts/ops/remote/public-bft-capture-snapshot-source.py helper_pin capture_pin
  helper_pin="$(shasum -a 256 "$helper" | awk '{print $1}')"
  capture_pin="$(shasum -a 256 "$capture" | awk '{print $1}')"
  # No combined extract/archive, stop, start, rollback or cleanup follows this
  # explicit phase. Every local/remote stage and partial result is exclusive.
  (umask 077; mkdir "$local_root")
  (set -C; printf 'phase=%s\ntransactionId=%s\nhelperSHA256=%s\ncaptureSHA256=%s\nretry=false\n' "$phase" "$tx" "$helper_pin" "$capture_pin" >"$local_root/intent.txt")
  ynx_ops_ssh primary "$PRIMARY_NODE_USER" "$PRIMARY_NODE_HOST" "$PRIMARY_NODE_SSH_KEY" "umask 077; mkdir '$remote_stage'"
  ynx_ops_copy primary "$PRIMARY_NODE_USER" "$PRIMARY_NODE_HOST" "$PRIMARY_NODE_SSH_KEY" "$helper" "$remote_stage/public-bft-prepare-testnet-assets.py"
  ynx_ops_copy primary "$PRIMARY_NODE_USER" "$PRIMARY_NODE_HOST" "$PRIMARY_NODE_SSH_KEY" "$capture" "$remote_stage/public-bft-capture-snapshot-source.py"
  local remote_command
  printf -v remote_command '%q ' sudo -n /usr/bin/timeout --signal=TERM --kill-after=1 25 env -i PATH=/usr/bin:/bin /usr/bin/python3 -B "$remote_stage/public-bft-prepare-testnet-assets.py" \
    --phase "$phase" --transaction-id "$tx" --commit "$commit" --capture-helper-sha256 "$capture_pin" \
    --snapshot-source "$source" --snapshot-source-sha256 "$source_pin" \
    --primary-freeze "$remote_root/primary-freeze.json" --primary-freeze-sha256 "$freeze_pin" \
    --primary-pause "$remote_root/primary-pause-authoritative.json" --primary-pause-sha256 "$pause_pin" \
    --output-dir "$remote_root/testnet-assets-$phase" ${identity_args[@]+"${identity_args[@]}"}
  # Hash both copied sources before the privileged normal callee. No public
  # identity, state digest, validator key or approval is generated by the driver.
  (set -C; ynx_ops_ssh primary "$PRIMARY_NODE_USER" "$PRIMARY_NODE_HOST" "$PRIMARY_NODE_SSH_KEY" "set -e; test \"\$(sha256sum '$remote_stage/public-bft-prepare-testnet-assets.py' | cut -d' ' -f1)\" = '$helper_pin'; test \"\$(sha256sum '$remote_stage/public-bft-capture-snapshot-source.py' | cut -d' ' -f1)\" = '$capture_pin'; $remote_command" >"$local_root/result.json")
  echo "testnet asset phase completed: phase=$phase evidence=$local_root; no candidate start or activation performed"
}

candidate_context() {
  [[ "${PUBLIC_BFT_CUTOVER_COMMIT:-}" == "$commit" ]] || { echo "candidate commit does not match current HEAD" >&2; exit 1; }
  candidate_bft_release="ynx-bft-gateway-${commit}"
  [[ "${PUBLIC_BFT_CUTOVER_RELEASE:-}" == "$candidate_bft_release" ]] || { echo "candidate BFT release does not match current HEAD" >&2; exit 1; }
  candidate_transaction_dir="${PUBLIC_BFT_CUTOVER_TRANSACTION_DIR:-}"
  [[ -n "$candidate_transaction_dir" && -d "$candidate_transaction_dir" ]] || { echo "PUBLIC_BFT_CUTOVER_TRANSACTION_DIR must be an existing directory" >&2; exit 1; }
  candidate_transaction_id="$(basename "$candidate_transaction_dir")"
  [[ "$candidate_transaction_id" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$ ]] || { echo "invalid candidate transaction id" >&2; exit 1; }
  candidate_root="$candidate_transaction_dir/candidate"
  candidate_public_data_root="$(public_bft_public_data_root "$candidate_transaction_dir")" || return
  if [[ "$candidate_public_data_root" != "$candidate_transaction_dir" && ! -e "$candidate_public_data_root/candidate" ]]; then
    (umask 077; mkdir -m 0700 "$candidate_public_data_root/candidate") || return
  fi
  candidate_package="$candidate_public_data_root/candidate/package"
  candidate_migration="$candidate_public_data_root/final-snapshot/migration.json"
  candidate_binding="$candidate_root/binding.json"
  candidate_approval="$candidate_transaction_dir/approval.json"
  candidate_release="ynx-consensus-candidate-${commit}"
}

prepare_candidate_package() {
  candidate_context
  [[ "${PUBLIC_BFT_PRODUCTION_CANDIDATE_APPROVED:-}" == "yes" ]] || { echo "PUBLIC_BFT_PRODUCTION_CANDIDATE_APPROVED=yes is required" >&2; exit 1; }
  local validator_manifest="${PUBLIC_BFT_PRODUCTION_VALIDATOR_MANIFEST:-}"
  local genesis_time="${PUBLIC_BFT_PRODUCTION_CANDIDATE_GENESIS_TIME:-}"
  [[ -n "$validator_manifest" && -f "$validator_manifest" ]] || { echo "PUBLIC_BFT_PRODUCTION_VALIDATOR_MANIFEST is required" >&2; exit 1; }
  [[ -n "$genesis_time" ]] || { echo "PUBLIC_BFT_PRODUCTION_CANDIDATE_GENESIS_TIME is required" >&2; exit 1; }
  public_bft_operator_inputs
  local binding_args=("$candidate_transaction_dir" "$commit" "$candidate_bft_release" "$validator_manifest" "$genesis_time" "$candidate_operator_plan" "$candidate_operator_pin" "${CONSENSUS_CANDIDATE_RUNTIME_COMMIT:-}" "${CONSENSUS_CANDIDATE_RUNTIME_MANIFEST_SHA256:-}")
  public_bft_runtime_prepare "$candidate_transaction_dir"
  node scripts/verify/public-bft-candidate-binding.mjs --inputs-only "${binding_args[@]}" >/dev/null
  umask 077
  mkdir -p "$candidate_root"
  chmod 0700 "$candidate_root"
  if [[ -e "$candidate_package" || -L "$candidate_package" || -e "$candidate_binding" || -L "$candidate_binding" ]]; then
    if public_bft_linux_tools_enabled && [[ -d "$candidate_package" && ! -L "$candidate_package" && ! -e "$candidate_binding" && ! -L "$candidate_binding" ]]; then
      # The bridge accepts this only with its same-request PUBLISHED receipt;
      # incomplete/foreign directories stay UNKNOWN, with no math reexecution.
      public_bft_package_call "$public_package_verifier" -migration-state "$candidate_migration" -validator-manifest "$validator_manifest" -genesis-time "$genesis_time" -operator-plan "$candidate_operator_plan" -operator-plan-hash "$candidate_operator_pin" -output "$candidate_package" >/dev/null || return
      public_bft_package_call "$public_package_verifier" -verify-package "$candidate_package" -operator-plan-hash "$candidate_operator_pin" >/dev/null || return
      (set -C; node scripts/verify/public-bft-candidate-binding.mjs "${binding_args[@]}" "$candidate_package" >"$candidate_binding") || return
      chmod 0600 "$candidate_binding"
      return
    fi
    [[ -d "$candidate_package" && ! -L "$candidate_package" && -s "$candidate_binding" && ! -L "$candidate_binding" ]] || { echo "partial candidate package state exists" >&2; exit 1; }
    public_bft_package_call "$public_package_verifier" -verify-package "$candidate_package" -operator-plan-hash "$candidate_operator_pin" >/dev/null
    node scripts/verify/public-bft-candidate-binding.mjs "${binding_args[@]}" "$candidate_package" | cmp "$candidate_binding" - >/dev/null || { echo "existing candidate binding mismatch; original package/binding retained" >&2; exit 1; }
    return
  fi
  public_bft_package_call "$public_package_verifier" \
    -migration-state "$candidate_migration" \
    -validator-manifest "$validator_manifest" \
    -genesis-time "$genesis_time" \
    -operator-plan "$candidate_operator_plan" \
    -operator-plan-hash "$candidate_operator_pin" \
    -output "$candidate_package" >/dev/null
  public_bft_package_call "$public_package_verifier" -verify-package "$candidate_package" -operator-plan-hash "$candidate_operator_pin" >/dev/null
  local partial_binding="$candidate_binding.partial"
  (set -o noclobber; node scripts/verify/public-bft-candidate-binding.mjs "${binding_args[@]}" "$candidate_package" >"$partial_binding")
  chmod 0600 "$partial_binding"
  # Publish exclusively; retain the partial original even if publication fails.
  ln "$partial_binding" "$candidate_binding"
}

validated_candidate_initialization() {
  local binding_sha
  binding_sha="$(shasum -a 256 "$candidate_binding" | awk '{print $1}')"
  node -e 'const fs=require("fs"),[p,t,c,r,h,d]=process.argv.slice(1),v=JSON.parse(fs.readFileSync(p));if(v.version!==1||v.transactionId!==t||v.commit!==c||v.bftRelease!==r||v.bindingSha256!==h||v.dryRun!==(d==="1")||v.imported!==(d!=="1")||v.consensusInitialized!==false||v.runtimeStarted!==false)process.exit(1)' "$candidate_root/initialize-attempt/result.json" "$candidate_transaction_id" "$commit" "$candidate_bft_release" "$binding_sha" "${DEPLOY_DRY_RUN:-0}" || { echo "original explicit fresh-import result is required for native public cutover; existing applications use the separate normal operator recovery path" >&2; exit 1; }
}

deploy_candidate_phase() {
  prepare_candidate_package
  validated_candidate_initialization
  local binding_sha result="$candidate_root/deploy-result.json"
  binding_sha="$(shasum -a 256 "$candidate_binding" | awk '{print $1}')"
  if [[ -e "$result" || -L "$result" ]]; then
    [[ -f "$result" && ! -L "$result" ]] || { echo "partial candidate install result retained" >&2; exit 1; }
    node -e 'const fs=require("fs"),[p,tx,c,r,s,d]=process.argv.slice(1),v=JSON.parse(fs.readFileSync(p)); if(v.transactionId!==tx||v.commit!==c||v.bftRelease!==r||v.bindingSha256!==s||v.deployed!==true||v.runtimeStarted!==false||v.dryRun!==(d==="1")) process.exit(1)' "$result" "$candidate_transaction_id" "$commit" "$candidate_bft_release" "$binding_sha" "${DEPLOY_DRY_RUN:-0}" || { echo "existing candidate deploy result mismatch" >&2; exit 1; }
    # Installation is separate from starting. Do not query live consensus here
    # or repeat a write after a lost install response.
    echo "production BFT candidate install record retained: transaction=$candidate_transaction_id; use explicit start_candidate then verify_candidate"
    return
  fi
  (umask 077; mkdir -m 0700 "$candidate_root/deploy-attempt") || { echo "original install attempt exists (possibly UNKNOWN); retain and reconcile it" >&2; exit 1; }
  (set -o noclobber; CONSENSUS_CANDIDATE_PACKAGE="$candidate_package" \
    CONSENSUS_CANDIDATE_APPROVED=yes \
    CONSENSUS_CANDIDATE_WORK_ROOT="$candidate_root/deploy-work" \
    bash scripts/deploy/deploy-consensus-candidate.sh >"$candidate_root/deploy.txt" 2>"$candidate_root/deploy-error.txt")
  printf '{"transactionId":"%s","commit":"%s","bftRelease":"%s","candidateRelease":"%s","bindingSha256":"%s","deployed":true,"runtimeStarted":false,"dryRun":%s}\n' \
    "$candidate_transaction_id" "$commit" "$candidate_bft_release" "$candidate_release" "$binding_sha" "$([[ "${DEPLOY_DRY_RUN:-0}" == "1" ]] && echo true || echo false)" >"$result"
  chmod 0600 "$result"
  echo "production BFT candidate deploy passed: transaction=$candidate_transaction_id evidence=$candidate_root"
}

collect_candidate_original_guard() {
  local role="$1" user="$2" host="$3" key="$4" _kind="$5" evidence="$candidate_guard_root/$1"
  mkdir -m 0700 "$evidence"
  if [[ "$dry" == 1 ]]; then return; fi
  local remote_file name
  for name in backup freeze marker; do
    case "$name" in backup) remote_file="$remote_root/$role.json" ;; freeze) remote_file="$remote_root/$role-freeze.json" ;; marker) remote_file=/var/lib/ynx-chain/mutation-freeze.json ;; esac
    ynx_ops_ssh "$role" "$user" "$host" "$key" "sudo test -f '$remote_file' && sudo test ! -L '$remote_file' && sudo cat '$remote_file'" >"$evidence/$name.json"
  done
  if [[ "$role" == primary ]]; then
    ynx_ops_ssh "$role" "$user" "$host" "$key" "sudo cat '$remote_root/primary-pause-authoritative.json'" >"$evidence/pause.json"
    ynx_ops_ssh "$role" "$user" "$host" "$key" 'sudo cat /var/lib/ynx-chain/block-production-pause.json' >"$evidence/pause-marker.json"
  fi
  chmod 0600 "$evidence/"*.json
  node scripts/verify/public-bft-candidate-binding.mjs --activation-evidence "$candidate_transaction_dir" "$candidate_binding" "$role" "$evidence" >"$evidence/validated.json"
}

candidate_original_guard_command() {
  local role="$1" evidence="$candidate_guard_root/$1" file destination expected
  [[ "$dry" != 1 ]] || return 0
  for file in backup freeze marker pause pause-marker; do
    [[ -f "$evidence/$file.json" ]] || continue
    case "$file" in backup) destination="$remote_root/$role.json" ;; freeze) destination="$remote_root/$role-freeze.json" ;; marker) destination=/var/lib/ynx-chain/mutation-freeze.json ;; pause) destination="$remote_root/primary-pause-authoritative.json" ;; pause-marker) destination=/var/lib/ynx-chain/block-production-pause.json ;; esac
    expected="$(shasum -a 256 "$evidence/$file.json" | awk '{print $1}')"
    printf "sudo test -f '%s'; sudo test ! -L '%s'; printf '%%s  %%s\\\\n' '%s' '%s' | sudo sha256sum --strict -c - >/dev/null\n" "$destination" "$destination" "$expected" "$destination"
  done
  expected="$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1])).backupSHA256)' "$evidence/validated.json")"
  printf "printf '%%s  %%s\\\\n' '%s' '%s' | sudo sha256sum --strict -c - >/dev/null\n" "$expected" "$remote_root/$role.tar.gz"
}

initialize_candidate_phase() {
  [[ "${PUBLIC_BFT_PRODUCTION_INITIALIZATION_APPROVED:-}" == yes ]] || { echo "PUBLIC_BFT_PRODUCTION_INITIALIZATION_APPROVED=yes is required for a fresh native import" >&2; exit 1; }
  # A connection loss may follow an import or reservation. The exclusive
  # attempt is an UNKNOWN fence, not permission for transport-level replay.
  local -x YNX_DEPLOY_CONNECTION_ATTEMPTS=1
  prepare_candidate_package
  local binding_sha dry="${DEPLOY_DRY_RUN:-0}" candidate_guard_root="$candidate_root/initialize-attempt"
  local remote_root="${BACKUP_STORAGE_PATH:-/var/backups/ynx-chain}/public-bft-cutover/${candidate_transaction_id}"
  [[ "$remote_root" =~ ^/[A-Za-z0-9._/-]+$ && "$remote_root" != *..* ]] || { echo "unsafe original backup root" >&2; exit 1; }
  binding_sha="$(shasum -a 256 "$candidate_binding" | awk '{print $1}')"
  (umask 077; mkdir -m 0700 "$candidate_guard_root") || { echo "original initialization attempt exists (possibly UNKNOWN); never reset or replay it" >&2; exit 1; }
  printf '{"version":1,"transactionId":"%s","bindingSha256":"%s","status":"unknown","automaticRetry":false}\n' "$candidate_transaction_id" "$binding_sha" >"$candidate_guard_root/intent.json"
  ynx_ops_each_node collect_candidate_original_guard
  initialize_operator_role() {
    local role="$1" user="$2" host="$3" key="$4" _kind="$5" evidence="$candidate_guard_root/$1" file expected command destination_guard
    local stage="$evidence/stage" archive="$evidence/original-inputs.tar.gz"
    local remote_stage="/opt/ynx-chain/consensus-initialization/$candidate_release/$role" remote_archive="/tmp/$candidate_release-initialize-$role.tar.gz"
    # The normal pinned plan supplies all coordinates. No node/home, key,
    # registry event, signing state or header is manufactured by this phase.
    destination_guard="$(node scripts/verify/public-bft-candidate-binding.mjs --initialization-destination "$candidate_operator_plan" "$candidate_operator_pin" "$role" "$remote_stage")"
    command="$(node scripts/verify/public-bft-candidate-binding.mjs --initialization-command "$candidate_operator_plan" "$candidate_operator_pin" "$role" "$remote_stage")"
    mkdir -m 0700 "$stage"
    if ! public_bft_linux_tools_enabled; then cp "$(dirname "$public_package_verifier")/ynx-comet" "$public_package_verifier" "$stage/"; fi
    cp "$candidate_package/roles/$role/config/genesis.json" "$candidate_package/roles/$role/config/bound-migration.json" "$stage/"
    cp "$candidate_operator_plan" "$stage/operator-plan.json"
    tar -czf "$archive" -C "$stage" .
    chmod 0600 "$archive"
    expected="$(shasum -a 256 "$archive" | awk '{print $1}')"
    local capacity_command capacity_mode=local
    if public_bft_linux_tools_enabled; then capacity_mode=bridge; fi
    capacity_command="$(python3 -B scripts/ops/public-bft-candidate-capacity.py initialize "$role" "$candidate_release" "$stage" "$archive" "$expected" "$(dirname "$public_package_verifier")/SOURCE.json" "${CONSENSUS_CANDIDATE_RUNTIME_MANIFEST_SHA256:?}" "$capacity_mode")" || return $?
    # Read-only aggregate on each actual target filesystem, before any remote
    # reservation. Import-state/backup capacity is checked by its own producer.
    ynx_ops_ssh "$role" "$user" "$host" "$key" "set -euo pipefail
$destination_guard
$(candidate_original_guard_command "$role")
$capacity_command
sudo test ! -e '$remote_stage'; sudo test ! -L '$remote_stage'
test ! -e '$remote_archive'; test ! -L '$remote_archive'
for directory in '/opt/ynx-chain/consensus-initialization' '/opt/ynx-chain/consensus-initialization/$candidate_release'; do
  if sudo test -e \"\$directory\" || sudo test -L \"\$directory\"; then
    sudo test -d \"\$directory\"; sudo test ! -L \"\$directory\"; test \"\$(sudo stat -c %a \"\$directory\")\" = 711
  else sudo mkdir -m 0711 \"\$directory\"; fi
done
sudo mkdir -m 0700 '$remote_stage'
(umask 077; set -o noclobber; : > '$remote_archive')" >"$evidence/reservation.txt" 2>"$evidence/reservation-error.txt"
    ynx_ops_copy "$role" "$user" "$host" "$key" "$archive" "$remote_archive"
    if public_bft_linux_tools_enabled; then public_bft_linux_stage "$role" initialize >"$evidence/public-tools.json"; fi
    local execution="set -euo pipefail
test -f '$remote_archive'; test ! -L '$remote_archive'
printf '%s  %s\\n' '$expected' '$remote_archive' | sha256sum --strict -c - >/dev/null
sudo tar --no-same-owner -xzf '$remote_archive' -C '$remote_stage'"
    for file in "$stage/"*; do
      expected="$(shasum -a 256 "$file" | awk '{print $1}')"
      execution+=$'\n'"printf '%s  %s\\n' '$expected' '$remote_stage/$(basename "$file")' | sudo sha256sum --strict -c - >/dev/null"
    done
    if public_bft_linux_tools_enabled; then
      for file in ynx-comet ynx-consensus-package; do
        expected="$(public_bft_runtime_binary_sha "$(dirname "$public_package_verifier")" "$file")"
        execution+=$'\n'"printf '%s  %s\\n' '$expected' '$remote_stage/$file' | sudo sha256sum --strict -c - >/dev/null"
      done
    fi
    execution+=$'\n'"sudo chown -R ynx:ynx '$remote_stage'
$(candidate_original_guard_command "$role")
$command"
    printf '%s\n' "$execution" >"$evidence/initialize-command.sh"
    ynx_ops_ssh "$role" "$user" "$host" "$key" "$execution" >"$evidence/receipt.json" 2>"$evidence/initialize-error.txt"
    if [[ "$dry" != 1 ]]; then
      node scripts/verify/public-bft-candidate-binding.mjs --initialization-result "$candidate_transaction_dir" "$candidate_binding" "$candidate_operator_plan" "$candidate_operator_pin" "$role" "$evidence/receipt.json" >"$evidence/verified.json"
    fi
  }
  ynx_ops_each_node initialize_operator_role
  printf '{"version":1,"transactionId":"%s","commit":"%s","bftRelease":"%s","bindingSha256":"%s","imported":%s,"dryRun":%s,"consensusInitialized":false,"runtimeStarted":false}\n' "$candidate_transaction_id" "$commit" "$candidate_bft_release" "$binding_sha" "$([[ "$dry" == 1 ]] && echo false || echo true)" "$([[ "$dry" == 1 ]] && echo true || echo false)" >"$candidate_guard_root/result.json"
  echo "fresh import phase completed; no node or signer started: $candidate_guard_root"
}

start_candidate_phase() {
  [[ "${PUBLIC_BFT_PRODUCTION_CANDIDATE_START_APPROVED:-}" == yes ]] || { echo "PUBLIC_BFT_PRODUCTION_CANDIDATE_START_APPROVED=yes is required; installation never starts the operator" >&2; exit 1; }
  # Apply only to this write phase and its original backup/start callees;
  # ordinary read-only verification retains its existing transport policy.
  local -x YNX_DEPLOY_CONNECTION_ATTEMPTS=1
  prepare_candidate_package
  validated_candidate_initialization
  local binding_sha start_dir="$candidate_root/start-attempt" dry="${DEPLOY_DRY_RUN:-0}"
  local candidate_guard_root="$start_dir"
  local remote_root="${BACKUP_STORAGE_PATH:-/var/backups/ynx-chain}/public-bft-cutover/${candidate_transaction_id}"
  [[ "$remote_root" =~ ^/[A-Za-z0-9._/-]+$ && "$remote_root" != *..* ]] || { echo "unsafe original backup root" >&2; exit 1; }
  binding_sha="$(shasum -a 256 "$candidate_binding" | awk '{print $1}')"
  node -e 'const fs=require("fs"),[p,t,c,r,h,d]=process.argv.slice(1),v=JSON.parse(fs.readFileSync(p));if(v.transactionId!==t||v.commit!==c||v.bftRelease!==r||v.bindingSha256!==h||v.deployed!==true||v.runtimeStarted!==false||v.dryRun!==(d==="1"))process.exit(1)' "$candidate_root/deploy-result.json" "$candidate_transaction_id" "$commit" "$candidate_bft_release" "$binding_sha" "$dry"
  # An exclusive attempt is the no-retry fence. Even a transport timeout or a
  # partially started cluster keeps this directory and the original HRS intact.
  (umask 077; mkdir -m 0700 "$start_dir") || { echo "original start attempt exists (possibly UNKNOWN); reconcile it without resending start" >&2; exit 1; }
  printf '{"version":1,"transactionId":"%s","bindingSha256":"%s","status":"unknown","automaticRetry":false}\n' "$candidate_transaction_id" "$binding_sha" >"$start_dir/intent.json"
  ynx_ops_each_node collect_candidate_original_guard
  backup_operator_role() {
    local role="$1" user="$2" host="$3" key="$4" _kind="$5" evidence="$start_dir/$1" expected command
    local script="/opt/ynx-chain/consensus-candidates/$candidate_release/$role/role/scripts/backup-candidate.sh"
    local archive="$remote_root/$role-operator-before-start.tar.gz"
    node scripts/verify/public-bft-candidate-binding.mjs --operator-preflight "$candidate_operator_plan" "$candidate_operator_pin" "$role" >"$evidence/custody-command.sh"
    expected="$(shasum -a 256 "$candidate_package/roles/$role/scripts/backup-candidate.sh" | awk '{print $1}')"
    command="set -euo pipefail
$(cat "$evidence/custody-command.sh")
! systemctl is-active --quiet ynx-consensus-abci-candidate.service
! systemctl is-active --quiet ynx-consensus-comet-candidate.service
! systemctl is-active --quiet ynx-consensus-operator-candidate.service
sudo test -f '$script'; sudo test ! -L '$script'
printf '%s  %s\\n' '$expected' '$script' | sudo sha256sum --strict -c - >/dev/null
sudo test ! -e '$archive'; sudo test ! -L '$archive'
sudo test ! -e '$archive.partial'; sudo test ! -L '$archive.partial'
sudo bash '$script' '$archive'
sudo sha256sum '$archive'"
    # The existing approved backup helper preserves original home/App/HRS. This
    # is a retained archive, not a claim of an independently consistent snapshot.
    ynx_ops_ssh "$role" "$user" "$host" "$key" "$command" >"$evidence/original-state-backup.txt" 2>"$evidence/original-state-backup-error.txt"
  }
  ynx_ops_each_node backup_operator_role
  start_operator_role() {
    local role="$1" user="$2" host="$3" key="$4" _kind="$5" evidence="$start_dir/$1" command file expected destination
    local installed=/var/lib/ynx-chain/consensus-candidate
    command="set -euo pipefail
$(cat "$evidence/custody-command.sh")
! systemctl is-active --quiet ynx-consensus-abci-candidate.service
! systemctl is-active --quiet ynx-consensus-comet-candidate.service
! systemctl is-active --quiet ynx-consensus-operator-candidate.service"
    # Compare installed bytes directly to independently verified local package
    # and runtime bytes, not to a second mutable remote staging tree.
    for file in "$candidate_package/roles/$role/scripts/start-operator.sh" "$candidate_package/roles/$role/role-manifest.json" "$candidate_package/roles/$role/systemd/ynx-consensus-operator-candidate.service" "$candidate_package/roles/$role/config/"*; do
      [[ -f "$file" && ! -L "$file" ]] || { echo "missing verified operator input: $file" >&2; return 1; }
      case "$file" in
        */scripts/start-operator.sh) destination="$installed/scripts/start-operator.sh" ;;
        */role-manifest.json) destination="$installed/role-manifest.json" ;;
        */systemd/*) destination=/etc/systemd/system/ynx-consensus-operator-candidate.service ;;
        */config/*) destination="$installed/config/$(basename "$file")" ;;
        *) destination="$installed/bin/$(basename "$file")" ;;
      esac
      expected="$(shasum -a 256 "$file" | awk '{print $1}')"
      command+=$'\n'"sudo test -f '$destination'; sudo test ! -L '$destination'; printf '%s  %s\\n' '$expected' '$destination' | sudo sha256sum --strict -c - >/dev/null"
    done
    for file in ynx-comet ynx-consensus-keycheck; do
      if public_bft_linux_tools_enabled; then expected="$(public_bft_runtime_binary_sha "$(dirname "$public_package_verifier")" "$file")"; else expected="$(shasum -a 256 "$(dirname "$public_package_verifier")/$file" | awk '{print $1}')"; fi
      destination="$installed/bin/$file"
      command+=$'\n'"sudo test -f '$destination'; sudo test ! -L '$destination'; printf '%s  %s\\n' '$expected' '$destination' | sudo sha256sum --strict -c - >/dev/null"
    done
    if [[ "$dry" != 1 ]]; then
      for file in backup freeze marker pause pause-marker; do
        [[ -f "$evidence/$file.json" ]] || continue
        case "$file" in backup) destination="$remote_root/$role.json" ;; freeze) destination="$remote_root/$role-freeze.json" ;; marker) destination=/var/lib/ynx-chain/mutation-freeze.json ;; pause) destination="$remote_root/primary-pause-authoritative.json" ;; pause-marker) destination=/var/lib/ynx-chain/block-production-pause.json ;; esac
        expected="$(shasum -a 256 "$evidence/$file.json" | awk '{print $1}')"
        command+=$'\n'"sudo test -f '$destination'; sudo test ! -L '$destination'; printf '%s  %s\\n' '$expected' '$destination' | sudo sha256sum --strict -c - >/dev/null"
      done
      expected="$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1])).backupSHA256)' "$evidence/validated.json")"
      command+=$'\n'"printf '%s  %s\\n' '$expected' '$remote_root/$role.tar.gz' | sudo sha256sum --strict -c - >/dev/null"
    fi
    command+=$'\n'"sudo systemctl daemon-reload
test \"\$(systemctl show -p FragmentPath --value ynx-consensus-operator-candidate.service)\" = /etc/systemd/system/ynx-consensus-operator-candidate.service
test -z \"\$(systemctl show -p DropInPaths --value ynx-consensus-operator-candidate.service)\"
sudo timeout 30s systemctl start ynx-consensus-operator-candidate.service
systemctl is-active --quiet ynx-consensus-operator-candidate.service"
    printf '%s\n' "$command" >"$evidence/start-command.sh"
    ynx_ops_ssh "$role" "$user" "$host" "$key" "$command" >"$evidence/start-output.txt" 2>"$evidence/start-error.txt"
  }
  ynx_ops_each_node start_operator_role
  printf '{"version":1,"transactionId":"%s","commit":"%s","bftRelease":"%s","bindingSha256":"%s","started":%s,"dryRun":%s,"publicIngressChanged":false,"pqActivationVerified":false}\n' "$candidate_transaction_id" "$commit" "$candidate_bft_release" "$binding_sha" "$([[ "$dry" == 1 ]] && echo false || echo true)" "$([[ "$dry" == 1 ]] && echo true || echo false)" >"$start_dir/result.json"
  echo "operator start phase completed; independent consensus verification remains required: $start_dir"
}

quiet_bootstrap_mode() {
  python3 -B scripts/ops/public-bft-quiet-continuation.py mode --plan "$candidate_operator_plan" --plan-sha256 "$candidate_operator_pin"
}

quiet_forward_gate() {
  local bootstrap_mode
  bootstrap_mode="$(quiet_bootstrap_mode)" || return $?
  [[ "$bootstrap_mode" == quiet-first-registration-v1 ]] || return 0
  [[ "${PUBLIC_BFT_CUTOVER_MODE:-}" == continue-pq-native ]] || { echo "quiet gateway tail requires original transaction continuation" >&2; return 1; }
  # The original gateway package/SOURCE stays the gateway identity. A later
  # operator profile has its own independent plan, installed source and proof.
  python3 -B scripts/ops/public-bft-quiet-continuation.py forward-gate --transaction "$candidate_transaction_dir" --plan "$candidate_operator_plan" --plan-sha256 "$candidate_operator_pin" --phase "$action"
}

collect_quiet_role_observation() {
  local role="$1" user="$2" host="$3" key="$4" _kind="$5" command
  command="$(python3 -B scripts/ops/public-bft-quiet-continuation.py observe-command --transaction "$candidate_transaction_dir" --plan "$candidate_operator_plan" --plan-sha256 "$candidate_operator_pin" --package "$quiet_observation_package" --runtime "$(dirname "$public_package_verifier")" --role "$role" ${quiet_observation_inputs[@]+"${quiet_observation_inputs[@]}"})" || return $?
  (set -C; printf '%s\n' "$command" >"$quiet_observation_evidence/$role.command.sh")
  # Read-only fixed callee; failed/partial observations remain in this exclusive
  # attempt. No retry, new transaction, signing or service transition follows.
  (set -C; ynx_ops_ssh "$role" "$user" "$host" "$key" "$command" >"$quiet_observation_evidence/$role.json" 2>"$quiet_observation_evidence/$role.error.txt")
}

verify_quiet_bootstrap() {
  [[ "${PUBLIC_BFT_CUTOVER_MODE:-}" == continue-native && "${DEPLOY_DRY_RUN:-0}" == 0 ]] || { echo "quiet bootstrap requires the original real native continuation" >&2; return 1; }
  local quiet_observation_evidence="$candidate_root/quiet-ready-attempt" quiet_observation_package="$candidate_package"
  local -a quiet_observation_inputs=()
  (umask 077; mkdir -m 0700 "$quiet_observation_evidence") || { echo "quiet ready observation exists/UNKNOWN; retain original" >&2; return 1; }
  ynx_ops_each_node collect_quiet_role_observation
  python3 -B scripts/ops/public-bft-quiet-continuation.py ready --transaction "$candidate_transaction_dir" --plan "$candidate_operator_plan" --plan-sha256 "$candidate_operator_pin" --package "$candidate_package" --evidence "$quiet_observation_evidence"
}

verify_pq_continuation_phase() {
  [[ "${PUBLIC_BFT_CUTOVER_MODE:-}" == continue-pq-native && "${DEPLOY_DRY_RUN:-0}" == 0 ]] || { echo "PQ continuation is only an original native transaction phase" >&2; return 1; }
  prepare_candidate_package
  local attempt="$candidate_transaction_dir/pq-continuation-attempt" packet="$candidate_transaction_dir/pq-continuation-attempt/input.json" packet_pin
  packet_pin="$(python3 -B - "$attempt/intent.json" <<'PY'
import json,sys
print(json.load(open(sys.argv[1]))['inputSHA256'])
PY
)"
  local -a quiet_observation_inputs=(--input "$packet" --input-sha256 "$packet_pin")
  local targets current_package current_pin current_commit current_source
  targets="$(python3 -B scripts/ops/public-bft-quiet-continuation.py target-package --transaction "$candidate_transaction_dir" --plan "$candidate_operator_plan" --plan-sha256 "$candidate_operator_pin" "${quiet_observation_inputs[@]}")" || return $?
  { IFS= read -r current_package; IFS= read -r current_pin; IFS= read -r current_commit; IFS= read -r current_source; } <<<"$targets"
  # The first implementation resumes within the same source-qualified cutover
  # runtime. A different build needs a separately approved cutover source; no
  # SOURCE rewrite or environment-selected binary substitutes for these pins.
  [[ "$current_commit" == "$CONSENSUS_CANDIDATE_RUNTIME_COMMIT" && "$current_source" == "$CONSENSUS_CANDIDATE_RUNTIME_MANIFEST_SHA256" ]] || { echo "current PQ runtime differs from original cutover source" >&2; return 1; }
  (set -C; public_bft_package_call "$public_package_verifier" -verify-package "$current_package" -operator-plan-hash "$current_pin" >"$attempt/current-package-verification.txt")
  local quiet_observation_evidence="$attempt/evidence" quiet_observation_package="$current_package"
  (umask 077; mkdir -m 0700 "$quiet_observation_evidence") || { echo "original PQ qualification exists/UNKNOWN; do not repeat" >&2; return 1; }
  local role values context context_pin request request_pin proof_verifier="$(dirname "$public_package_verifier")/ynx-consensus-proof-verify"
  local transition_root transition_approval transition_approval_pin
  { IFS= read -r transition_root; IFS= read -r transition_approval; IFS= read -r transition_approval_pin; } < <(python3 -B - "$packet" <<'PYDATA'
import json,sys
v=json.load(open(sys.argv[1]))
for k in ('transitionRoot','transitionApproval','transitionApprovalSHA256'): print(v[k])
PYDATA
)
  # Reuse the original normal transition binding validator, with the actual
  # independently approved source/plan bytes; no reader-generated approval.
  source scripts/ops/remote/public-bft-operator-transition.sh
  for role in primary singapore silicon-valley seoul; do
    (set -C; operator_transition_binding start "$candidate_transaction_id" "$role" "$transition_approval" "$transition_approval_pin" "$candidate_package" "$candidate_operator_pin" "$(dirname "$public_package_verifier")/SOURCE.json" "$current_commit" "$current_source" "$current_package" "$current_pin" "$(dirname "$public_package_verifier")/SOURCE.json" "$current_commit" "$current_source" >"$quiet_observation_evidence/$role.binding.json")
    cmp "$quiet_observation_evidence/$role.binding.json" "$transition_root/start-attempt/$role.binding.json" >/dev/null || { echo "original transition binding changed" >&2; return 1; }
  done
  if public_bft_linux_tools_enabled; then
    # This phase never stops a running node. The original explicit normal
    # capture/resume phases must already have completed under their independent
    # protected approval and same transaction. No old start is replayed.
    local export_values export_role source_plan source_plan_pin export_output capture_root capture_result capture_pin delivery_case delivery_destination
    export_values="$(python3 -B scripts/ops/public-bft-quiet-continuation.py export-args --transaction "$candidate_transaction_dir" --plan "$candidate_operator_plan" --plan-sha256 "$candidate_operator_pin" "${quiet_observation_inputs[@]}")" || return $?
    { IFS= read -r export_role; IFS= read -r source_plan; IFS= read -r source_plan_pin; IFS= read -r export_output; } <<<"$export_values"
    case "$export_role" in primary|singapore|silicon-valley|seoul) ;; *) return 1;; esac
    capture_root="/var/lib/ynx-chain/operator-transitions/$candidate_transaction_id/$export_role/capture-attempt"
    capture_result="$transition_root/capture-attempt/$export_role.result.json"
    [[ -f "$capture_result" && ! -L "$capture_result" && -f "$transition_root/resume-attempt/$export_role.result.json" && ! -L "$transition_root/resume-attempt/$export_role.result.json" ]] || { echo 'original explicit capture and resume receipts are required; no implicit stop or restart' >&2; return 1; }
    capture_pin="$(shasum -a 256 "$capture_result" | awk '{print $1}')" || return
    delivery_destination="$candidate_public_data_root/pq-continuation-public-metadata"
    (set -C; public_bft_linux_tool_for_role "$export_role" light-metadata "$capture_root" "$capture_pin" "$source_plan_pin" "$delivery_destination" >"$quiet_observation_evidence/light.export-receipt.json") || return
    delivery_case="$(python3 -B scripts/ops/public-bft-linux-public-tools.py publication-case "$candidate_transaction_dir" "$delivery_destination" "$current_commit" "$current_source")" || return
    values="$(python3 -B scripts/ops/public-bft-quiet-continuation.py proof-args --transaction "$candidate_transaction_dir" --plan "$candidate_operator_plan" --plan-sha256 "$candidate_operator_pin" "${quiet_observation_inputs[@]}" --evidence "$quiet_observation_evidence" --export-receipt-dir "$delivery_case")" || return $?
    { IFS= read -r context; IFS= read -r context_pin; IFS= read -r request; IFS= read -r request_pin; } <<<"$values"
    # Exactly one original Go verifier, on the role that actually holds the
    # captured PUBLIC files. No 683MB round trip, changed context or new clock.
    (set -C; public_bft_linux_tool_for_role "$export_role" proof-capture "$capture_root" "$capture_pin" "$source_plan_pin" >"$quiet_observation_evidence/light.proof-result.json" 2>"$quiet_observation_evidence/light.proof-error.txt")
  else
    values="$(python3 -B scripts/ops/public-bft-quiet-continuation.py proof-args --transaction "$candidate_transaction_dir" --plan "$candidate_operator_plan" --plan-sha256 "$candidate_operator_pin" "${quiet_observation_inputs[@]}" --evidence "$quiet_observation_evidence")" || return $?
    { IFS= read -r context; IFS= read -r context_pin; IFS= read -r request; IFS= read -r request_pin; } <<<"$values"
    (set -C; /usr/bin/timeout --signal=TERM --kill-after=5 60 "$proof_verifier" --trust-context "$context" --trust-context-sha256 "$context_pin" <"$request" >"$quiet_observation_evidence/light.proof-result.json" 2>"$quiet_observation_evidence/light.proof-error.txt")
  fi
  ynx_ops_each_node collect_quiet_role_observation
  python3 -B scripts/ops/public-bft-quiet-continuation.py verify-results --transaction "$candidate_transaction_dir" --plan "$candidate_operator_plan" --plan-sha256 "$candidate_operator_pin" "${quiet_observation_inputs[@]}" --evidence "$quiet_observation_evidence"
}

verify_candidate_phase() {
  prepare_candidate_package
  local deploy_result="$candidate_root/deploy-result.json" binding_sha
  test -s "$deploy_result"
  binding_sha="$(shasum -a 256 "$candidate_binding" | awk '{print $1}')"
  node -e 'const fs=require("fs"),[p,tx,c,r,s]=process.argv.slice(1),v=JSON.parse(fs.readFileSync(p)); if(v.transactionId!==tx||v.commit!==c||v.bftRelease!==r||v.bindingSha256!==s||v.deployed!==true) process.exit(1)' "$deploy_result" "$candidate_transaction_id" "$commit" "$candidate_bft_release" "$binding_sha" || { echo "candidate deploy result is not transaction-bound" >&2; exit 1; }
  node -e 'const fs=require("fs"),[p,t,c,r,h,d]=process.argv.slice(1),v=JSON.parse(fs.readFileSync(p));if(v.version!==1||v.transactionId!==t||v.commit!==c||v.bftRelease!==r||v.bindingSha256!==h||v.dryRun!==(d==="1")||v.started!==(d!=="1"))process.exit(1)' "$candidate_root/start-attempt/result.json" "$candidate_transaction_id" "$commit" "$candidate_bft_release" "$binding_sha" "${DEPLOY_DRY_RUN:-0}" || { echo "explicit original operator start result is required; dry-run cannot authorize real verification" >&2; exit 1; }
  local bootstrap_mode
  bootstrap_mode="$(quiet_bootstrap_mode)" || return $?
  if [[ "$bootstrap_mode" == quiet-first-registration-v1 ]]; then
    verify_quiet_bootstrap
    return
  fi
  local evidence="$candidate_root/remote-evidence"
  CONSENSUS_CANDIDATE_PACKAGE="$candidate_package" CONSENSUS_CANDIDATE_EVIDENCE_DIR="$evidence" bash scripts/verify/verify-consensus-candidate.sh >"$candidate_root/verify.txt"
  if [[ "${DEPLOY_DRY_RUN:-0}" == "1" ]]; then
    printf '{"transactionId":"%s","commit":"%s","bftRelease":"%s","bindingSha256":"%s","verified":false,"dryRun":true}\n' "$candidate_transaction_id" "$commit" "$candidate_bft_release" "$binding_sha" >"$candidate_root/verify-result.json"
  else
    node -e 'const fs=require("fs"),[p,o,tx,c,r,s]=process.argv.slice(1),v=JSON.parse(fs.readFileSync(p)); if(v.status!=="passed"||v.publicCutoverAuthorized!==false||v.chainId!=="ynx_6423-1"||v.observedSignerCount<3||!Array.isArray(v.nodes)||v.nodes.length!==4) process.exit(1); fs.writeFileSync(o,JSON.stringify({transactionId:tx,commit:c,bftRelease:r,bindingSha256:s,candidateEvidenceSha256:require("crypto").createHash("sha256").update(fs.readFileSync(p)).digest("hex"),verified:true,dryRun:false})+"\n",{mode:0o600})' "$evidence/consensus-candidate-evidence.json" "$candidate_root/verify-result.json" "$candidate_transaction_id" "$commit" "$candidate_bft_release" "$binding_sha"
  fi
  chmod 0600 "$candidate_root/verify-result.json"
  echo "production BFT candidate verification passed: transaction=$candidate_transaction_id evidence=$candidate_root"
}

rollback_candidate_phase() {
  candidate_context
  node scripts/verify/validate-public-bft-cutover-approval-evidence.mjs "$candidate_approval" "$commit" "$candidate_bft_release" >/dev/null
  umask 077
  mkdir -p "$candidate_root"
  local attempt=1 output="$candidate_root/rollback.txt"
  while [[ -e "$output" ]]; do
    ((attempt += 1))
    output="$candidate_root/rollback-attempt-${attempt}.txt"
  done
  CONSENSUS_CANDIDATE_ROLLBACK_APPROVED=yes CONSENSUS_CANDIDATE_RELEASE="$candidate_release" bash scripts/ops/rollback-consensus-candidate.sh >"$output"
  printf '{"transactionId":"%s","commit":"%s","bftRelease":"%s","candidateRelease":"%s","automaticRollbackAuthorized":true,"rolledBack":true,"dryRun":%s}\n' \
    "$candidate_transaction_id" "$commit" "$candidate_bft_release" "$candidate_release" "$([[ "${DEPLOY_DRY_RUN:-0}" == "1" ]] && echo true || echo false)" >"$candidate_root/rollback-result.json"
  chmod 0600 "$candidate_root/rollback-result.json"
  echo "production BFT candidate rollback passed: transaction=$candidate_transaction_id evidence=$candidate_root"
}

dependency_context() {
  candidate_context
  dependency_mode="${PUBLIC_BFT_PRODUCTION_DEPENDENCY_MODE:-single-app-gateway}"
  [[ "$dependency_mode" == single-app-gateway ]] || { echo "normal pinned operator cutover refuses legacy multi-product dependencies" >&2; exit 1; }
  dependency_root="$candidate_transaction_dir/dependencies"
  dependency_approval="$candidate_transaction_dir/approval.json"
  dependency_remote_root="${BACKUP_STORAGE_PATH:-/var/backups/ynx-chain}/public-bft-cutover/${candidate_transaction_id}"
  [[ "$dependency_remote_root" =~ ^/[A-Za-z0-9._/-]+$ && "$dependency_remote_root" != *..* ]] || exit 1
  dependency_stage="$dependency_remote_root/gateway-runtime"
  dependency_helper="$dependency_stage/public-bft-dependencies.sh"
  read -r dependency_migration_height dependency_migration_hash < <(node -e 'const fs=require("fs"),v=JSON.parse(fs.readFileSync(process.argv[1]));if(!Number.isSafeInteger(v.finalSnapshotHeight)||v.finalSnapshotHeight<1||!(/^(0x)?[0-9a-f]{64}$/).test(v.finalSnapshotBlockHash||""))process.exit(1);console.log(v.finalSnapshotHeight,String(v.finalSnapshotBlockHash).replace(/^0x/,""))' "$candidate_binding")
  [[ "$dependency_migration_height" =~ ^[1-9][0-9]*$ && "$dependency_migration_hash" =~ ^[0-9a-f]{64}$ ]] || exit 1
}

validated_candidate_result() {
  local bootstrap_mode
  bootstrap_mode="$(quiet_bootstrap_mode)" || return $?
  if [[ "$bootstrap_mode" == quiet-first-registration-v1 ]]; then
    quiet_forward_gate
    return
  fi
  local binding_sha
  binding_sha="$(shasum -a 256 "$candidate_binding" | awk '{print $1}')"
  node -e 'const fs=require("fs"),[p,tx,c,r,s,d]=process.argv.slice(1),v=JSON.parse(fs.readFileSync(p));if(v.transactionId!==tx||v.commit!==c||v.bftRelease!==r||v.bindingSha256!==s||v.dryRun!==(d==="1")||v.verified!==(d!=="1"))process.exit(1)' "$candidate_root/verify-result.json" "$candidate_transaction_id" "$commit" "$candidate_bft_release" "$binding_sha" "${DEPLOY_DRY_RUN:-0}" || { echo "actual original operator verification is required; dry-run cannot authorize activation" >&2; exit 1; }
}

gateway_runtime_pins() {
  local bin
  bin="$(dirname "$public_package_verifier")"
  if public_bft_linux_tools_enabled; then
    gateway_binary_sha="$(public_bft_runtime_binary_sha "$bin" ynx-bft-gatewayd)"
    gateway_verifier_sha="$(public_bft_runtime_binary_sha "$bin" ynx-consensus-package)"
  else
    gateway_binary_sha="$(shasum -a 256 "$bin/ynx-bft-gatewayd" | awk '{print $1}')"
    gateway_verifier_sha="$(shasum -a 256 "$public_package_verifier" | awk '{print $1}')"
  fi
  if [[ "${DEPLOY_DRY_RUN:-0}" == 1 ]]; then
    dependency_backup_sha=unobserved-dry-run
  else
    dependency_backup_sha="$(node -e 'const fs=require("fs"),v=JSON.parse(fs.readFileSync(process.argv[1]));if(!/^[0-9a-f]{64}$/.test(v.backupSHA256||"")||/^0+$/.test(v.backupSHA256))process.exit(1);process.stdout.write(v.backupSHA256)' "$dependency_root/start-attempt/guard/primary/validated.json")"
  fi
}

gateway_helper_command() {
  local operation="$1"
  # The ten old signer arguments are deliberately empty. The explicit profile
  # and all seven independent material pins select the normal gateway only.
  printf "sudo bash '%s' '%s' '%s' '%s' '%s' '%s' '%s' '%s' '' '' '' '' '' '' '' '' '' '' 'single-app-gateway' '%s' '%s' '%s' '%s' '%s' '%s' '%s'" \
    "$dependency_helper" "$operation" "$candidate_transaction_id" "$commit" "$candidate_bft_release" "$dependency_migration_height" "$dependency_migration_hash" "$dependency_remote_root" \
    "$candidate_operator_pin" "$CONSENSUS_CANDIDATE_RUNTIME_COMMIT" "$CONSENSUS_CANDIDATE_RUNTIME_MANIFEST_SHA256" "$gateway_binary_sha" "$gateway_verifier_sha" "$dependency_stage" "$dependency_backup_sha"
}

gateway_dry_receipt() {
  local operation="$1" output="$2"
  node - "$candidate_binding" "$operation" "$gateway_binary_sha" "$gateway_verifier_sha" >"$output" <<'NODE'
const fs=require("fs"),[p,operation,g,v]=process.argv.slice(2),b=JSON.parse(fs.readFileSync(p));
const common={mode:"single-app-gateway",transactionId:b.transactionId,commit:b.commit,bftRelease:b.bftRelease,migrationHeight:b.finalSnapshotHeight,migrationBlockHash:b.finalSnapshotBlockHash.replace(/^0x/,""),operatorPlanSHA256:b.operatorPlanSha256,runtimeCommit:b.runtimeCommit,runtimeSOURCEsha256:b.runtimeManifestSha256,gatewaySHA256:g,packageVerifierSHA256:v,backupSHA256:"unobserved-dry-run",dryRun:true};
console.log(JSON.stringify({...common,...(operation==="start"?{dependenciesActive:false,parallelCandidateOnly:true,publicIngressChanged:false,pqActivationVerified:false}:{gatewayStopped:false,rolledBack:false,originalMaterialRetained:true})}));
NODE
}

validated_gateway_start() {
  gateway_runtime_pins
  node scripts/verify/public-bft-candidate-binding.mjs --gateway-receipt "$candidate_binding" "$dependency_root/start-result.json" start "${DEPLOY_DRY_RUN:-0}" "$gateway_binary_sha" "$gateway_verifier_sha" "$dependency_backup_sha"
}

start_dependencies_phase() {
  [[ "${PUBLIC_BFT_PRODUCTION_DEPENDENCIES_APPROVED:-}" == yes ]] || { echo "PUBLIC_BFT_PRODUCTION_DEPENDENCIES_APPROVED=yes is required" >&2; exit 1; }
  prepare_candidate_package
  dependency_context
  validated_candidate_result
  umask 077
  mkdir -p "$dependency_root"
  local attempt="$dependency_root/start-attempt" dry="${DEPLOY_DRY_RUN:-0}" remote_root="$dependency_remote_root"
  mkdir -m 0700 "$attempt" || { echo "gateway start attempt exists (possibly UNKNOWN); retain original bytes, no retry" >&2; exit 1; }
  printf '{"mode":"single-app-gateway","status":"unknown","automaticRetry":false}\n' >"$attempt/intent.json"
  local candidate_guard_root="$attempt/guard"
  mkdir -m 0700 "$candidate_guard_root"
  collect_candidate_original_guard primary "$PRIMARY_NODE_USER" "$PRIMARY_NODE_HOST" "$PRIMARY_NODE_SSH_KEY" full
  gateway_runtime_pins
  local stage="$attempt/stage" archive="$attempt/gateway-runtime.tar.gz" bin upload archive_sha helper_sha command guard
  bin="$(dirname "$public_package_verifier")"
  mkdir -m 0700 "$stage"
  cp "$bin/SOURCE.json" "$stage/runtime-SOURCE.json"
  if ! public_bft_linux_tools_enabled; then
    cp "$bin/ynx-bft-gatewayd" "$stage/ynx-bft-gatewayd"
    cp "$public_package_verifier" "$stage/ynx-consensus-package"
  fi
  cp scripts/ops/remote/public-bft-dependencies.sh "$stage/public-bft-dependencies.sh"
  cp -R "$candidate_package" "$stage/package"
  chmod 0700 "$stage/public-bft-dependencies.sh"
  if ! public_bft_linux_tools_enabled; then chmod 0700 "$stage/ynx-bft-gatewayd" "$stage/ynx-consensus-package"; fi
  public_bft_package_call "$stage/ynx-consensus-package" -verify-package "$stage/package" -operator-plan-hash "$candidate_operator_pin" >/dev/null
  tar -czf "$archive" -C "$stage" .
  chmod 0600 "$archive"
  archive_sha="$(shasum -a 256 "$archive" | awk '{print $1}')"
  helper_sha="$(shasum -a 256 "$stage/public-bft-dependencies.sh" | awk '{print $1}')"
  upload="/tmp/ynx-gateway-upload-${candidate_transaction_id}"
  # Both remote destinations are reserved before copy. No overwrite or cleanup
  # of an existing/partial archive, helper, package, unit, or uncertain result.
  ynx_ops_ssh primary "$PRIMARY_NODE_USER" "$PRIMARY_NODE_HOST" "$PRIMARY_NODE_SSH_KEY" "set -euo pipefail; sudo test -d '$dependency_remote_root'; sudo test ! -L '$dependency_remote_root'; sudo mkdir -m 0700 '$dependency_stage'; umask 077; mkdir -m 0700 '$upload'" >"$attempt/reserve.txt"
  ynx_ops_copy primary "$PRIMARY_NODE_USER" "$PRIMARY_NODE_HOST" "$PRIMARY_NODE_SSH_KEY" "$archive" "$upload/runtime.tar.gz"
  if public_bft_linux_tools_enabled; then
    [[ "$dependency_remote_root" == "/var/backups/ynx-chain/public-bft-cutover/$candidate_transaction_id" ]] || { echo "public tool bridge requires the original fixed gateway stage" >&2; return 1; }
    public_bft_linux_stage primary gateway >"$attempt/public-tools.json"
  fi
  guard="$(candidate_original_guard_command primary)"
  command="set -euo pipefail
$guard
printf '%s  %s\n' '$archive_sha' '$upload/runtime.tar.gz' | sha256sum --strict -c - >/dev/null
sudo tar --no-same-owner -xzf '$upload/runtime.tar.gz' -C '$dependency_stage'
printf '%s  %s\n' '$helper_sha' '$dependency_helper' | sudo sha256sum --strict -c - >/dev/null
$(gateway_helper_command start)"
  printf '%s\n' "$command" >"$attempt/command.sh"
  ynx_ops_ssh primary "$PRIMARY_NODE_USER" "$PRIMARY_NODE_HOST" "$PRIMARY_NODE_SSH_KEY" "$command" >"$attempt/output.txt" 2>"$attempt/error.txt"
  if [[ "$dry" == 1 ]]; then gateway_dry_receipt start "$attempt/result.json"; else
    ynx_ops_ssh primary "$PRIMARY_NODE_USER" "$PRIMARY_NODE_HOST" "$PRIMARY_NODE_SSH_KEY" "sudo test ! -L '$dependency_remote_root/primary-dependencies-start.json'; sudo cat '$dependency_remote_root/primary-dependencies-start.json'" >"$attempt/result.json"
  fi
  node scripts/verify/public-bft-candidate-binding.mjs --gateway-receipt "$candidate_binding" "$attempt/result.json" start "$dry" "$gateway_binary_sha" "$gateway_verifier_sha" "$dependency_backup_sha"
  ln "$attempt/result.json" "$dependency_root/start-result.json"
}

verify_continuity_phase() {
  [[ "${PUBLIC_BFT_PRODUCTION_DEPENDENCIES_APPROVED:-}" == yes ]] || exit 1
  prepare_candidate_package
  dependency_context
  validated_candidate_result
  validated_gateway_start
  local observation="${PUBLIC_BFT_DEPENDENCY_CONTINUITY_OBSERVATION_SECONDS:-4}" evidence="$dependency_root/continuity"
  [[ "$observation" =~ ^[0-9]+$ ]] && ((observation >= 2 && observation <= 15)) || exit 1
  # A partial previous observation is original evidence, not scratch space.
  (umask 077; mkdir -m 0700 "$evidence") || { echo "original continuity evidence exists; retain UNKNOWN" >&2; exit 1; }
  ynx_ops_ssh primary "$PRIMARY_NODE_USER" "$PRIMARY_NODE_HOST" "$PRIMARY_NODE_SSH_KEY" "curl --noproxy '*' --max-time 10 -fsS http://127.0.0.1:27620/health" >"$evidence/gateway-before-health.json"
  if [[ "${DEPLOY_DRY_RUN:-0}" == 1 ]]; then
    node - "$candidate_binding" >"$evidence/result.json" <<'NODE'
const fs=require("fs"),crypto=require("crypto"),p=process.argv[2],raw=fs.readFileSync(p),b=JSON.parse(raw);
console.log(JSON.stringify({version:"YNX-SINGLE-APP-GATEWAY-CONTINUITY/v1",mode:"single-app-gateway",transactionId:b.transactionId,commit:b.commit,bftRelease:b.bftRelease,operatorPlanSHA256:b.operatorPlanSha256,runtimeCommit:b.runtimeCommit,runtimeSOURCEsha256:b.runtimeManifestSha256,bindingSHA256:crypto.createHash("sha256").update(raw).digest("hex"),migrationHeight:b.finalSnapshotHeight,migrationBlockHash:b.finalSnapshotBlockHash.replace(/^0x/,""),verified:false,dryRun:true,parallelCandidateOnly:true,publicIngressChanged:false,pqIdentityObserved:false,pqIdentitySHA256:null,independentFinalityVerified:false,ecosystemContinuityVerified:false}));
NODE
  else
    sleep "$observation"
    ynx_ops_ssh primary "$PRIMARY_NODE_USER" "$PRIMARY_NODE_HOST" "$PRIMARY_NODE_SSH_KEY" "curl --noproxy '*' --max-time 10 -fsS http://127.0.0.1:27620/health" >"$evidence/gateway-after-health.json"
    ynx_ops_ssh primary "$PRIMARY_NODE_USER" "$PRIMARY_NODE_HOST" "$PRIMARY_NODE_SSH_KEY" "curl --noproxy '*' --max-time 10 -fsS http://127.0.0.1:27620/status" >"$evidence/gateway-status.json"
    # Read the protocol entry point through this exact gateway as well. A
    # healthy legacy service or an HTTP 405 cannot qualify the new protocol.
    # Keep a failed/partial observation and never retry this evidence directory.
    ynx_ops_ssh primary "$PRIMARY_NODE_USER" "$PRIMARY_NODE_HOST" "$PRIMARY_NODE_SSH_KEY" "curl --disable --noproxy '*' --request GET --connect-timeout 5 --max-time 10 --max-redirs 0 --max-filesize 16777216 -fsS http://127.0.0.1:27620/node/pq-identity" >"$evidence/gateway-pq-identity.json"
    node scripts/verify/public-bft-candidate-binding.mjs --gateway-observe "$candidate_binding" "$dependency_root/start-result.json" "$evidence/gateway-before-health.json" "$evidence/gateway-after-health.json" "$evidence/gateway-status.json" "$evidence/gateway-pq-identity.json" >"$evidence/result.json"
  fi
  node scripts/verify/public-bft-candidate-binding.mjs --continuity-check "$candidate_binding" "$evidence/result.json" "${DEPLOY_DRY_RUN:-0}"
  ln "$evidence/result.json" "$dependency_root/continuity-result.json"
}

rollback_dependencies_phase() {
  prepare_candidate_package
  dependency_context
  node scripts/verify/validate-public-bft-cutover-approval-evidence.mjs "$dependency_approval" "$commit" "$candidate_bft_release" >/dev/null
  validated_gateway_start
  local attempt="$dependency_root/rollback-attempt"
  (umask 077; mkdir -m 0700 "$attempt") || { echo "original gateway rollback attempt exists; no retry or removal" >&2; exit 1; }
  ynx_ops_ssh primary "$PRIMARY_NODE_USER" "$PRIMARY_NODE_HOST" "$PRIMARY_NODE_SSH_KEY" "set -euo pipefail; $(gateway_helper_command rollback)" >"$attempt/output.txt" 2>"$attempt/error.txt"
  if [[ "${DEPLOY_DRY_RUN:-0}" == 1 ]]; then gateway_dry_receipt rollback "$attempt/result.json"; else
    ynx_ops_ssh primary "$PRIMARY_NODE_USER" "$PRIMARY_NODE_HOST" "$PRIMARY_NODE_SSH_KEY" "sudo cat '$dependency_remote_root/primary-dependencies-rollback.json'" >"$attempt/result.json"
  fi
  node scripts/verify/public-bft-candidate-binding.mjs --gateway-receipt "$candidate_binding" "$attempt/result.json" rollback "${DEPLOY_DRY_RUN:-0}" "$gateway_binary_sha" "$gateway_verifier_sha" "$dependency_backup_sha"
  ln "$attempt/result.json" "$dependency_root/rollback-result.json"
}

ingress_context() {
  dependency_context
  ingress_root="$candidate_transaction_dir/ingress"
  ingress_remote_root="$dependency_remote_root"
  local source_values
  source_values="$(node --input-type=module -e 'import fs from "node:fs";import {caddySourceIdentity} from "./scripts/verify/lib/public-bft-native-source.mjs";const a=caddySourceIdentity(JSON.parse(fs.readFileSync(process.argv[1]))).caddySource;console.log(a?`single-app-gateway-json ${a.manifestPath} ${a.manifestSha256}`:"single-app-gateway - -")' "$candidate_binding")" || return $?
  read -r ingress_mode ingress_manifest_remote ingress_manifest_sha <<<"$source_values"
}

validated_ingress_result() {
  local operation="$1" result="$2"
  local -a source_args=()
  if [[ "$ingress_mode" == single-app-gateway-json ]]; then source_args+=("$ingress_root/$operation-attempt/caddy-source-manifest.json"); fi
  node scripts/verify/public-bft-candidate-binding.mjs --ingress-check "$candidate_binding" "$result" "$operation" "${DEPLOY_DRY_RUN:-0}" "$gateway_binary_sha" ${source_args[@]+"${source_args[@]}"}
}

validated_continuity_result() {
  node scripts/verify/public-bft-candidate-binding.mjs --continuity-check "$candidate_binding" "$dependency_root/continuity-result.json" "${DEPLOY_DRY_RUN:-0}"
}

gateway_ingress_phase() {
  local operation="$1"
  [[ "${PUBLIC_BFT_PRODUCTION_INGRESS_APPROVED:-}" == yes || "$operation" == rollback ]] || { echo "PUBLIC_BFT_PRODUCTION_INGRESS_APPROVED=yes is required" >&2; exit 1; }
  prepare_candidate_package
  ingress_context
  node scripts/verify/validate-public-bft-cutover-approval-evidence.mjs "$candidate_approval" "$commit" "$candidate_bft_release" >/dev/null
  validated_gateway_start
  if [[ "$operation" == switch ]]; then validated_candidate_result; validated_continuity_result; fi
  umask 077
  mkdir -p "$ingress_root"
  local attempt="$ingress_root/$operation-attempt" remote="/tmp/ynx-ingress-${candidate_transaction_id}-$operation" helper hash json_hash command
  mkdir -m 0700 "$attempt" || { echo "original RPC ingress attempt exists; retain UNKNOWN, no automatic retry" >&2; exit 1; }
  printf '{"mode":"%s","status":"unknown","automaticRetry":false}\n' "$ingress_mode" >"$attempt/intent.json"
  if [[ "$ingress_mode" == single-app-gateway-json ]]; then
    # This is metadata only. Verify the independently approved bytes before
    # reading them, keep them private, and qualify them before remote staging.
    ynx_ops_ssh primary "$PRIMARY_NODE_USER" "$PRIMARY_NODE_HOST" "$PRIMARY_NODE_SSH_KEY" "set -euo pipefail; sudo test -f '$ingress_manifest_remote'; sudo test ! -L '$ingress_manifest_remote'; test \"\$(sudo realpath -e '$ingress_manifest_remote')\" = '$ingress_manifest_remote'; test \"\$(sudo stat -c %a '$ingress_manifest_remote')\" = 600; test \"\$(sudo stat -c %h '$ingress_manifest_remote')\" = 1; test \"\$(sudo stat -c %s '$ingress_manifest_remote')\" -le 65536; printf '%s  %s\n' '$ingress_manifest_sha' '$ingress_manifest_remote' | sudo sha256sum --strict -c - >/dev/null; sudo head -c 65537 '$ingress_manifest_remote'" >"$attempt/caddy-source-manifest.json" 2>"$attempt/source-error.txt"
    node scripts/verify/public-bft-candidate-binding.mjs --caddy-source-check "$candidate_binding" "$attempt/caddy-source-manifest.json" "$gateway_binary_sha"
  fi
  helper="$remote/helper.sh"
  hash="$(shasum -a 256 scripts/ops/remote/public-bft-ingress.sh | awk '{print $1}')"
  ynx_ops_ssh primary "$PRIMARY_NODE_USER" "$PRIMARY_NODE_HOST" "$PRIMARY_NODE_SSH_KEY" "umask 077; mkdir -m 0700 '$remote'" >"$attempt/reserve.txt"
  ynx_ops_copy primary "$PRIMARY_NODE_USER" "$PRIMARY_NODE_HOST" "$PRIMARY_NODE_SSH_KEY" scripts/ops/remote/public-bft-ingress.sh "$helper"
  command="set -euo pipefail; printf '%s  %s\n' '$hash' '$helper' | sha256sum --strict -c - >/dev/null; "
  if [[ "$ingress_mode" == single-app-gateway-json ]]; then
    json_hash="$(shasum -a 256 scripts/ops/remote/public-bft-caddy-json.py | awk '{print $1}')"
    ynx_ops_copy primary "$PRIMARY_NODE_USER" "$PRIMARY_NODE_HOST" "$PRIMARY_NODE_SSH_KEY" scripts/ops/remote/public-bft-caddy-json.py "$remote/public-bft-caddy-json.py"
    command+="printf '%s  %s\n' '$json_hash' '$remote/public-bft-caddy-json.py' | sha256sum --strict -c - >/dev/null; "
  fi
  command+="sudo bash '$helper' '$operation' '$candidate_transaction_id' '$commit' '$candidate_bft_release' '$ingress_remote_root' '$ingress_mode' '$candidate_operator_pin' '$CONSENSUS_CANDIDATE_RUNTIME_COMMIT' '$CONSENSUS_CANDIDATE_RUNTIME_MANIFEST_SHA256' '$gateway_binary_sha'"
  if [[ "$ingress_mode" == single-app-gateway-json ]]; then command+=" '$ingress_manifest_remote' '$ingress_manifest_sha'"; fi
  ynx_ops_ssh primary "$PRIMARY_NODE_USER" "$PRIMARY_NODE_HOST" "$PRIMARY_NODE_SSH_KEY" "$command" >"$attempt/output.txt" 2>"$attempt/error.txt"
  if [[ "${DEPLOY_DRY_RUN:-0}" == 1 ]]; then
    node - "$candidate_binding" "$operation" "$gateway_binary_sha" "$attempt/caddy-source-manifest.json" >"$attempt/result.json" <<'NODE'
const fs=require("fs"),[p,op,gatewaySHA256]=process.argv.slice(2),b=JSON.parse(fs.readFileSync(p));
const m=b.caddySource?JSON.parse(fs.readFileSync(process.argv[5])):null;
console.log(JSON.stringify({version:"YNX-SINGLE-APP-GATEWAY-INGRESS/v1",mode:m?"single-app-gateway-json":"single-app-gateway",transactionId:b.transactionId,commit:b.commit,bftRelease:b.bftRelease,operatorPlanSHA256:b.operatorPlanSha256,runtimeCommit:b.runtimeCommit,runtimeSOURCEsha256:b.runtimeManifestSha256,gatewaySHA256,...(m?{caddySourceManifestSHA256:b.caddySource.manifestSha256,sourceSHA256:m.source.sha256,baselineSemanticSHA256:m.baseline.semanticSHA256,candidateSemanticSHA256:m.baseline.candidateSemanticSHA256,dropInSHA256:m.baseline.dropInSHA256}:{}),rpcOnly:true,ecosystemContinuityVerified:false,ingress:op==="switch"?"bft":"authoritative",publicCutoverReady:false,publicIngressChanged:false,dryRun:true}));
NODE
  else
    ynx_ops_ssh primary "$PRIMARY_NODE_USER" "$PRIMARY_NODE_HOST" "$PRIMARY_NODE_SSH_KEY" "sudo cat '$ingress_remote_root/ingress/$operation.json'" >"$attempt/result.json"
  fi
  validated_ingress_result "$operation" "$attempt/result.json"
  ln "$attempt/result.json" "$ingress_root/$operation-result.json"
}

switch_ingress_phase() {
  gateway_ingress_phase switch
}

rollback_ingress_phase() {
  gateway_ingress_phase rollback
}

verify_public_phase() {
  [[ "${PUBLIC_BFT_PRODUCTION_INGRESS_APPROVED:-}" == yes ]] || exit 1
  prepare_candidate_package
  ingress_context
  validated_candidate_result
  validated_gateway_start
  validated_continuity_result
  validated_ingress_result switch "$ingress_root/switch-result.json"
  local observation="${PUBLIC_BFT_PUBLIC_OBSERVATION_SECONDS:-4}" evidence="$ingress_root/public-continuity"
  [[ "$observation" =~ ^[0-9]+$ ]] && ((observation >= 2 && observation <= 15)) || exit 1
  local rpc="${PUBLIC_RPC_URL:-https://rpc.ynxweb4.com}" evm="${PUBLIC_EVM_RPC_URL:-https://evm.ynxweb4.com}"
  rpc="${rpc%/}"; evm="${evm%/}"
  [[ "$rpc" =~ ^https://[A-Za-z0-9.-]+$ && "$evm" =~ ^https://[A-Za-z0-9.-]+$ ]] || exit 1
  umask 077
  mkdir -m 0700 "$evidence" || { echo "original public observation exists; retain UNKNOWN" >&2; exit 1; }
  if [[ "${DEPLOY_DRY_RUN:-0}" == 1 ]]; then
    node - "$candidate_binding" >"$evidence/result.json" <<'NODE'
const fs=require("fs"),crypto=require("crypto"),p=process.argv[2],raw=fs.readFileSync(p),b=JSON.parse(raw);
console.log(JSON.stringify({version:"YNX-SINGLE-APP-GATEWAY-PUBLIC/v1",mode:"single-app-gateway",transactionId:b.transactionId,commit:b.commit,bftRelease:b.bftRelease,operatorPlanSHA256:b.operatorPlanSha256,runtimeCommit:b.runtimeCommit,runtimeSOURCEsha256:b.runtimeManifestSha256,bindingSHA256:crypto.createHash("sha256").update(raw).digest("hex"),migrationHeight:b.finalSnapshotHeight,migrationBlockHash:b.finalSnapshotBlockHash.replace(/^0x/,""),verified:false,dryRun:true,RPCOnly:true,publicIngressChanged:false,pqIdentityObserved:false,pqIdentitySHA256:null,independentFinalityVerified:false,ecosystemContinuityVerified:false}));
NODE
    printf 'DRY RUN RPC-only public observation: %s %s\n' "$rpc" "$evm" >"$evidence/endpoints.txt"
  else
    curl --noproxy '*' --max-time 10 -fsS "$rpc/health" >"$evidence/gateway-before-health.json"
    sleep "$observation"
    curl --noproxy '*' --max-time 10 -fsS "$rpc/health" >"$evidence/gateway-after-health.json"
    curl --noproxy '*' --max-time 10 -fsS "$rpc/status" >"$evidence/gateway-status.json"
    curl --disable --noproxy '*' --request GET --connect-timeout 5 --max-time 10 --max-redirs 0 --max-filesize 16777216 -fsS "$rpc/node/pq-identity" >"$evidence/gateway-pq-identity.json"
    node scripts/verify/public-bft-candidate-binding.mjs --gateway-observe "$candidate_binding" "$dependency_root/start-result.json" "$evidence/gateway-before-health.json" "$evidence/gateway-after-health.json" "$evidence/gateway-status.json" "$evidence/gateway-pq-identity.json" public >"$evidence/observation.json"
    curl --noproxy '*' --max-time 10 -fsS -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' "$evm" >"$evidence/evm-chain-id.json"
    node scripts/verify/public-bft-candidate-binding.mjs --public-read-targets "$candidate_binding" "$candidate_migration" "$evidence/gateway-status.json" >"$evidence/read-targets.txt"
    local account height retained_height retained_quantity retained_request
    read -r account height <"$evidence/read-targets.txt"
    retained_height=$((height - 1))
    printf -v retained_quantity '0x%x' "$retained_height"
    printf -v retained_request '{"jsonrpc":"2.0","id":2,"method":"eth_getBlockByNumber","params":["%s",false]}' "$retained_quantity"
    curl --noproxy '*' --max-time 10 -fsS "$rpc/accounts/$account" >"$evidence/account.json"
    curl --noproxy '*' --max-time 10 -fsS "$rpc/blocks/$height" >"$evidence/block.json"
    curl --disable --noproxy '*' --max-time 10 --max-filesize 33554432 -fsS "$rpc/blocks/$retained_height" >"$evidence/retained-native-block.json"
    curl --disable --noproxy '*' --max-time 10 --max-filesize 67108864 -fsS -H 'content-type: application/json' -d "$retained_request" "$evm" >"$evidence/retained-evm-block.json"
    local mutation_code
    mutation_code="$(curl --noproxy '*' --max-time 10 -sS -o /dev/null -w '%{http_code}' -H 'content-type: application/json' -d '{}' "$rpc/__ynx_mutation_freeze_probe__")"
    [[ "$mutation_code" =~ ^[0-9]{3}$ ]] || exit 1
    printf '{"httpStatus":%s}\n' "$mutation_code" >"$evidence/mutation-freeze.json"
    node scripts/verify/public-bft-candidate-binding.mjs --public-readback "$candidate_binding" "$evidence" >"$evidence/result.json"
  fi
  node scripts/verify/public-bft-candidate-binding.mjs --public-result-check "$candidate_binding" "$evidence/result.json" "${DEPLOY_DRY_RUN:-0}" "$evidence"
  ln "$evidence/result.json" "$ingress_root/public-result.json"
}
release_ref="$(git symbolic-ref --quiet HEAD)" || { echo "production driver requires an original named release checkout" >&2; exit 1; }
case "$release_ref" in
  refs/heads/main) ;; # Preserve the original standalone/handover/recovery path.
  refs/heads/codex/ynx-pq-public-upgrade|refs/heads/codex/ynx-pq-perf-integration)
    # Reuse the transaction's protected same-owner release qualification, not
    # a branch/environment bypass. This admits only its existing forward calls;
    # it does not add an incident rollback or change UNKNOWN reconciliation.
    release_mode="${PUBLIC_BFT_CUTOVER_MODE:-}"
    case "$release_mode:$action" in
      abort-native:abort_native_preflight|abort-native:resume_authoritative|abort-native:unfreeze_mutations|abort-native:verify_recovery) projection=preparation-approval.json ;;
      prepare-native:preflight|prepare-native:backup|prepare-native:freeze_mutations|prepare-native:pause_authoritative|prepare-native:capture_snapshot_source|prepare-native:prepare_testnet_assets) projection=preparation-approval.json ;;
      export-native:export_final_snapshot|export-native:derive_frozen_bootstrap) projection=snapshot-approval.json ;;
      continue-native:verify_frozen_snapshot|continue-native:initialize_candidate|continue-native:deploy_candidate|continue-native:start_candidate|continue-native:verify_candidate) projection=approval.json ;;
      continue-pq-native:verify_pq_continuation|continue-pq-native:start_dependencies|continue-pq-native:verify_continuity|continue-pq-native:switch_ingress|continue-pq-native:verify_public|continue-pq-native:unfreeze_mutations) projection=approval.json ;;
      *) echo "production release driver requires its original native forward phase" >&2; exit 1 ;;
    esac
    [[ "${PUBLIC_BFT_CUTOVER_APPROVED:-}" == yes ]] || { echo "original cutover approval is required" >&2; exit 1; }
    if [[ "$release_mode" == abort-native ]]; then
      node scripts/verify/public-bft-release-source.mjs "${PUBLIC_BFT_CUTOVER_APPROVAL_FILE:-}" "${PUBLIC_BFT_CUSTODY_REVIEW_FILE:-}" abort-native "${PUBLIC_BFT_CUTOVER_TRANSACTION_DIR:-}" >/dev/null
      python3 -B scripts/ops/public-bft-quiet-continuation.py abort-check --transaction "$PUBLIC_BFT_CUTOVER_TRANSACTION_DIR" --phase "$action"
    else
      node scripts/verify/public-bft-release-source.mjs "${PUBLIC_BFT_CUTOVER_APPROVAL_FILE:-}" "${PUBLIC_BFT_CUSTODY_REVIEW_FILE:-}" "$release_mode" >/dev/null
    # The independently validated original must be the same projection retained
    # by the parent transaction. Do not create, repair, or advance that record.
    node --input-type=module - "${PUBLIC_BFT_CUTOVER_APPROVAL_FILE:-}" "${PUBLIC_BFT_CUSTODY_REVIEW_FILE:-}" "${PUBLIC_BFT_CUTOVER_TRANSACTION_DIR:-}" "$projection" "$release_mode" "$(git rev-parse --short=12 HEAD)" <<'RELEASE_PROJECTION'
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
import {readSameOwnerOriginal,readSameOwnerJSON,validateSameOwnerApproval} from './scripts/verify/lib/public-bft-same-owner.mjs';
const [original,review,root,name,mode,commit]=process.argv.slice(2),release=`ynx-bft-gateway-${commit}`;
assert.ok(path.isAbsolute(root)&&path.normalize(root)===root&&fs.realpathSync(root)===root,'original canonical transaction required');
const st=fs.lstatSync(root);assert.ok(st.isDirectory()&&(st.mode&0o077)===0&&st.uid===process.geteuid(),'original private transaction required');
const approval=validateSameOwnerApproval(readSameOwnerJSON(original),review,commit,release,mode==='prepare-native',{snapshot:mode==='export-native'});
assert.equal(approval.transactionId,path.basename(root),'original transaction differs from approval');
assert.deepEqual(readSameOwnerOriginal(path.join(root,name)).raw,Buffer.from(JSON.stringify(approval)+'\n'),'retained parent approval differs');
RELEASE_PROJECTION
    fi
    ;;
  *) echo "production driver requires main or an independently qualified same-owner normal release ref" >&2; exit 1 ;;
esac
[[ -z "$(git status --short --untracked-files=no)" ]] || { echo "production driver requires no tracked worktree changes" >&2; exit 1; }

commit="$(git rev-parse --short=12 HEAD)"
release="ynx-chain-${commit}"
public_bft_native_context
if [[ "${PUBLIC_BFT_CUTOVER_MODE:-}" == abort-native ]]; then
  [[ "${DEPLOY_DRY_RUN:-0}" != 1 && "${PUBLIC_BFT_CUTOVER_APPROVED:-}" == yes ]] || { echo 'native inverse requires explicit real original operation' >&2; exit 1; }
  node scripts/verify/public-bft-release-source.mjs "${PUBLIC_BFT_CUTOVER_APPROVAL_FILE:-}" "${PUBLIC_BFT_CUSTODY_REVIEW_FILE:-}" abort-native "$PUBLIC_BFT_CUTOVER_TRANSACTION_DIR" >/dev/null
  export YNX_DEPLOY_CONNECTION_ATTEMPTS=1
  mkdir -m 0700 "$PUBLIC_BFT_CUTOVER_TRANSACTION_DIR/abort-attempt/$action"
  if [[ "$action" == abort_native_preflight ]]; then abort_native_preflight_phase; exit 0; fi
fi
if [[ "$action" == capture_snapshot_source ]]; then
  capture_snapshot_source_phase
  exit 0
fi
if [[ "$testnet_assets_action" == true ]]; then
  prepare_testnet_assets_phase
  exit 0
fi
if [[ "$action" == derive_frozen_bootstrap ]]; then
  derive_frozen_bootstrap_phase
  exit 0
fi
if [[ "$action" == verify_frozen_snapshot ]]; then
  [[ "${PUBLIC_BFT_CUTOVER_MODE:-}" == continue-native && "${DEPLOY_DRY_RUN:-0}" != 1 ]] || exit 1
  transaction_dir="${PUBLIC_BFT_CUTOVER_TRANSACTION_DIR:?original native transaction required}"
  migration="$(frozen_snapshot_path "$transaction_dir")"
  node scripts/verify/public-bft-candidate-binding.mjs --frozen-snapshot "$transaction_dir" "$migration" "$(git rev-parse HEAD)" "$native_approval_path" >/dev/null
  exit 0
fi
if [[ "$action" == export_final_snapshot && "${PUBLIC_BFT_CUTOVER_MODE:-}" != export-native && -n "${native_approval_path:-}" ]] && node -e 'process.exit(JSON.parse(require("fs").readFileSync(process.argv[1])).custodyProfile==="single-app-same-owner-inplace/v1"?0:1)' "$native_approval_path"; then
  echo 'same-owner continuation must reuse its frozen migration' >&2
  exit 1
fi

backup_phase() {
  [[ "${PUBLIC_BFT_PRODUCTION_BACKUP_APPROVED:-}" == "yes" ]] || {
    echo "PUBLIC_BFT_PRODUCTION_BACKUP_APPROVED=yes is required" >&2
    exit 1
  }
  [[ "${PUBLIC_BFT_CUTOVER_COMMIT:-}" == "$commit" ]] || {
    echo "backup commit does not match current HEAD" >&2
    exit 1
  }
  local bft_release="ynx-bft-gateway-${commit}"
  [[ "${PUBLIC_BFT_CUTOVER_RELEASE:-}" == "$bft_release" ]] || {
    echo "backup BFT release does not match current HEAD" >&2
    exit 1
  }
  local transaction_dir="${PUBLIC_BFT_CUTOVER_TRANSACTION_DIR:-}"
  [[ -n "$transaction_dir" && -d "$transaction_dir" ]] || {
    echo "PUBLIC_BFT_CUTOVER_TRANSACTION_DIR must be an existing directory" >&2
    exit 1
  }
  local transaction_id
  transaction_id="$(basename "$transaction_dir")"
  [[ "$transaction_id" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$ ]] || {
    echo "invalid public BFT cutover transaction id" >&2
    exit 1
  }
  local evidence_dir="$transaction_dir/roles"
  umask 077
  mkdir -p "$evidence_dir"

  backup_role() {
    local role="$1" user="$2" host="$3" key="$4" kind="$5"
    local remote_root="${BACKUP_STORAGE_PATH:-/var/backups/ynx-chain}/public-bft-cutover/${transaction_id}"
    local remote_helper="/tmp/ynx-public-bft-scoped-backup-${transaction_id}-${role}.sh"
    local indexer_required=false
    [[ "$kind" == "full" ]] && indexer_required=true
    public_bft_native_qualify "$role" "$user" "$host" "$key" "$evidence_dir/${role}-backup-native-identity.json"
    ynx_ops_copy "$role" "$user" "$host" "$key" scripts/ops/remote/public-bft-scoped-backup.sh "$remote_helper"
    ynx_ops_ssh "$role" "$user" "$host" "$key" "set -euo pipefail; trap 'rm -f \"$remote_helper\"' EXIT; chmod 0700 '$remote_helper'; sudo bash '$remote_helper' '$transaction_id' '$role' '$commit' '$role_native_release' '$bft_release' '$remote_root' '$indexer_required' / '$role_native_full'" >"$evidence_dir/${role}-backup.txt"
  }
  ynx_ops_each_node backup_role
  echo "production BFT scoped backups passed: transaction=$transaction_id evidence=$evidence_dir"
}

mutation_freeze_phase() {
  local operation="$1"
  if [[ "$operation" == unfreeze && ( -e "${PUBLIC_BFT_CUTOVER_TRANSACTION_DIR:-}/candidate/initialize-attempt" || -L "${PUBLIC_BFT_CUTOVER_TRANSACTION_DIR:-}/candidate/initialize-attempt" ) ]]; then
    prepare_candidate_package
    quiet_forward_gate
    ingress_context
    node scripts/verify/public-bft-candidate-binding.mjs --public-result-check "$candidate_binding" "$ingress_root/public-result.json" "${DEPLOY_DRY_RUN:-0}" "$ingress_root/public-continuity"
    # Removing the shared mutation marker never removes the independent native
    # producer pause marker or resumes the old writer.
  fi
  if [[ "$operation" == "freeze" ]]; then
    [[ "${PUBLIC_BFT_PRODUCTION_FREEZE_APPROVED:-}" == "yes" ]] || {
      echo "PUBLIC_BFT_PRODUCTION_FREEZE_APPROVED=yes is required" >&2
      exit 1
    }
  fi
  [[ "${PUBLIC_BFT_CUTOVER_COMMIT:-}" == "$commit" ]] || {
    echo "mutation freeze commit does not match current HEAD" >&2
    exit 1
  }
  local bft_release="ynx-bft-gateway-${commit}"
  [[ "${PUBLIC_BFT_CUTOVER_RELEASE:-}" == "$bft_release" ]] || {
    echo "mutation freeze BFT release does not match current HEAD" >&2
    exit 1
  }
  local transaction_dir="${PUBLIC_BFT_CUTOVER_TRANSACTION_DIR:-}"
  [[ -n "$transaction_dir" && -d "$transaction_dir" ]] || {
    echo "PUBLIC_BFT_CUTOVER_TRANSACTION_DIR must be an existing directory" >&2
    exit 1
  }
  local transaction_id
  transaction_id="$(basename "$transaction_dir")"
  [[ "$transaction_id" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$ ]] || {
    echo "invalid public BFT cutover transaction id" >&2
    exit 1
  }
  local evidence_dir="$transaction_dir/roles"
  mkdir -p "$evidence_dir"
  if [[ "$operation" == "freeze" ]]; then
    local backup_evidence role
    for role in primary singapore silicon-valley seoul; do
      backup_evidence="$evidence_dir/${role}-backup.txt"
      test -s "$backup_evidence"
      grep -Fq "transactionId=$transaction_id" "$backup_evidence"
      grep -Fq "role=$role" "$backup_evidence"
      grep -Fq "commit=$commit" "$backup_evidence"
      grep -Fq "bftRelease=$bft_release" "$backup_evidence"
      grep -Fq 'validated=true' "$backup_evidence"
    done
  fi

  mutate_role() {
    local role="$1" user="$2" host="$3" key="$4" kind="$5"
    local remote_root="${BACKUP_STORAGE_PATH:-/var/backups/ynx-chain}/public-bft-cutover/${transaction_id}"
    local remote_helper="/tmp/ynx-public-bft-mutation-freeze-${transaction_id}-${role}.sh"
    local mutation_urls="http://127.0.0.1:6420"
    public_bft_native_qualify "$role" "$user" "$host" "$key" "$evidence_dir/${role}-${operation}-native-identity.json" || return $?
    # Shared marker semantics are preserved. Only the authorized chain RPC and
    # its new gateway are probed; paused products keep their original services.
    if [[ "$role" == primary && "$operation" == unfreeze && -s "$transaction_dir/ingress/public-result.json" ]]; then mutation_urls+=",http://127.0.0.1:27620"; fi
    if [[ "${PUBLIC_BFT_CUTOVER_MODE:-}" == abort-native ]]; then
      [[ ! -e "$evidence_dir/${role}-unfreeze.txt" && ! -L "$evidence_dir/${role}-unfreeze.txt" ]] || return 1
      abort_native_observe_role "$role" "$user" "$host" "$key" || return $?
    fi
    ynx_ops_copy "$role" "$user" "$host" "$key" scripts/ops/remote/public-bft-mutation-freeze.sh "$remote_helper" || return $?
    ynx_ops_ssh "$role" "$user" "$host" "$key" "set -euo pipefail; trap 'rm -f \"$remote_helper\"' EXIT; chmod 0700 '$remote_helper'; sudo bash '$remote_helper' '$operation' '$transaction_id' '$role' '$commit' '$role_native_release' '$bft_release' '$role_native_mutation' '$remote_root' http://127.0.0.1:6420 '$mutation_urls' / '$role_native_full'" >"$evidence_dir/${role}-${operation}.txt"
  }
  if [[ "${PUBLIC_BFT_CUTOVER_MODE:-}" == abort-native ]]; then
    mutate_role primary "$PRIMARY_NODE_USER" "$PRIMARY_NODE_HOST" "$PRIMARY_NODE_SSH_KEY" full || return $?
    mutate_role singapore "$SG_NODE_USER" "$SG_NODE_HOST" "$SG_NODE_SSH_KEY" validator || return $?
    mutate_role silicon-valley "$SILICON_VALLEY_NODE_USER" "$SILICON_VALLEY_NODE_HOST" "$SILICON_VALLEY_NODE_SSH_KEY" validator || return $?
    mutate_role seoul "$SEOUL_NODE_USER" "$SEOUL_NODE_HOST" "$SEOUL_NODE_SSH_KEY" validator || return $?
  else
    ynx_ops_each_node mutate_role
  fi
  echo "production BFT mutation $operation passed: transaction=$transaction_id evidence=$evidence_dir"
}

gateway_recovery_phase() {
  prepare_candidate_package
  ingress_context
  validated_candidate_result
  validated_gateway_start
  validated_continuity_result
  validated_ingress_result switch "$ingress_root/switch-result.json"
  local evidence="$candidate_transaction_dir/recovery-gateway" observation="${PUBLIC_BFT_RECOVERY_OBSERVATION_SECONDS:-4}"
  [[ "$observation" =~ ^[0-9]+$ ]] && ((observation >= 2 && observation <= 15)) || exit 1
  (umask 077; mkdir -m 0700 "$evidence") || { echo "original gateway recovery observation exists; retain it" >&2; exit 1; }
  if [[ "${DEPLOY_DRY_RUN:-0}" == 1 ]]; then
    printf '{"mode":"single-app-gateway","verified":false,"dryRun":true,"nativeProducerResumed":false,"ecosystemContinuityVerified":false}\n' >"$evidence/result.json"
    return
  fi
  local marker_sha
  marker_sha="$(shasum -a 256 "$dependency_root/start-attempt/guard/primary/pause-marker.json" | awk '{print $1}')"
  ynx_ops_ssh primary "$PRIMARY_NODE_USER" "$PRIMARY_NODE_HOST" "$PRIMARY_NODE_SSH_KEY" "set -euo pipefail; printf '%s  %s\\n' '$marker_sha' /var/lib/ynx-chain/block-production-pause.json | sudo sha256sum --strict -c - >/dev/null; sudo test ! -e /var/lib/ynx-chain/mutation-freeze.json; curl --noproxy '*' --max-time 10 -fsS http://127.0.0.1:6420/status" >"$evidence/native-before.json"
  ynx_ops_ssh primary "$PRIMARY_NODE_USER" "$PRIMARY_NODE_HOST" "$PRIMARY_NODE_SSH_KEY" "curl --noproxy '*' --max-time 10 -fsS http://127.0.0.1:27620/health" >"$evidence/gateway-before-health.json"
  sleep "$observation"
  ynx_ops_ssh primary "$PRIMARY_NODE_USER" "$PRIMARY_NODE_HOST" "$PRIMARY_NODE_SSH_KEY" "set -euo pipefail; printf '%s  %s\\n' '$marker_sha' /var/lib/ynx-chain/block-production-pause.json | sudo sha256sum --strict -c - >/dev/null; curl --noproxy '*' --max-time 10 -fsS http://127.0.0.1:6420/status" >"$evidence/native-after.json"
  ynx_ops_ssh primary "$PRIMARY_NODE_USER" "$PRIMARY_NODE_HOST" "$PRIMARY_NODE_SSH_KEY" "curl --noproxy '*' --max-time 10 -fsS http://127.0.0.1:27620/health" >"$evidence/gateway-after-health.json"
  ynx_ops_ssh primary "$PRIMARY_NODE_USER" "$PRIMARY_NODE_HOST" "$PRIMARY_NODE_SSH_KEY" "curl --noproxy '*' --max-time 10 -fsS http://127.0.0.1:27620/status" >"$evidence/gateway-status.json"
  ynx_ops_ssh primary "$PRIMARY_NODE_USER" "$PRIMARY_NODE_HOST" "$PRIMARY_NODE_SSH_KEY" "curl --disable --noproxy '*' --request GET --connect-timeout 5 --max-time 10 --max-redirs 0 --max-filesize 16777216 -fsS http://127.0.0.1:27620/node/pq-identity" >"$evidence/gateway-pq-identity.json"
  node scripts/verify/public-bft-candidate-binding.mjs --gateway-observe "$candidate_binding" "$dependency_root/start-result.json" "$evidence/gateway-before-health.json" "$evidence/gateway-after-health.json" "$evidence/gateway-status.json" "$evidence/gateway-pq-identity.json" public >"$evidence/observation.json"
  node - "$candidate_binding" "$evidence" >"$evidence/result.json" <<'NODE'
const fs=require("fs"),[p,d]=process.argv.slice(2),b=JSON.parse(fs.readFileSync(p)),o=JSON.parse(fs.readFileSync(d+"/observation.json"));
for(const name of ["native-before","native-after"]){const s=JSON.parse(fs.readFileSync(d+"/"+name+".json"));if(s.chainId!==6423||s.nativeCurrencySymbol!=="YNXT"||s.height!==b.finalSnapshotHeight||s.latestBlockHash!==b.finalSnapshotBlockHash||s.build?.commit!==(b.authoritativeCommit?.slice(0,12)||b.commit)||s.build?.release!==b.authoritativeRelease||s.nodeIdentity?.replicationMode!=="authoritative_producer")process.exit(1)}
console.log(JSON.stringify({...o,version:"YNX-SINGLE-APP-GATEWAY-RECOVERY/v1",nativeProducerResumed:false,nativeProducerRemainsPaused:true,sharedMutationFreezeRemoved:true,ecosystemContinuityVerified:false}));
NODE
}

recovery_phase() {
  if [[ -e "${PUBLIC_BFT_CUTOVER_TRANSACTION_DIR:-}/candidate/initialize-attempt" || -L "${PUBLIC_BFT_CUTOVER_TRANSACTION_DIR:-}/candidate/initialize-attempt" ]]; then
    gateway_recovery_phase
    return
  fi
  [[ "${PUBLIC_BFT_CUTOVER_COMMIT:-}" == "$commit" ]] || {
    echo "recovery commit does not match current HEAD" >&2
    exit 1
  }
  local bft_release="ynx-bft-gateway-${commit}"
  [[ "${PUBLIC_BFT_CUTOVER_RELEASE:-}" == "$bft_release" ]] || {
    echo "recovery BFT release does not match current HEAD" >&2
    exit 1
  }
  local transaction_dir="${PUBLIC_BFT_CUTOVER_TRANSACTION_DIR:-}"
  [[ -n "$transaction_dir" && -d "$transaction_dir" ]] || {
    echo "PUBLIC_BFT_CUTOVER_TRANSACTION_DIR must be an existing directory" >&2
    exit 1
  }
  local transaction_id observation evidence_dir
  transaction_id="$(basename "$transaction_dir")"
  [[ "$transaction_id" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$ ]] || { echo "invalid recovery transaction id" >&2; exit 1; }
  observation="${PUBLIC_BFT_RECOVERY_OBSERVATION_SECONDS:-4}"
  [[ "$observation" =~ ^[0-9]+$ ]] && (( observation >= 2 && observation <= 15 )) || {
    echo "PUBLIC_BFT_RECOVERY_OBSERVATION_SECONDS must be between 2 and 15" >&2
    exit 1
  }
  evidence_dir="$transaction_dir/recovery"
  if [[ -e "$evidence_dir" ]]; then
    local attempt=2
    while [[ -e "$transaction_dir/recovery-attempt-$attempt" ]]; do
      ((attempt += 1))
    done
    evidence_dir="$transaction_dir/recovery-attempt-$attempt"
  fi
  umask 077
  mkdir -p "$evidence_dir/roles"

  collect_status() {
    local stage="$1" role="$2" user="$3" host="$4" key="$5" _kind="$6"
    if [[ -n "${native_full_commit:-}" ]]; then public_bft_native_qualify "$role" "$user" "$host" "$key" "$evidence_dir/roles/${role}-${stage}-native-identity.json"; fi
    ynx_ops_ssh "$role" "$user" "$host" "$key" "curl -fsS http://127.0.0.1:6420/status" >"$evidence_dir/roles/${role}-${stage}-status.json"
  }
  collect_before() {
    local role="$1" user="$2" host="$3" key="$4" kind="$5"
    collect_status before "$role" "$user" "$host" "$key" "$kind"
  }
  ynx_ops_each_node collect_before
  if [[ "${DEPLOY_DRY_RUN:-0}" == "1" ]]; then
    printf 'transactionId=%s\ncommit=%s\nrelease=%s\ndryRun=true\n' "$transaction_id" "$commit" "$release" >"$evidence_dir/dry-run.txt"
    echo "production BFT recovery dry-run passed: transaction=$transaction_id evidence=$evidence_dir"
    return
  fi
  sleep "$observation"

  collect_after() {
    local role="$1" user="$2" host="$3" key="$4" kind="$5" services mutation_urls
    collect_status after "$role" "$user" "$host" "$key" "$kind"
    services=ynx-chaind
    mutation_urls="http://127.0.0.1:6420"
    ynx_ops_ssh "$role" "$user" "$host" "$key" "set -euo pipefail; sudo test ! -e /var/lib/ynx-chain/mutation-freeze.json; for service in $services; do systemctl is-active \"\$service\" >/dev/null; done; test \"\$(curl -sS -o /dev/null -w '%{http_code}' http://127.0.0.1:6420/status)\" = 200; test \"\$(curl -sS -o /dev/null -w '%{http_code}' -H 'Content-Type: application/json' -d '{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"eth_chainId\",\"params\":[]}' http://127.0.0.1:6420/evm)\" = 200; mutation_urls='$mutation_urls'; old_ifs=\$IFS; IFS=,; for url in \$mutation_urls; do code=\$(curl -sS -o /dev/null -w '%{http_code}' -H 'Content-Type: application/json' -d '{}' \"\$url/__ynx_mutation_freeze_probe__\"); test \"\$code\" != 503; done; IFS=\$old_ifs; printf 'role=%s\\nfreeze=absent\\nservices=active\\nstatus_read=200\\nevm_read=200\\nmutations=unfrozen\\n' '$role'" >"$evidence_dir/roles/${role}-recovery.txt"
  }
  ynx_ops_each_node collect_after

  local height
  height="$(node -e 'const fs=require("fs"),p=process.argv[1],roles=["primary","singapore","silicon-valley","seoul"]; const h=roles.map(r=>Number(JSON.parse(fs.readFileSync(`${p}/roles/${r}-after-status.json`)).height)); if(h.some(v=>!Number.isSafeInteger(v)||v<3)) process.exit(1); process.stdout.write(String(Math.min(...h)-2));' "$evidence_dir")"
  printf '%s\n' "$height" >"$evidence_dir/convergence-height.txt"
  collect_recovery_block() {
    local role="$1" user="$2" host="$3" key="$4" _kind="$5"
    ynx_ops_ssh "$role" "$user" "$host" "$key" "curl -fsS http://127.0.0.1:6420/blocks/$height" >"$evidence_dir/roles/${role}-block.json"
  }
  ynx_ops_each_node collect_recovery_block
  node scripts/verify/validate-public-bft-production-recovery.mjs "$evidence_dir" "${native_commit:-$commit}" "$release" "${native_approval_path:-}" "${native_transaction_id:-}" >"$evidence_dir/validation.json"
  echo "production BFT recovery verification passed: transaction=$transaction_id evidence=$evidence_dir"
}

if [[ "$action" == "backup" || "$action" == "freeze_mutations" || "$action" == "unfreeze_mutations" || "$action" == "pause_authoritative" || "$action" == "resume_authoritative" || "$action" == "export_final_snapshot" || "$action" == "initialize_candidate" || "$action" == "deploy_candidate" || "$action" == "start_candidate" || "$action" == "verify_candidate" || "$action" == "verify_pq_continuation" || "$action" == "rollback_candidate" || "$action" == "start_dependencies" || "$action" == "verify_continuity" || "$action" == "rollback_dependencies" || "$action" == "switch_ingress" || "$action" == "verify_public" || "$action" == "rollback_ingress" || "$action" == "verify_recovery" ]]; then
  [[ -z "$(git status --short)" ]] || { echo "production mutation phase requires a clean worktree" >&2; exit 1; }
  case "$action" in
    backup) backup_phase ;;
    freeze_mutations) mutation_freeze_phase freeze ;;
    unfreeze_mutations) mutation_freeze_phase unfreeze ;;
    pause_authoritative) authoritative_production_phase pause ;;
    resume_authoritative) authoritative_production_phase resume ;;
    export_final_snapshot) final_snapshot_phase ;;
    initialize_candidate) initialize_candidate_phase ;;
    deploy_candidate) deploy_candidate_phase ;;
    start_candidate) start_candidate_phase ;;
    verify_candidate) verify_candidate_phase ;;
    verify_pq_continuation) verify_pq_continuation_phase ;;
    rollback_candidate) rollback_candidate_phase ;;
    start_dependencies) start_dependencies_phase ;;
    verify_continuity) verify_continuity_phase ;;
    rollback_dependencies) rollback_dependencies_phase ;;
    switch_ingress) switch_ingress_phase ;;
    rollback_ingress) rollback_ingress_phase ;;
    verify_public) verify_public_phase ;;
    verify_recovery) recovery_phase ;;
  esac
  if [[ "${PUBLIC_BFT_CUTOVER_MODE:-}" == abort-native ]]; then
    python3 -B scripts/ops/public-bft-quiet-continuation.py abort-phase-result --transaction "$PUBLIC_BFT_CUTOVER_TRANSACTION_DIR" --phase "$action"
  fi
  exit 0
fi

run_id="${PUBLIC_BFT_PRODUCTION_REHEARSAL_ID:-rehearsal-${commit}-$(date -u +%Y%m%dT%H%M%SZ)}"
[[ "$run_id" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$ ]] || { echo "invalid production rehearsal id" >&2; exit 1; }
root="${PUBLIC_BFT_PRODUCTION_REHEARSAL_DIR:-tmp/public-bft-production-rehearsal}/${run_id}"
[[ ! -e "$root" ]] || { echo "production rehearsal evidence already exists: $root" >&2; exit 1; }
umask 077
mkdir -p "$root/roles" "$root/prebuilt"

cleanup_failed() {
  local status="$?"
  if [[ "$status" != "0" ]]; then
    printf '{"status":"failed","commit":"%s","release":"%s","at":"%s"}\n' "$commit" "$release" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >"$root/result.json"
    echo "production rehearsal failed; no remote mutation was requested; evidence=$root" >&2
  fi
  exit "$status"
}
trap cleanup_failed EXIT

public_bft_operator_inputs
public_bft_runtime_prepare "$root"
runtime_bin="$(dirname "$public_package_verifier")"
if public_bft_linux_tools_enabled; then
  for name in ynx-abci ynx-comet ynx-bft-gatewayd ynx-consensus-keycheck; do printf '%s  %s/%s\n' "$(public_bft_runtime_binary_sha "$runtime_bin" "$name")" "$CONSENSUS_CANDIDATE_RUNTIME_BUNDLE" "$name"; done >"$root/prebuilt.sha256"
else
shasum -a 256 "$runtime_bin/ynx-abci" "$runtime_bin/ynx-comet" "$runtime_bin/ynx-bft-gatewayd" "$runtime_bin/ynx-consensus-keycheck" >"$root/prebuilt.sha256"
fi

collect_role() {
  local role="$1" user="$2" host="$3" key="$4" kind="$5"
  local role_dir="$root/roles/$role" validator services candidate_port_pattern custody_command manifest_check preflight_mode=fresh
  mkdir -p "$role_dir"
  case "$role" in
    primary) validator=ynx_validator_primary ;;
    singapore) validator=ynx_validator_singapore ;;
    silicon-valley) validator=ynx_validator_silicon_valley ;;
    seoul) validator=ynx_validator_seoul ;;
  esac
  services="$(public_bft_preflight_services "$kind")"
  candidate_port_pattern=':(27656|27660|27757|27858)$'
  if [[ "$kind" == "full" ]]; then
    if [[ "$services" == ynx-chaind ]]; then
      # A full host gets this exact service set only from the revalidated
      # protected single-App profile above; draft/env flags cannot select it.
      candidate_port_pattern=':(27620|27656|27660|27757|27858)$'
    else
      candidate_port_pattern=':(27620|27626|27627|27628|27629|27630|27631|27632|27656|27660|27757|27858)$'
    fi
  fi
  [[ -z "${native_approval_path:-}" || "$native_approval_path" != "$PUBLIC_BFT_CUTOVER_TRANSACTION_DIR/preparation-approval.json" ]] || preflight_mode=prepare-native
  custody_command="$(node scripts/verify/public-bft-candidate-binding.mjs --operator-preflight "$candidate_operator_plan" "$candidate_operator_pin" "$role" "$preflight_mode")"
  public_bft_native_qualify "$role" "$user" "$host" "$key" "$role_dir/native-identity.json"
  if [[ -n "${native_full_commit:-}" ]]; then
    manifest_check="printf 'native_running_sha256=%s\\n' '$role_native_binary'"
  else
    manifest_check="manifest=/opt/ynx-chain/releases/$release/config/release-manifest.json; test -f \"\$manifest\"; printf 'manifest_sha256='; sha256sum \"\$manifest\" | awk '{print \$1}'"
  fi
  ynx_ops_ssh "$role" "$user" "$host" "$key" "curl -fsS http://127.0.0.1:6420/status" >"$role_dir/status.json"
  ynx_ops_ssh "$role" "$user" "$host" "$key" "set -eu
$custody_command
for service in $services; do systemctl is-active \"\$service\" >/dev/null; done; systemctl is-active ynx-consensus-overlay.service >/dev/null; ip link show ynxwg0 >/dev/null; sudo test ! -e /var/lib/ynx-chain/consensus-candidate; ! systemctl is-active --quiet ynx-consensus-comet-candidate.service; ! systemctl is-active --quiet ynx-consensus-abci-candidate.service; ! systemctl is-active --quiet ynx-consensus-operator-candidate.service
candidate_listen_output=\$(LC_ALL=C ss -H -ltn) || { printf '%s\\n' 'cannot read candidate listening ports' >&2; exit 1; }
[ -n \"\$candidate_listen_output\" ] || { printf '%s\\n' 'candidate listening port output is empty' >&2; exit 1; }
candidate_port_state=\$(printf '%s' \"\$candidate_listen_output\" | awk -v candidate_ports='$candidate_port_pattern' '
  NF != 5 || \$1 != \"LISTEN\" || \$2 !~ /^[0-9]+$/ || \$3 !~ /^[0-9]+$/ || \$4 !~ /^[^[:space:]]+:[1-9][0-9]*$/ || \$5 !~ /^[^[:space:]]+:(\\*|[0-9]+)$/ { invalid=1; exit }
  { port=\$4; sub(/^.*:/, \"\", port); if (port+0 < 1 || port+0 > 65535) { invalid=1; exit }; if (\$4 ~ candidate_ports) occupied=1 }
  END { if (invalid) exit 2; if (occupied) print \"occupied\"; else print \"free\" }
') || { printf '%s\\n' 'cannot parse candidate listening ports' >&2; exit 1; }
[ \"\$candidate_port_state\" = free ] || { printf '%s\\n' 'candidate port already listening' >&2; exit 1; }
sudo test ! -e /var/lib/ynx-chain/mutation-freeze.json; sudo test -d '${BACKUP_STORAGE_PATH:-/var/backups/ynx-chain}'; test \"\$(df -Pk /var/lib/ynx-chain | awk 'NR==2 {print \$4}')\" -gt 2097152; printf 'role=%s\\nvalidator=%s\\nrelease=%s\\nservices=active\\noverlay=active\\nkeys=restricted\\ncandidate=absent\\nfreeze=absent\\nports=free\\ndisk=ready\\nbackup=present\\n' '$role' '$validator' '$role_native_release'; $manifest_check" >"$role_dir/preflight.txt"
}
ynx_ops_each_node collect_role

height="$(node -e 'const fs=require("fs"),p=process.argv[1],roles=["primary","singapore","silicon-valley","seoul"]; const h=roles.map(r=>Number(JSON.parse(fs.readFileSync(`${p}/roles/${r}/status.json`)).height)); if(h.some(v=>!Number.isSafeInteger(v)||v<3)) process.exit(1); process.stdout.write(String(Math.min(...h)-2));' "$root")"
printf '%s\n' "$height" >"$root/convergence-height.txt"

collect_block() {
  local role="$1" user="$2" host="$3" key="$4" _kind="$5"
  ynx_ops_ssh "$role" "$user" "$host" "$key" "curl -fsS http://127.0.0.1:6420/blocks/$height" >"$root/roles/$role/block.json"
}
ynx_ops_each_node collect_block

node scripts/verify/validate-public-bft-production-rehearsal.mjs "$root" "${native_commit:-$commit}" "$release" "${native_approval_path:-}" "${native_transaction_id:-}" >"$root/validation.json"
printf '{"status":"passed","commit":"%s","release":"%s","height":%s,"at":"%s","remoteMutation":false,"publicIngressChanged":false}\n' "$commit" "$release" "$height" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >"$root/result.json"
trap - EXIT
echo "production BFT rehearsal passed without remote mutation: evidence=$root"
