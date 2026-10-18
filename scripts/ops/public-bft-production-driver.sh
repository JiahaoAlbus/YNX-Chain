#!/usr/bin/env bash
set -Eeuo pipefail

cd "$(dirname "$0")/../.."
# shellcheck source=lib.sh
source scripts/ops/lib.sh
ynx_ops_init
# Source only the already reviewed runtime verifier/copy helpers. Sourcing this
# file does not initialize deployment or execute any build or remote command.
source scripts/deploy/deploy-consensus-candidate.sh

action="${1:-rehearse}"
[[ "$action" == "rehearse" || "$action" == "preflight" || "$action" == "backup" || "$action" == "freeze_mutations" || "$action" == "unfreeze_mutations" || "$action" == "pause_authoritative" || "$action" == "resume_authoritative" || "$action" == "export_final_snapshot" || "$action" == "initialize_candidate" || "$action" == "deploy_candidate" || "$action" == "start_candidate" || "$action" == "verify_candidate" || "$action" == "rollback_candidate" || "$action" == "start_dependencies" || "$action" == "verify_continuity" || "$action" == "rollback_dependencies" || "$action" == "switch_ingress" || "$action" == "verify_public" || "$action" == "rollback_ingress" || "$action" == "verify_recovery" ]] || {
  echo "production driver phase $action is not implemented; public cutover remains blocked" >&2
  exit 64
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
  ynx_ops_copy primary "$PRIMARY_NODE_USER" "$PRIMARY_NODE_HOST" "$PRIMARY_NODE_SSH_KEY" scripts/ops/remote/public-bft-authoritative-pause.sh "$remote_helper"
  ynx_ops_ssh primary "$PRIMARY_NODE_USER" "$PRIMARY_NODE_HOST" "$PRIMARY_NODE_SSH_KEY" "set -euo pipefail; trap 'rm -f \"$remote_helper\"' EXIT; chmod 0700 '$remote_helper'; sudo bash '$remote_helper' '$operation' '$transaction_id' '$commit' '$release' '$bft_release' /var/lib/ynx-chain/block-production-pause.json /var/lib/ynx-chain/mutation-freeze.json '$remote_root' http://127.0.0.1:6420 / '$observation'" >"$evidence_dir/primary-${operation}-authoritative.txt"
  echo "production BFT authoritative $operation passed: transaction=$transaction_id evidence=$evidence_dir"
}

public_bft_runtime_prepare() {
  local parent="$1" retained
  local bundle="${CONSENSUS_CANDIDATE_RUNTIME_BUNDLE:-}"
  local full_commit="${CONSENSUS_CANDIDATE_RUNTIME_COMMIT:-}"
  local manifest_pin="${CONSENSUS_CANDIDATE_RUNTIME_MANIFEST_SHA256:-}"
  [[ "$(uname -s)" == Linux && "$(uname -m)" == x86_64 ]] || { echo "public candidate verifier requires the pinned Linux amd64 runtime; no rebuild fallback" >&2; return 1; }
  [[ "$full_commit" =~ ^[0-9a-f]{40}$ && "$manifest_pin" =~ ^[0-9a-f]{64}$ && "$(git rev-parse HEAD)" == "$full_commit" ]] || { echo "public candidate requires the independent current full runtime commit and SOURCE.json SHA256" >&2; return 1; }
  validate_runtime_bundle "$bundle" "$full_commit" "$manifest_pin" || return $?
  [[ -d "$parent" && ! -L "$parent" ]] || { echo "original transaction directory is required" >&2; return 1; }
  parent="$(cd "$parent" && pwd -P)" || return $?
  # Retain every verifier copy, including a failed/UNKNOWN preparation. Artifact
  # files may be 0644; only the verified exclusive copy becomes executable.
  retained="$(umask 077; mktemp -d "$parent/runtime-verifier.XXXXXXXX")" || return $?
  prepare_runtime_bundle "$bundle" "$full_commit" "$manifest_pin" "$retained/runtime" || return $?
  public_package_verifier="$retained/runtime/ynx-consensus-package"
  [[ -x "$public_package_verifier" ]] || { echo "verified package verifier is unavailable" >&2; return 1; }
}

public_bft_operator_inputs() {
  candidate_operator_plan="${PUBLIC_BFT_PRODUCTION_OPERATOR_PLAN:-}"
  candidate_operator_pin="${PUBLIC_BFT_PRODUCTION_OPERATOR_PLAN_SHA256:-}"
  [[ "$candidate_operator_plan" == /* && -f "$candidate_operator_plan" && ! -L "$candidate_operator_plan" && "$candidate_operator_pin" =~ ^[0-9a-f]{64}$ && "$candidate_operator_pin" != "$(printf '0%.0s' {1..64})" ]] || { echo "public candidate requires an existing absolute public operator plan and independent nonzero SHA256 pin" >&2; return 1; }
  # Pass the identical external pins into the normal deployment and readback
  # callers. A package's own operatorPlanHash can never select this value.
  export CONSENSUS_CANDIDATE_OPERATOR_PLAN_SHA256="$candidate_operator_pin"
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
  remote_helper="/tmp/ynx-public-bft-final-snapshot-${transaction_id}.sh"
  public_bft_runtime_prepare "$transaction_dir"
  mkdir -p "$transaction_dir/final-snapshot"
  chmod 0700 "$transaction_dir/final-snapshot"
  ynx_ops_copy primary "$PRIMARY_NODE_USER" "$PRIMARY_NODE_HOST" "$PRIMARY_NODE_SSH_KEY" scripts/ops/remote/public-bft-final-snapshot.sh "$remote_helper"
  ynx_ops_ssh primary "$PRIMARY_NODE_USER" "$PRIMARY_NODE_HOST" "$PRIMARY_NODE_SSH_KEY" "set -euo pipefail; trap 'rm -f \"$remote_helper\"' EXIT; chmod 0700 '$remote_helper'; sudo bash '$remote_helper' '$transaction_id' '$commit' '$release' '$bft_release' /var/lib/ynx-chain/block-production-pause.json /var/lib/ynx-chain/mutation-freeze.json '$remote_root' http://127.0.0.1:6420 / /usr/local/bin/ynx-chaind '$observation'" >"$evidence_dir/primary-export-final-snapshot.txt"
  if [[ "${DEPLOY_DRY_RUN:-0}" == "1" ]]; then
    printf 'transactionId=%s\ncommit=%s\nrelease=%s\ndryRun=true\n' "$transaction_id" "$commit" "$release" >"$transaction_dir/final-snapshot/dry-run.txt"
    echo "production BFT final snapshot dry-run passed: transaction=$transaction_id evidence=$transaction_dir/final-snapshot"
    return
  fi
  ynx_ops_ssh primary "$PRIMARY_NODE_USER" "$PRIMARY_NODE_HOST" "$PRIMARY_NODE_SSH_KEY" "sudo cat '$remote_root/final-migration-state.json'" >"$transaction_dir/final-snapshot/migration.json"
  ynx_ops_ssh primary "$PRIMARY_NODE_USER" "$PRIMARY_NODE_HOST" "$PRIMARY_NODE_SSH_KEY" "sudo cat '$remote_root/final-migration-state.evidence.json'" >"$transaction_dir/final-snapshot/remote-evidence.json"
  chmod 0600 "$transaction_dir/final-snapshot/migration.json" "$transaction_dir/final-snapshot/remote-evidence.json"
  local expected_sha actual_sha
  expected_sha="$(sed -n 's/^sha256=\([0-9a-f]\{64\}\)$/\1/p' "$evidence_dir/primary-export-final-snapshot.txt")"
  actual_sha="$(shasum -a 256 "$transaction_dir/final-snapshot/migration.json" | awk '{print $1}')"
  [[ -n "$expected_sha" && "$actual_sha" == "$expected_sha" ]] || { echo "downloaded final snapshot checksum mismatch" >&2; exit 1; }
  "$public_package_verifier" -verify-migration-state "$transaction_dir/final-snapshot/migration.json" >"$transaction_dir/final-snapshot/local-validation.txt"
  echo "production BFT final snapshot passed: transaction=$transaction_id evidence=$transaction_dir/final-snapshot"
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
  candidate_package="$candidate_root/package"
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
  node scripts/verify/public-bft-candidate-binding.mjs --inputs-only "${binding_args[@]}" >/dev/null
  public_bft_runtime_prepare "$candidate_transaction_dir"
  umask 077
  mkdir -p "$candidate_root"
  chmod 0700 "$candidate_root"
  if [[ -e "$candidate_package" || -L "$candidate_package" || -e "$candidate_binding" || -L "$candidate_binding" ]]; then
    [[ -d "$candidate_package" && ! -L "$candidate_package" && -s "$candidate_binding" && ! -L "$candidate_binding" ]] || { echo "partial candidate package state exists" >&2; exit 1; }
    "$public_package_verifier" -verify-package "$candidate_package" -operator-plan-hash "$candidate_operator_pin" >/dev/null
    node scripts/verify/public-bft-candidate-binding.mjs "${binding_args[@]}" "$candidate_package" | cmp "$candidate_binding" - >/dev/null || { echo "existing candidate binding mismatch; original package/binding retained" >&2; exit 1; }
    return
  fi
  "$public_package_verifier" \
    -migration-state "$candidate_transaction_dir/final-snapshot/migration.json" \
    -validator-manifest "$validator_manifest" \
    -genesis-time "$genesis_time" \
    -operator-plan "$candidate_operator_plan" \
    -operator-plan-hash "$candidate_operator_pin" \
    -output "$candidate_package" >/dev/null
  "$public_package_verifier" -verify-package "$candidate_package" -operator-plan-hash "$candidate_operator_pin" >/dev/null
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
    cp "$(dirname "$public_package_verifier")/ynx-comet" "$public_package_verifier" "$stage/"
    cp "$candidate_package/roles/$role/config/genesis.json" "$candidate_package/roles/$role/config/bound-migration.json" "$stage/"
    cp "$candidate_operator_plan" "$stage/operator-plan.json"
    tar -czf "$archive" -C "$stage" .
    chmod 0600 "$archive"
    expected="$(shasum -a 256 "$archive" | awk '{print $1}')"
    ynx_ops_ssh "$role" "$user" "$host" "$key" "set -euo pipefail
$destination_guard
$(candidate_original_guard_command "$role")
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
    local execution="set -euo pipefail
test -f '$remote_archive'; test ! -L '$remote_archive'
printf '%s  %s\\n' '$expected' '$remote_archive' | sha256sum --strict -c - >/dev/null
sudo tar --no-same-owner -xzf '$remote_archive' -C '$remote_stage'"
    for file in "$stage/"*; do
      expected="$(shasum -a 256 "$file" | awk '{print $1}')"
      execution+=$'\n'"printf '%s  %s\\n' '$expected' '$remote_stage/$(basename "$file")' | sudo sha256sum --strict -c - >/dev/null"
    done
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
    for file in "$candidate_package/roles/$role/scripts/start-operator.sh" "$candidate_package/roles/$role/role-manifest.json" "$candidate_package/roles/$role/systemd/ynx-consensus-operator-candidate.service" "$candidate_package/roles/$role/config/"* "$(dirname "$public_package_verifier")/ynx-comet" "$(dirname "$public_package_verifier")/ynx-consensus-keycheck"; do
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

verify_candidate_phase() {
  prepare_candidate_package
  local deploy_result="$candidate_root/deploy-result.json" binding_sha
  test -s "$deploy_result"
  binding_sha="$(shasum -a 256 "$candidate_binding" | awk '{print $1}')"
  node -e 'const fs=require("fs"),[p,tx,c,r,s]=process.argv.slice(1),v=JSON.parse(fs.readFileSync(p)); if(v.transactionId!==tx||v.commit!==c||v.bftRelease!==r||v.bindingSha256!==s||v.deployed!==true) process.exit(1)' "$deploy_result" "$candidate_transaction_id" "$commit" "$candidate_bft_release" "$binding_sha" || { echo "candidate deploy result is not transaction-bound" >&2; exit 1; }
  node -e 'const fs=require("fs"),[p,t,c,r,h,d]=process.argv.slice(1),v=JSON.parse(fs.readFileSync(p));if(v.version!==1||v.transactionId!==t||v.commit!==c||v.bftRelease!==r||v.bindingSha256!==h||v.dryRun!==(d==="1")||v.started!==(d!=="1"))process.exit(1)' "$candidate_root/start-attempt/result.json" "$candidate_transaction_id" "$commit" "$candidate_bft_release" "$binding_sha" "${DEPLOY_DRY_RUN:-0}" || { echo "explicit original operator start result is required; dry-run cannot authorize real verification" >&2; exit 1; }
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
  local binding_sha
  binding_sha="$(shasum -a 256 "$candidate_binding" | awk '{print $1}')"
  node -e 'const fs=require("fs"),[p,tx,c,r,s,d]=process.argv.slice(1),v=JSON.parse(fs.readFileSync(p));if(v.transactionId!==tx||v.commit!==c||v.bftRelease!==r||v.bindingSha256!==s||v.dryRun!==(d==="1")||v.verified!==(d!=="1"))process.exit(1)' "$candidate_root/verify-result.json" "$candidate_transaction_id" "$commit" "$candidate_bft_release" "$binding_sha" "${DEPLOY_DRY_RUN:-0}" || { echo "actual original operator verification is required; dry-run cannot authorize activation" >&2; exit 1; }
}

gateway_runtime_pins() {
  local bin
  bin="$(dirname "$public_package_verifier")"
  gateway_binary_sha="$(shasum -a 256 "$bin/ynx-bft-gatewayd" | awk '{print $1}')"
  gateway_verifier_sha="$(shasum -a 256 "$public_package_verifier" | awk '{print $1}')"
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
  cp "$bin/ynx-bft-gatewayd" "$stage/ynx-bft-gatewayd"
  cp "$public_package_verifier" "$stage/ynx-consensus-package"
  cp scripts/ops/remote/public-bft-dependencies.sh "$stage/public-bft-dependencies.sh"
  cp -R "$candidate_package" "$stage/package"
  chmod 0700 "$stage/ynx-bft-gatewayd" "$stage/ynx-consensus-package" "$stage/public-bft-dependencies.sh"
  "$stage/ynx-consensus-package" -verify-package "$stage/package" -operator-plan-hash "$candidate_operator_pin" >/dev/null
  tar -czf "$archive" -C "$stage" .
  chmod 0600 "$archive"
  archive_sha="$(shasum -a 256 "$archive" | awk '{print $1}')"
  helper_sha="$(shasum -a 256 "$stage/public-bft-dependencies.sh" | awk '{print $1}')"
  upload="/tmp/ynx-gateway-upload-${candidate_transaction_id}"
  # Both remote destinations are reserved before copy. No overwrite or cleanup
  # of an existing/partial archive, helper, package, unit, or uncertain result.
  ynx_ops_ssh primary "$PRIMARY_NODE_USER" "$PRIMARY_NODE_HOST" "$PRIMARY_NODE_SSH_KEY" "set -euo pipefail; sudo test -d '$dependency_remote_root'; sudo test ! -L '$dependency_remote_root'; sudo mkdir -m 0700 '$dependency_stage'; umask 077; mkdir -m 0700 '$upload'" >"$attempt/reserve.txt"
  ynx_ops_copy primary "$PRIMARY_NODE_USER" "$PRIMARY_NODE_HOST" "$PRIMARY_NODE_SSH_KEY" "$archive" "$upload/runtime.tar.gz"
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
console.log(JSON.stringify({version:"YNX-SINGLE-APP-GATEWAY-CONTINUITY/v1",mode:"single-app-gateway",transactionId:b.transactionId,commit:b.commit,bftRelease:b.bftRelease,operatorPlanSHA256:b.operatorPlanSha256,runtimeCommit:b.runtimeCommit,runtimeSOURCEsha256:b.runtimeManifestSha256,bindingSHA256:crypto.createHash("sha256").update(raw).digest("hex"),migrationHeight:b.finalSnapshotHeight,migrationBlockHash:b.finalSnapshotBlockHash.replace(/^0x/,""),verified:false,dryRun:true,parallelCandidateOnly:true,publicIngressChanged:false,independentFinalityVerified:false,ecosystemContinuityVerified:false}));
NODE
  else
    sleep "$observation"
    ynx_ops_ssh primary "$PRIMARY_NODE_USER" "$PRIMARY_NODE_HOST" "$PRIMARY_NODE_SSH_KEY" "curl --noproxy '*' --max-time 10 -fsS http://127.0.0.1:27620/health" >"$evidence/gateway-after-health.json"
    ynx_ops_ssh primary "$PRIMARY_NODE_USER" "$PRIMARY_NODE_HOST" "$PRIMARY_NODE_SSH_KEY" "curl --noproxy '*' --max-time 10 -fsS http://127.0.0.1:27620/status" >"$evidence/gateway-status.json"
    node scripts/verify/public-bft-candidate-binding.mjs --gateway-observe "$candidate_binding" "$dependency_root/start-result.json" "$evidence/gateway-before-health.json" "$evidence/gateway-after-health.json" "$evidence/gateway-status.json" >"$evidence/result.json"
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
  local attempt="$ingress_root/$operation-attempt" remote="/tmp/ynx-ingress-${candidate_transaction_id}-$operation" helper hash
  mkdir -m 0700 "$attempt" || { echo "original RPC ingress attempt exists; retain UNKNOWN, no automatic retry" >&2; exit 1; }
  printf '{"mode":"single-app-gateway","status":"unknown","automaticRetry":false}\n' >"$attempt/intent.json"
  helper="$remote/helper.sh"
  hash="$(shasum -a 256 scripts/ops/remote/public-bft-ingress.sh | awk '{print $1}')"
  ynx_ops_ssh primary "$PRIMARY_NODE_USER" "$PRIMARY_NODE_HOST" "$PRIMARY_NODE_SSH_KEY" "umask 077; mkdir -m 0700 '$remote'" >"$attempt/reserve.txt"
  ynx_ops_copy primary "$PRIMARY_NODE_USER" "$PRIMARY_NODE_HOST" "$PRIMARY_NODE_SSH_KEY" scripts/ops/remote/public-bft-ingress.sh "$helper"
  ynx_ops_ssh primary "$PRIMARY_NODE_USER" "$PRIMARY_NODE_HOST" "$PRIMARY_NODE_SSH_KEY" "set -euo pipefail; printf '%s  %s\n' '$hash' '$helper' | sha256sum --strict -c - >/dev/null; sudo bash '$helper' '$operation' '$candidate_transaction_id' '$commit' '$candidate_bft_release' '$ingress_remote_root' single-app-gateway '$candidate_operator_pin' '$CONSENSUS_CANDIDATE_RUNTIME_COMMIT' '$CONSENSUS_CANDIDATE_RUNTIME_MANIFEST_SHA256' '$gateway_binary_sha'" >"$attempt/output.txt" 2>"$attempt/error.txt"
  if [[ "${DEPLOY_DRY_RUN:-0}" == 1 ]]; then
    node - "$candidate_binding" "$operation" "$gateway_binary_sha" >"$attempt/result.json" <<'NODE'
const fs=require("fs"),[p,op,gatewaySHA256]=process.argv.slice(2),b=JSON.parse(fs.readFileSync(p));
console.log(JSON.stringify({version:"YNX-SINGLE-APP-GATEWAY-INGRESS/v1",mode:"single-app-gateway",transactionId:b.transactionId,commit:b.commit,bftRelease:b.bftRelease,operatorPlanSHA256:b.operatorPlanSha256,runtimeCommit:b.runtimeCommit,runtimeSOURCEsha256:b.runtimeManifestSha256,gatewaySHA256,rpcOnly:true,ecosystemContinuityVerified:false,ingress:op==="switch"?"bft":"authoritative",publicCutoverReady:false,publicIngressChanged:false,dryRun:true}));
NODE
  else
    ynx_ops_ssh primary "$PRIMARY_NODE_USER" "$PRIMARY_NODE_HOST" "$PRIMARY_NODE_SSH_KEY" "sudo cat '$ingress_remote_root/ingress/$operation.json'" >"$attempt/result.json"
  fi
  node scripts/verify/public-bft-candidate-binding.mjs --ingress-check "$candidate_binding" "$attempt/result.json" "$operation" "${DEPLOY_DRY_RUN:-0}" "$gateway_binary_sha"
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
  node scripts/verify/public-bft-candidate-binding.mjs --ingress-check "$candidate_binding" "$ingress_root/switch-result.json" switch "${DEPLOY_DRY_RUN:-0}" "$gateway_binary_sha"
  local observation="${PUBLIC_BFT_PUBLIC_OBSERVATION_SECONDS:-4}" evidence="$ingress_root/public-continuity"
  [[ "$observation" =~ ^[0-9]+$ ]] && ((observation >= 2 && observation <= 15)) || exit 1
  local rpc="${PUBLIC_RPC_URL:-https://rpc.ynxweb4.com}" evm="${PUBLIC_EVM_RPC_URL:-https://evm.ynxweb4.com}"
  rpc="${rpc%/}"; evm="${evm%/}"
  [[ "$rpc" =~ ^https://[A-Za-z0-9.-]+$ && "$evm" =~ ^https://[A-Za-z0-9.-]+$ ]] || exit 1
  (umask 077; mkdir -m 0700 "$evidence") || { echo "original public observation exists; retain UNKNOWN" >&2; exit 1; }
  if [[ "${DEPLOY_DRY_RUN:-0}" == 1 ]]; then
    node - "$candidate_binding" >"$evidence/result.json" <<'NODE'
const fs=require("fs"),crypto=require("crypto"),p=process.argv[2],raw=fs.readFileSync(p),b=JSON.parse(raw);
console.log(JSON.stringify({version:"YNX-SINGLE-APP-GATEWAY-PUBLIC/v1",mode:"single-app-gateway",transactionId:b.transactionId,commit:b.commit,bftRelease:b.bftRelease,operatorPlanSHA256:b.operatorPlanSha256,runtimeCommit:b.runtimeCommit,runtimeSOURCEsha256:b.runtimeManifestSha256,bindingSHA256:crypto.createHash("sha256").update(raw).digest("hex"),migrationHeight:b.finalSnapshotHeight,migrationBlockHash:b.finalSnapshotBlockHash.replace(/^0x/,""),verified:false,dryRun:true,RPCOnly:true,publicIngressChanged:false,independentFinalityVerified:false,ecosystemContinuityVerified:false}));
NODE
    printf 'DRY RUN RPC-only public observation: %s %s\n' "$rpc" "$evm" >"$evidence/endpoints.txt"
  else
    curl --noproxy '*' --max-time 10 -fsS "$rpc/health" >"$evidence/gateway-before-health.json"
    sleep "$observation"
    curl --noproxy '*' --max-time 10 -fsS "$rpc/health" >"$evidence/gateway-after-health.json"
    curl --noproxy '*' --max-time 10 -fsS "$rpc/status" >"$evidence/gateway-status.json"
    node scripts/verify/public-bft-candidate-binding.mjs --gateway-observe "$candidate_binding" "$dependency_root/start-result.json" "$evidence/gateway-before-health.json" "$evidence/gateway-after-health.json" "$evidence/gateway-status.json" public >"$evidence/observation.json"
    curl --noproxy '*' --max-time 10 -fsS -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' "$evm" >"$evidence/evm-chain-id.json"
    node scripts/verify/public-bft-candidate-binding.mjs --public-read-targets "$candidate_binding" "$candidate_transaction_dir/final-snapshot/migration.json" "$evidence/gateway-status.json" >"$evidence/read-targets.txt"
    local account height
    read -r account height <"$evidence/read-targets.txt"
    curl --noproxy '*' --max-time 10 -fsS "$rpc/accounts/$account" >"$evidence/account.json"
    curl --noproxy '*' --max-time 10 -fsS "$rpc/blocks/$height" >"$evidence/block.json"
    local mutation_code
    mutation_code="$(curl --noproxy '*' --max-time 10 -sS -o /dev/null -w '%{http_code}' -H 'content-type: application/json' -d '{}' "$rpc/__ynx_mutation_freeze_probe__")"
    [[ "$mutation_code" =~ ^[0-9]{3}$ ]] || exit 1
    printf '{"httpStatus":%s}\n' "$mutation_code" >"$evidence/mutation-freeze.json"
    node scripts/verify/public-bft-candidate-binding.mjs --public-readback "$candidate_binding" "$evidence" >"$evidence/result.json"
  fi
  node scripts/verify/public-bft-candidate-binding.mjs --public-result-check "$candidate_binding" "$evidence/result.json" "${DEPLOY_DRY_RUN:-0}"
  ln "$evidence/result.json" "$ingress_root/public-result.json"
}
[[ "$(git branch --show-current)" == "main" ]] || { echo "production driver requires main branch" >&2; exit 1; }
[[ -z "$(git status --short --untracked-files=no)" ]] || { echo "production driver requires no tracked worktree changes" >&2; exit 1; }

commit="$(git rev-parse --short=12 HEAD)"
release="ynx-chain-${commit}"

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
    ynx_ops_copy "$role" "$user" "$host" "$key" scripts/ops/remote/public-bft-scoped-backup.sh "$remote_helper"
    ynx_ops_ssh "$role" "$user" "$host" "$key" "set -euo pipefail; trap 'rm -f \"$remote_helper\"' EXIT; chmod 0700 '$remote_helper'; sudo bash '$remote_helper' '$transaction_id' '$role' '$commit' '$release' '$bft_release' '$remote_root' '$indexer_required' /" >"$evidence_dir/${role}-backup.txt"
  }
  ynx_ops_each_node backup_role
  echo "production BFT scoped backups passed: transaction=$transaction_id evidence=$evidence_dir"
}

mutation_freeze_phase() {
  local operation="$1"
  if [[ "$operation" == unfreeze && ( -e "${PUBLIC_BFT_CUTOVER_TRANSACTION_DIR:-}/candidate/initialize-attempt" || -L "${PUBLIC_BFT_CUTOVER_TRANSACTION_DIR:-}/candidate/initialize-attempt" ) ]]; then
    prepare_candidate_package
    ingress_context
    node scripts/verify/public-bft-candidate-binding.mjs --public-result-check "$candidate_binding" "$ingress_root/public-result.json" "${DEPLOY_DRY_RUN:-0}"
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
    # Shared marker semantics are preserved. Only the authorized chain RPC and
    # its new gateway are probed; paused products keep their original services.
    if [[ "$role" == primary && "$operation" == unfreeze && -s "$transaction_dir/ingress/public-result.json" ]]; then mutation_urls+=",http://127.0.0.1:27620"; fi
    ynx_ops_copy "$role" "$user" "$host" "$key" scripts/ops/remote/public-bft-mutation-freeze.sh "$remote_helper"
    ynx_ops_ssh "$role" "$user" "$host" "$key" "set -euo pipefail; trap 'rm -f \"$remote_helper\"' EXIT; chmod 0700 '$remote_helper'; sudo bash '$remote_helper' '$operation' '$transaction_id' '$role' '$commit' '$release' '$bft_release' /var/lib/ynx-chain/mutation-freeze.json '$remote_root' http://127.0.0.1:6420 '$mutation_urls' /" >"$evidence_dir/${role}-${operation}.txt"
  }
  ynx_ops_each_node mutate_role
  echo "production BFT mutation $operation passed: transaction=$transaction_id evidence=$evidence_dir"
}

gateway_recovery_phase() {
  prepare_candidate_package
  ingress_context
  validated_candidate_result
  validated_gateway_start
  validated_continuity_result
  node scripts/verify/public-bft-candidate-binding.mjs --ingress-check "$candidate_binding" "$ingress_root/switch-result.json" switch "${DEPLOY_DRY_RUN:-0}" "$gateway_binary_sha"
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
  node scripts/verify/public-bft-candidate-binding.mjs --gateway-observe "$candidate_binding" "$dependency_root/start-result.json" "$evidence/gateway-before-health.json" "$evidence/gateway-after-health.json" "$evidence/gateway-status.json" public >"$evidence/observation.json"
  node - "$candidate_binding" "$evidence" >"$evidence/result.json" <<'NODE'
const fs=require("fs"),[p,d]=process.argv.slice(2),b=JSON.parse(fs.readFileSync(p)),o=JSON.parse(fs.readFileSync(d+"/observation.json"));
for(const name of ["native-before","native-after"]){const s=JSON.parse(fs.readFileSync(d+"/"+name+".json"));if(s.chainId!==6423||s.nativeCurrencySymbol!=="YNXT"||s.height!==b.finalSnapshotHeight||s.latestBlockHash!==b.finalSnapshotBlockHash||s.build?.commit!==b.commit||s.build?.release!==b.authoritativeRelease||s.nodeIdentity?.replicationMode!=="authoritative_producer")process.exit(1)}
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
  node scripts/verify/validate-public-bft-production-recovery.mjs "$evidence_dir" "$commit" "$release" >"$evidence_dir/validation.json"
  echo "production BFT recovery verification passed: transaction=$transaction_id evidence=$evidence_dir"
}

if [[ "$action" == "backup" || "$action" == "freeze_mutations" || "$action" == "unfreeze_mutations" || "$action" == "pause_authoritative" || "$action" == "resume_authoritative" || "$action" == "export_final_snapshot" || "$action" == "initialize_candidate" || "$action" == "deploy_candidate" || "$action" == "start_candidate" || "$action" == "verify_candidate" || "$action" == "rollback_candidate" || "$action" == "start_dependencies" || "$action" == "verify_continuity" || "$action" == "rollback_dependencies" || "$action" == "switch_ingress" || "$action" == "verify_public" || "$action" == "rollback_ingress" || "$action" == "verify_recovery" ]]; then
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
    rollback_candidate) rollback_candidate_phase ;;
    start_dependencies) start_dependencies_phase ;;
    verify_continuity) verify_continuity_phase ;;
    rollback_dependencies) rollback_dependencies_phase ;;
    switch_ingress) switch_ingress_phase ;;
    rollback_ingress) rollback_ingress_phase ;;
    verify_public) verify_public_phase ;;
    verify_recovery) recovery_phase ;;
  esac
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
shasum -a 256 "$runtime_bin/ynx-abci" "$runtime_bin/ynx-comet" "$runtime_bin/ynx-bft-gatewayd" "$runtime_bin/ynx-consensus-keycheck" >"$root/prebuilt.sha256"

collect_role() {
  local role="$1" user="$2" host="$3" key="$4" kind="$5"
  local role_dir="$root/roles/$role" validator services candidate_port_pattern custody_command
  mkdir -p "$role_dir"
  case "$role" in
    primary) validator=ynx_validator_primary ;;
    singapore) validator=ynx_validator_singapore ;;
    silicon-valley) validator=ynx_validator_silicon_valley ;;
    seoul) validator=ynx_validator_seoul ;;
  esac
  services="$(ynx_ops_services_for_kind "$kind")"
  candidate_port_pattern=':(27656|27757|27858)$'
  if [[ "$kind" == "full" ]]; then
    candidate_port_pattern=':(27620|27626|27627|27628|27629|27630|27631|27632|27656|27757|27858)$'
  fi
  custody_command="$(node scripts/verify/public-bft-candidate-binding.mjs --operator-preflight "$candidate_operator_plan" "$candidate_operator_pin" "$role" fresh)"
  ynx_ops_ssh "$role" "$user" "$host" "$key" "curl -fsS http://127.0.0.1:6420/status" >"$role_dir/status.json"
  ynx_ops_ssh "$role" "$user" "$host" "$key" "set -eu
$custody_command
manifest=/opt/ynx-chain/releases/$release/config/release-manifest.json; for service in $services; do systemctl is-active \"\$service\" >/dev/null; done; systemctl is-active ynx-consensus-overlay.service >/dev/null; ip link show ynxwg0 >/dev/null; sudo test ! -e /var/lib/ynx-chain/consensus-candidate; ! systemctl is-active --quiet ynx-consensus-comet-candidate.service; ! systemctl is-active --quiet ynx-consensus-abci-candidate.service; ! systemctl is-active --quiet ynx-consensus-operator-candidate.service; ! ss -ltn | awk '{print \$4}' | grep -Eq '$candidate_port_pattern'; sudo test ! -e /var/lib/ynx-chain/mutation-freeze.json; sudo test -d '${BACKUP_STORAGE_PATH:-/var/backups/ynx-chain}'; test \"\$(df -Pk /var/lib/ynx-chain | awk 'NR==2 {print \$4}')\" -gt 2097152; test -f \"\$manifest\"; printf 'role=%s\\nvalidator=%s\\nrelease=%s\\nservices=active\\noverlay=active\\nkeys=restricted\\ncandidate=absent\\nfreeze=absent\\nports=free\\ndisk=ready\\nbackup=present\\nmanifest_sha256=' '$role' '$validator' '$release'; sha256sum \"\$manifest\" | awk '{print \$1}'" >"$role_dir/preflight.txt"
}
ynx_ops_each_node collect_role

height="$(node -e 'const fs=require("fs"),p=process.argv[1],roles=["primary","singapore","silicon-valley","seoul"]; const h=roles.map(r=>Number(JSON.parse(fs.readFileSync(`${p}/roles/${r}/status.json`)).height)); if(h.some(v=>!Number.isSafeInteger(v)||v<3)) process.exit(1); process.stdout.write(String(Math.min(...h)-2));' "$root")"
printf '%s\n' "$height" >"$root/convergence-height.txt"

collect_block() {
  local role="$1" user="$2" host="$3" key="$4" _kind="$5"
  ynx_ops_ssh "$role" "$user" "$host" "$key" "curl -fsS http://127.0.0.1:6420/blocks/$height" >"$root/roles/$role/block.json"
}
ynx_ops_each_node collect_block

node scripts/verify/validate-public-bft-production-rehearsal.mjs "$root" "$commit" "$release" >"$root/validation.json"
printf '{"status":"passed","commit":"%s","release":"%s","height":%s,"at":"%s","remoteMutation":false,"publicIngressChanged":false}\n' "$commit" "$release" "$height" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >"$root/result.json"
trap - EXIT
echo "production BFT rehearsal passed without remote mutation: evidence=$root"
