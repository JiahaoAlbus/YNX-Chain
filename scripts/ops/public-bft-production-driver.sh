#!/usr/bin/env bash
set -Eeuo pipefail

cd "$(dirname "$0")/../.."
# shellcheck source=lib.sh
source scripts/ops/lib.sh
ynx_ops_init

action="${1:-rehearse}"
[[ "$action" == "rehearse" || "$action" == "preflight" || "$action" == "backup" || "$action" == "freeze_mutations" || "$action" == "unfreeze_mutations" || "$action" == "pause_authoritative" || "$action" == "resume_authoritative" || "$action" == "export_final_snapshot" || "$action" == "deploy_candidate" || "$action" == "verify_candidate" || "$action" == "rollback_candidate" || "$action" == "start_dependencies" || "$action" == "verify_continuity" || "$action" == "rollback_dependencies" || "$action" == "switch_ingress" || "$action" == "verify_public" || "$action" == "rollback_ingress" || "$action" == "verify_recovery" ]] || {
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
  go run ./cmd/ynx-consensus-package -verify-migration-state "$transaction_dir/final-snapshot/migration.json" >"$transaction_dir/final-snapshot/local-validation.txt"
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
  umask 077
  mkdir -p "$candidate_root"
  chmod 0700 "$candidate_root"
  node scripts/verify/public-bft-candidate-binding.mjs --inputs-only "$candidate_transaction_dir" "$commit" "$candidate_bft_release" "$validator_manifest" "$genesis_time" >/dev/null
  if [[ -e "$candidate_package" || -e "$candidate_binding" ]]; then
    [[ -d "$candidate_package" && -s "$candidate_binding" ]] || { echo "partial candidate package state exists" >&2; exit 1; }
    go run ./cmd/ynx-consensus-package -verify-package "$candidate_package" >/dev/null
    local expected_binding="$candidate_root/binding.expected.json"
    node scripts/verify/public-bft-candidate-binding.mjs "$candidate_transaction_dir" "$commit" "$candidate_bft_release" "$validator_manifest" "$genesis_time" "$candidate_package" >"$expected_binding"
    chmod 0600 "$expected_binding"
    cmp "$candidate_binding" "$expected_binding" >/dev/null || { rm -f "$expected_binding"; echo "existing candidate binding mismatch" >&2; exit 1; }
    rm -f "$expected_binding"
    return
  fi
  go run ./cmd/ynx-consensus-package \
    -migration-state "$candidate_transaction_dir/final-snapshot/migration.json" \
    -validator-manifest "$validator_manifest" \
    -genesis-time "$genesis_time" \
    -output "$candidate_package" >/dev/null
  go run ./cmd/ynx-consensus-package -verify-package "$candidate_package" >/dev/null
  local partial_binding="$candidate_binding.partial"
  node scripts/verify/public-bft-candidate-binding.mjs "$candidate_transaction_dir" "$commit" "$candidate_bft_release" "$validator_manifest" "$genesis_time" "$candidate_package" >"$partial_binding"
  chmod 0600 "$partial_binding"
  mv "$partial_binding" "$candidate_binding"
}

deploy_candidate_phase() {
  prepare_candidate_package
  local binding_sha result="$candidate_root/deploy-result.json"
  binding_sha="$(shasum -a 256 "$candidate_binding" | awk '{print $1}')"
  if [[ -s "$result" ]]; then
    node -e 'const fs=require("fs"),[p,tx,c,r,s]=process.argv.slice(1),v=JSON.parse(fs.readFileSync(p)); if(v.transactionId!==tx||v.commit!==c||v.bftRelease!==r||v.bindingSha256!==s||v.deployed!==true) process.exit(1)' "$result" "$candidate_transaction_id" "$commit" "$candidate_bft_release" "$binding_sha" || { echo "existing candidate deploy result mismatch" >&2; exit 1; }
    CONSENSUS_CANDIDATE_PACKAGE="$candidate_package" CONSENSUS_CANDIDATE_EVIDENCE_DIR="$candidate_root/reuse-evidence" bash scripts/verify/verify-consensus-candidate.sh >"$candidate_root/deploy-reuse.txt"
    echo "production BFT candidate deploy reused verified result: transaction=$candidate_transaction_id"
    return
  fi
  CONSENSUS_CANDIDATE_PACKAGE="$candidate_package" \
    CONSENSUS_CANDIDATE_APPROVED=yes \
    CONSENSUS_CANDIDATE_WORK_ROOT="$candidate_root/deploy-work" \
    bash scripts/deploy/deploy-consensus-candidate.sh >"$candidate_root/deploy.txt"
  printf '{"transactionId":"%s","commit":"%s","bftRelease":"%s","candidateRelease":"%s","bindingSha256":"%s","deployed":true,"dryRun":%s}\n' \
    "$candidate_transaction_id" "$commit" "$candidate_bft_release" "$candidate_release" "$binding_sha" "$([[ "${DEPLOY_DRY_RUN:-0}" == "1" ]] && echo true || echo false)" >"$result"
  chmod 0600 "$result"
  echo "production BFT candidate deploy passed: transaction=$candidate_transaction_id evidence=$candidate_root"
}

verify_candidate_phase() {
  prepare_candidate_package
  local deploy_result="$candidate_root/deploy-result.json" binding_sha
  test -s "$deploy_result"
  binding_sha="$(shasum -a 256 "$candidate_binding" | awk '{print $1}')"
  node -e 'const fs=require("fs"),[p,tx,c,r,s]=process.argv.slice(1),v=JSON.parse(fs.readFileSync(p)); if(v.transactionId!==tx||v.commit!==c||v.bftRelease!==r||v.bindingSha256!==s||v.deployed!==true) process.exit(1)' "$deploy_result" "$candidate_transaction_id" "$commit" "$candidate_bft_release" "$binding_sha" || { echo "candidate deploy result is not transaction-bound" >&2; exit 1; }
  local evidence="$candidate_root/remote-evidence"
  CONSENSUS_CANDIDATE_PACKAGE="$candidate_package" CONSENSUS_CANDIDATE_EVIDENCE_DIR="$evidence" bash scripts/verify/verify-consensus-candidate.sh >"$candidate_root/verify.txt"
  if [[ "${DEPLOY_DRY_RUN:-0}" == "1" ]]; then
    printf '{"transactionId":"%s","commit":"%s","bftRelease":"%s","bindingSha256":"%s","verified":true,"dryRun":true}\n' "$candidate_transaction_id" "$commit" "$candidate_bft_release" "$binding_sha" >"$candidate_root/verify-result.json"
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
  dependency_root="$candidate_transaction_dir/dependencies"
  dependency_approval="$candidate_transaction_dir/approval.json"
  dependency_remote_root="${BACKUP_STORAGE_PATH:-/var/backups/ynx-chain}/public-bft-cutover/${candidate_transaction_id}"
  dependency_helper="/tmp/ynx-public-bft-dependencies-${candidate_transaction_id}.sh"
  dependency_migration_height=1
  dependency_migration_hash="$(printf '0%.0s' {1..64})"
  if [[ -s "$candidate_binding" ]]; then
    read -r dependency_migration_height dependency_migration_hash < <(node -e 'const fs=require("fs"),v=JSON.parse(fs.readFileSync(process.argv[1])); if(!Number.isSafeInteger(v.finalSnapshotHeight)||v.finalSnapshotHeight<1||!(/^(0x)?[0-9a-fA-F]{64}$/).test(v.finalSnapshotBlockHash||"")) process.exit(1); process.stdout.write(`${v.finalSnapshotHeight} ${String(v.finalSnapshotBlockHash).replace(/^0x/,"").toLowerCase()}\n`)' "$candidate_binding")
  fi
}

validated_candidate_result() {
  test -s "$candidate_root/verify-result.json"
  local binding_sha
  binding_sha="$(shasum -a 256 "$candidate_binding" | awk '{print $1}')"
  node -e 'const fs=require("fs"),[p,tx,c,r,s]=process.argv.slice(1),v=JSON.parse(fs.readFileSync(p)); if(v.transactionId!==tx||v.commit!==c||v.bftRelease!==r||v.bindingSha256!==s||v.verified!==true) process.exit(1)' "$candidate_root/verify-result.json" "$candidate_transaction_id" "$commit" "$candidate_bft_release" "$binding_sha"
}

dependency_signer_inputs() {
  dependency_faucet_key="${PUBLIC_BFT_FAUCET_SIGNER_KEY_FILE:-}"
  dependency_faucet_address="${PUBLIC_BFT_FAUCET_SIGNER_ADDRESS:-}"
  dependency_ai_key="${PUBLIC_BFT_AI_SIGNER_KEY_FILE:-}"
  dependency_ai_address="${PUBLIC_BFT_AI_SIGNER_ADDRESS:-}"
  dependency_pay_key="${PUBLIC_BFT_PAY_SIGNER_KEY_FILE:-}"
  dependency_pay_address="${PUBLIC_BFT_PAY_SIGNER_ADDRESS:-}"
  dependency_trust_key="${PUBLIC_BFT_TRUST_SIGNER_KEY_FILE:-}"
  dependency_trust_address="${PUBLIC_BFT_TRUST_SIGNER_ADDRESS:-}"
  dependency_resource_key="${PUBLIC_BFT_RESOURCE_SIGNER_KEY_FILE:-}"
  dependency_resource_address="${PUBLIC_BFT_RESOURCE_SIGNER_ADDRESS:-}"
  local value
  for value in "$dependency_faucet_key" "$dependency_faucet_address" "$dependency_ai_key" "$dependency_ai_address" "$dependency_pay_key" "$dependency_pay_address" "$dependency_trust_key" "$dependency_trust_address" "$dependency_resource_key" "$dependency_resource_address"; do
    [[ -n "$value" ]] || { echo "all PUBLIC_BFT_*_SIGNER_KEY_FILE and PUBLIC_BFT_*_SIGNER_ADDRESS inputs are required" >&2; exit 1; }
  done
}

start_dependencies_phase() {
  [[ "${PUBLIC_BFT_PRODUCTION_DEPENDENCIES_APPROVED:-}" == "yes" ]] || { echo "PUBLIC_BFT_PRODUCTION_DEPENDENCIES_APPROVED=yes is required" >&2; exit 1; }
  prepare_candidate_package
  dependency_context
  validated_candidate_result
  dependency_signer_inputs
  umask 077
  mkdir -p "$dependency_root" "$candidate_transaction_dir/roles"
  ynx_ops_copy primary "$PRIMARY_NODE_USER" "$PRIMARY_NODE_HOST" "$PRIMARY_NODE_SSH_KEY" scripts/ops/remote/public-bft-dependencies.sh "$dependency_helper"
  ynx_ops_ssh primary "$PRIMARY_NODE_USER" "$PRIMARY_NODE_HOST" "$PRIMARY_NODE_SSH_KEY" "set -euo pipefail; trap 'rm -f \"$dependency_helper\"' EXIT; chmod 0700 '$dependency_helper'; sudo bash '$dependency_helper' start '$candidate_transaction_id' '$commit' '$candidate_bft_release' '$dependency_migration_height' '$dependency_migration_hash' '$dependency_remote_root' '$dependency_faucet_key' '$dependency_faucet_address' '$dependency_ai_key' '$dependency_ai_address' '$dependency_pay_key' '$dependency_pay_address' '$dependency_trust_key' '$dependency_trust_address' '$dependency_resource_key' '$dependency_resource_address'" >"$candidate_transaction_dir/roles/primary-start-dependencies.txt"
  if [[ "${DEPLOY_DRY_RUN:-0}" == "1" ]]; then
    printf '{"transactionId":"%s","commit":"%s","bftRelease":"%s","migrationHeight":%s,"migrationBlockHash":"%s","parallelCandidateOnly":true,"dryRun":true}\n' "$candidate_transaction_id" "$commit" "$candidate_bft_release" "$dependency_migration_height" "$dependency_migration_hash" >"$dependency_root/start-result.json"
  else
    ynx_ops_ssh primary "$PRIMARY_NODE_USER" "$PRIMARY_NODE_HOST" "$PRIMARY_NODE_SSH_KEY" "sudo cat '$dependency_remote_root/primary-dependencies-start.json'" >"$dependency_root/start-result.json"
  fi
  chmod 0600 "$dependency_root/start-result.json"
  echo "production BFT parallel dependencies started: transaction=$candidate_transaction_id evidence=$dependency_root"
}

verify_continuity_phase() {
  [[ "${PUBLIC_BFT_PRODUCTION_DEPENDENCIES_APPROVED:-}" == "yes" ]] || { echo "PUBLIC_BFT_PRODUCTION_DEPENDENCIES_APPROVED=yes is required" >&2; exit 1; }
  prepare_candidate_package
  dependency_context
  validated_candidate_result
  test -s "$dependency_root/start-result.json"
  node -e 'const fs=require("fs"),[p,tx,c,r,h,b]=process.argv.slice(1),v=JSON.parse(fs.readFileSync(p)); if(v.transactionId!==tx||v.commit!==c||v.bftRelease!==r||v.migrationHeight!==Number(h)||v.migrationBlockHash!==b||v.parallelCandidateOnly!==true) process.exit(1)' \
    "$dependency_root/start-result.json" "$candidate_transaction_id" "$commit" "$candidate_bft_release" "$dependency_migration_height" "$dependency_migration_hash" || { echo "dependency startup result is not transaction-bound" >&2; exit 1; }
  local observation="${PUBLIC_BFT_DEPENDENCY_CONTINUITY_OBSERVATION_SECONDS:-4}"
  local max_lag="${PUBLIC_BFT_DEPENDENCY_MAX_INDEX_LAG:-3}"
  [[ "$observation" =~ ^[0-9]+$ ]] && ((observation >= 2 && observation <= 15)) || { echo "PUBLIC_BFT_DEPENDENCY_CONTINUITY_OBSERVATION_SECONDS must be between 2 and 15" >&2; exit 1; }
  [[ "$max_lag" =~ ^[0-9]+$ ]] && ((max_lag <= 20)) || { echo "PUBLIC_BFT_DEPENDENCY_MAX_INDEX_LAG must be between 0 and 20" >&2; exit 1; }
  local evidence="$dependency_root/continuity"
  rm -rf "$evidence"
  mkdir -p "$evidence"
  ynx_ops_ssh primary "$PRIMARY_NODE_USER" "$PRIMARY_NODE_HOST" "$PRIMARY_NODE_SSH_KEY" "curl -fsS http://127.0.0.1:27620/health" >"$evidence/gateway-before-health.json"
  ynx_ops_ssh primary "$PRIMARY_NODE_USER" "$PRIMARY_NODE_HOST" "$PRIMARY_NODE_SSH_KEY" "curl -fsS http://127.0.0.1:27626/health" >"$evidence/indexer-before-health.json"
  if [[ "${DEPLOY_DRY_RUN:-0}" == "1" ]]; then
    printf '{"transactionId":"%s","commit":"%s","bftRelease":"%s","parallelCandidateOnly":true,"publicIngressChanged":false,"dryRun":true}\n' "$candidate_transaction_id" "$commit" "$candidate_bft_release" >"$dependency_root/continuity-result.json"
    chmod 0600 "$dependency_root/continuity-result.json"
    echo "production BFT dependency continuity dry-run passed: transaction=$candidate_transaction_id"
    return
  fi
  sleep "$observation"
  ynx_ops_ssh primary "$PRIMARY_NODE_USER" "$PRIMARY_NODE_HOST" "$PRIMARY_NODE_SSH_KEY" "curl -fsS http://127.0.0.1:27620/health" >"$evidence/gateway-after-health.json"
  ynx_ops_ssh primary "$PRIMARY_NODE_USER" "$PRIMARY_NODE_HOST" "$PRIMARY_NODE_SSH_KEY" "curl -fsS http://127.0.0.1:27620/status" >"$evidence/gateway-after-status.json"
  ynx_ops_ssh primary "$PRIMARY_NODE_USER" "$PRIMARY_NODE_HOST" "$PRIMARY_NODE_SSH_KEY" "curl -fsS http://127.0.0.1:27626/health" >"$evidence/indexer-after-health.json"
  ynx_ops_ssh primary "$PRIMARY_NODE_USER" "$PRIMARY_NODE_HOST" "$PRIMARY_NODE_SSH_KEY" "curl -fsS http://127.0.0.1:27627/health" >"$evidence/explorer-health.json"
  ynx_ops_ssh primary "$PRIMARY_NODE_USER" "$PRIMARY_NODE_HOST" "$PRIMARY_NODE_SSH_KEY" "curl -fsS http://127.0.0.1:27628/health" >"$evidence/faucet-health.json"
  ynx_ops_ssh primary "$PRIMARY_NODE_USER" "$PRIMARY_NODE_HOST" "$PRIMARY_NODE_SSH_KEY" "curl -fsS http://127.0.0.1:27629/health" >"$evidence/ai-health.json"
  ynx_ops_ssh primary "$PRIMARY_NODE_USER" "$PRIMARY_NODE_HOST" "$PRIMARY_NODE_SSH_KEY" "curl -fsS http://127.0.0.1:27630/health" >"$evidence/pay-health.json"
  ynx_ops_ssh primary "$PRIMARY_NODE_USER" "$PRIMARY_NODE_HOST" "$PRIMARY_NODE_SSH_KEY" "curl -fsS http://127.0.0.1:27631/health" >"$evidence/trust-health.json"
  ynx_ops_ssh primary "$PRIMARY_NODE_USER" "$PRIMARY_NODE_HOST" "$PRIMARY_NODE_SSH_KEY" "curl -fsS http://127.0.0.1:27632/health" >"$evidence/resource-health.json"
  node scripts/verify/validate-public-bft-dependency-continuity.mjs "$evidence" "$commit" "$candidate_bft_release" "$dependency_migration_height" "$dependency_migration_hash" "$max_lag" "$dependency_root/continuity-result.json"
  echo "production BFT dependency continuity passed: transaction=$candidate_transaction_id evidence=$dependency_root"
}

rollback_dependencies_phase() {
  dependency_context
  node scripts/verify/validate-public-bft-cutover-approval-evidence.mjs "$dependency_approval" "$commit" "$candidate_bft_release" >/dev/null
  umask 077
  mkdir -p "$dependency_root" "$candidate_transaction_dir/roles"
  ynx_ops_copy primary "$PRIMARY_NODE_USER" "$PRIMARY_NODE_HOST" "$PRIMARY_NODE_SSH_KEY" scripts/ops/remote/public-bft-dependencies.sh "$dependency_helper"
  local output="$candidate_transaction_dir/roles/primary-rollback-dependencies.txt" attempt=1
  while [[ -e "$output" ]]; do ((attempt += 1)); output="$candidate_transaction_dir/roles/primary-rollback-dependencies-attempt-${attempt}.txt"; done
  ynx_ops_ssh primary "$PRIMARY_NODE_USER" "$PRIMARY_NODE_HOST" "$PRIMARY_NODE_SSH_KEY" "set -euo pipefail; trap 'rm -f \"$dependency_helper\"' EXIT; chmod 0700 '$dependency_helper'; sudo bash '$dependency_helper' rollback '$candidate_transaction_id' '$commit' '$candidate_bft_release' '$dependency_migration_height' '$dependency_migration_hash' '$dependency_remote_root'" >"$output"
  if [[ "${DEPLOY_DRY_RUN:-0}" == "1" ]]; then
    printf '{"transactionId":"%s","commit":"%s","bftRelease":"%s","automaticRollbackAuthorized":true,"rolledBack":true,"dryRun":true}\n' "$candidate_transaction_id" "$commit" "$candidate_bft_release" >"$dependency_root/rollback-result.json"
  else
    ynx_ops_ssh primary "$PRIMARY_NODE_USER" "$PRIMARY_NODE_HOST" "$PRIMARY_NODE_SSH_KEY" "sudo cat '$dependency_remote_root/primary-dependencies-rollback.json'" >"$dependency_root/rollback-result.json"
  fi
  chmod 0600 "$dependency_root/rollback-result.json"
  echo "production BFT dependency rollback passed: transaction=$candidate_transaction_id evidence=$dependency_root"
}

ingress_context() {
  dependency_context
  ingress_root="$candidate_transaction_dir/ingress"
  ingress_remote_root="$dependency_remote_root"
  ingress_helper="/tmp/ynx-public-bft-ingress-${candidate_transaction_id}.sh"
}

validated_continuity_result() {
  test -s "$dependency_root/continuity-result.json"
  node -e 'const fs=require("fs"),[p,c,r]=process.argv.slice(1),v=JSON.parse(fs.readFileSync(p)); if(v.commit!==c||v.release!==r||v.status!=="passed"||v.parallelCandidateOnly!==true||v.publicIngressChanged!==false||v.publicCutoverAuthorized!==false) process.exit(1)' \
    "$dependency_root/continuity-result.json" "$commit" "$candidate_bft_release"
}

switch_ingress_phase() {
  [[ "${PUBLIC_BFT_PRODUCTION_INGRESS_APPROVED:-}" == "yes" ]] || { echo "PUBLIC_BFT_PRODUCTION_INGRESS_APPROVED=yes is required" >&2; exit 1; }
  ingress_context
  validated_candidate_result
  if [[ "${DEPLOY_DRY_RUN:-0}" != "1" ]]; then
    validated_continuity_result
  else
    test -s "$dependency_root/continuity-result.json"
  fi
  umask 077
  mkdir -p "$ingress_root" "$candidate_transaction_dir/roles"
  ynx_ops_copy primary "$PRIMARY_NODE_USER" "$PRIMARY_NODE_HOST" "$PRIMARY_NODE_SSH_KEY" scripts/ops/remote/public-bft-ingress.sh "$ingress_helper"
  ynx_ops_ssh primary "$PRIMARY_NODE_USER" "$PRIMARY_NODE_HOST" "$PRIMARY_NODE_SSH_KEY" "set -euo pipefail; trap 'rm -f \"$ingress_helper\"' EXIT; chmod 0700 '$ingress_helper'; sudo bash '$ingress_helper' switch '$candidate_transaction_id' '$commit' '$candidate_bft_release' '$ingress_remote_root'" >"$candidate_transaction_dir/roles/primary-switch-ingress.txt"
  if [[ "${DEPLOY_DRY_RUN:-0}" == "1" ]]; then
    printf '{"transactionId":"%s","commit":"%s","bftRelease":"%s","ingress":"bft","publicCutoverReady":true,"publicIngressChanged":true,"automaticRollbackRequired":true,"dryRun":true}\n' "$candidate_transaction_id" "$commit" "$candidate_bft_release" >"$ingress_root/switch-result.json"
  else
    ynx_ops_ssh primary "$PRIMARY_NODE_USER" "$PRIMARY_NODE_HOST" "$PRIMARY_NODE_SSH_KEY" "sudo cat '$ingress_remote_root/ingress/switch.json'" >"$ingress_root/switch-result.json"
  fi
  chmod 0600 "$ingress_root/switch-result.json"
  echo "production BFT ingress switch passed: transaction=$candidate_transaction_id evidence=$ingress_root"
}

rollback_ingress_phase() {
  ingress_context
  node scripts/verify/validate-public-bft-cutover-approval-evidence.mjs "$dependency_approval" "$commit" "$candidate_bft_release" >/dev/null
  umask 077
  mkdir -p "$ingress_root" "$candidate_transaction_dir/roles"
  ynx_ops_copy primary "$PRIMARY_NODE_USER" "$PRIMARY_NODE_HOST" "$PRIMARY_NODE_SSH_KEY" scripts/ops/remote/public-bft-ingress.sh "$ingress_helper"
  local output="$candidate_transaction_dir/roles/primary-rollback-ingress.txt" attempt=1
  while [[ -e "$output" ]]; do ((attempt += 1)); output="$candidate_transaction_dir/roles/primary-rollback-ingress-attempt-${attempt}.txt"; done
  ynx_ops_ssh primary "$PRIMARY_NODE_USER" "$PRIMARY_NODE_HOST" "$PRIMARY_NODE_SSH_KEY" "set -euo pipefail; trap 'rm -f \"$ingress_helper\"' EXIT; chmod 0700 '$ingress_helper'; sudo bash '$ingress_helper' rollback '$candidate_transaction_id' '$commit' '$candidate_bft_release' '$ingress_remote_root'" >"$output"
  if [[ "${DEPLOY_DRY_RUN:-0}" == "1" ]]; then
    printf '{"transactionId":"%s","commit":"%s","bftRelease":"%s","ingress":"authoritative","publicCutoverReady":false,"automaticRollbackAuthorized":true,"rolledBack":true,"dryRun":true}\n' "$candidate_transaction_id" "$commit" "$candidate_bft_release" >"$ingress_root/rollback-result.json"
  else
    ynx_ops_ssh primary "$PRIMARY_NODE_USER" "$PRIMARY_NODE_HOST" "$PRIMARY_NODE_SSH_KEY" "sudo cat '$ingress_remote_root/ingress/rollback.json'" >"$ingress_root/rollback-result.json"
  fi
  chmod 0600 "$ingress_root/rollback-result.json"
  echo "production BFT ingress rollback passed: transaction=$candidate_transaction_id evidence=$ingress_root"
}

verify_public_phase() {
  [[ "${PUBLIC_BFT_PRODUCTION_INGRESS_APPROVED:-}" == "yes" ]] || { echo "PUBLIC_BFT_PRODUCTION_INGRESS_APPROVED=yes is required" >&2; exit 1; }
  ingress_context
  validated_candidate_result
  test -s "$ingress_root/switch-result.json"
  node -e 'const fs=require("fs"),[p,tx,c,r]=process.argv.slice(1),v=JSON.parse(fs.readFileSync(p)); if(v.transactionId!==tx||v.commit!==c||v.bftRelease!==r||v.ingress!=="bft"||v.publicCutoverReady!==true||v.publicIngressChanged!==true||v.automaticRollbackRequired!==true) process.exit(1)' \
    "$ingress_root/switch-result.json" "$candidate_transaction_id" "$commit" "$candidate_bft_release" || { echo "ingress switch result is not transaction-bound" >&2; exit 1; }
  local observation="${PUBLIC_BFT_PUBLIC_OBSERVATION_SECONDS:-4}" max_lag="${PUBLIC_BFT_PUBLIC_MAX_INDEX_LAG:-3}"
  [[ "$observation" =~ ^[0-9]+$ ]] && ((observation >= 2 && observation <= 15)) || { echo "PUBLIC_BFT_PUBLIC_OBSERVATION_SECONDS must be between 2 and 15" >&2; exit 1; }
  [[ "$max_lag" =~ ^[0-9]+$ ]] && ((max_lag <= 20)) || { echo "PUBLIC_BFT_PUBLIC_MAX_INDEX_LAG must be between 0 and 20" >&2; exit 1; }
  local rpc="${PUBLIC_RPC_URL:-https://rpc.ynxweb4.com}" evm="${PUBLIC_EVM_RPC_URL:-https://evm.ynxweb4.com}" rest="${PUBLIC_REST_URL:-https://rest.ynxweb4.com}"
  local indexer="${PUBLIC_INDEXER_URL:-https://indexer.ynxweb4.com}" explorer="${PUBLIC_EXPLORER_URL:-https://explorer.ynxweb4.com}" faucet="${PUBLIC_FAUCET_URL:-https://faucet.ynxweb4.com}"
  local ai="${PUBLIC_AI_URL:-https://ai.ynxweb4.com}" pay="${PUBLIC_PAY_URL:-https://pay.ynxweb4.com}" trust="${PUBLIC_TRUST_URL:-https://trust.ynxweb4.com}" resource="${PUBLIC_RESOURCE_URL:-https://resource.ynxweb4.com}"
  rpc="${rpc%/}"; evm="${evm%/}"; rest="${rest%/}"; indexer="${indexer%/}"; explorer="${explorer%/}"; faucet="${faucet%/}"; ai="${ai%/}"; pay="${pay%/}"; trust="${trust%/}"; resource="${resource%/}"
  local evidence="$ingress_root/public-continuity"
  rm -rf "$evidence"
  mkdir -p "$evidence"
  if [[ "${DEPLOY_DRY_RUN:-0}" == "1" ]]; then
    printf '{"transactionId":"%s","commit":"%s","release":"%s","status":"dry-run","publicIngressChanged":true,"automaticRollbackRequired":true}\n' "$candidate_transaction_id" "$commit" "$candidate_bft_release" >"$ingress_root/public-result.json"
    printf 'DRY RUN public continuity: %s %s %s %s %s %s %s %s %s %s\n' "$rpc" "$evm" "$rest" "$indexer" "$explorer" "$faucet" "$ai" "$pay" "$trust" "$resource" >"$evidence/endpoints.txt"
    chmod 0600 "$ingress_root/public-result.json" "$evidence/endpoints.txt"
    echo "production BFT public continuity dry-run passed: transaction=$candidate_transaction_id"
    return
  fi
  curl -fsS "$rpc/health" >"$evidence/gateway-before-health.json"
  sleep "$observation"
  curl -fsS "$rpc/health" >"$evidence/gateway-after-health.json"
  curl -fsS "$rpc/status" >"$evidence/gateway-status.json"
  curl -fsS -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' "$evm" >"$evidence/evm-chain-id.json"
  curl -fsS "$indexer/health" >"$evidence/indexer-health.json"
  curl -fsS "$explorer/health" >"$evidence/explorer-health.json"
  curl -fsS "$faucet/health" >"$evidence/faucet-health.json"
  curl -fsS "$ai/health" >"$evidence/ai-health.json"
  curl -fsS "$pay/health" >"$evidence/pay-health.json"
  curl -fsS "$trust/health" >"$evidence/trust-health.json"
  curl -fsS "$resource/health" >"$evidence/resource-health.json"
  local mutation_code
  mutation_code="$(curl -sS -o /dev/null -w '%{http_code}' -H 'content-type: application/json' -d '{}' "$rest/__ynx_mutation_freeze_probe__")"
  printf '{"httpStatus":%s}\n' "$mutation_code" >"$evidence/mutation-freeze.json"
  node scripts/verify/validate-public-bft-public-continuity.mjs "$evidence" "$commit" "$candidate_bft_release" "$dependency_migration_height" "$dependency_migration_hash" "$max_lag" "$ingress_root/public-result.json"
  node -e 'const fs=require("fs"),[beforePath,publicPath]=process.argv.slice(1),before=JSON.parse(fs.readFileSync(beforePath)),current=JSON.parse(fs.readFileSync(publicPath)); for(const name of ["faucet","ai","pay","trust","resource"]) if(before.services?.[name]?.signerAddress!==current.services?.[name]) { console.error(`public signer binding changed for ${name}`); process.exit(1); }' \
    "$dependency_root/continuity-result.json" "$ingress_root/public-result.json"
  echo "production BFT public continuity passed: transaction=$candidate_transaction_id evidence=$ingress_root"
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
    if [[ "$kind" == "full" ]]; then
      mutation_urls+=",http://127.0.0.1:6428,http://127.0.0.1:6429,http://127.0.0.1:6430,http://127.0.0.1:6431,http://127.0.0.1:6432"
    fi
    ynx_ops_copy "$role" "$user" "$host" "$key" scripts/ops/remote/public-bft-mutation-freeze.sh "$remote_helper"
    ynx_ops_ssh "$role" "$user" "$host" "$key" "set -euo pipefail; trap 'rm -f \"$remote_helper\"' EXIT; chmod 0700 '$remote_helper'; sudo bash '$remote_helper' '$operation' '$transaction_id' '$role' '$commit' '$release' '$bft_release' /var/lib/ynx-chain/mutation-freeze.json '$remote_root' http://127.0.0.1:6420 '$mutation_urls' /" >"$evidence_dir/${role}-${operation}.txt"
  }
  ynx_ops_each_node mutate_role
  echo "production BFT mutation $operation passed: transaction=$transaction_id evidence=$evidence_dir"
}

recovery_phase() {
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
    services="$(ynx_ops_services_for_kind "$kind")"
    mutation_urls="http://127.0.0.1:6420"
    if [[ "$kind" == "full" ]]; then
      mutation_urls+=",http://127.0.0.1:6428,http://127.0.0.1:6429,http://127.0.0.1:6430,http://127.0.0.1:6431,http://127.0.0.1:6432"
    fi
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

if [[ "$action" == "backup" || "$action" == "freeze_mutations" || "$action" == "unfreeze_mutations" || "$action" == "pause_authoritative" || "$action" == "resume_authoritative" || "$action" == "export_final_snapshot" || "$action" == "deploy_candidate" || "$action" == "verify_candidate" || "$action" == "rollback_candidate" || "$action" == "start_dependencies" || "$action" == "verify_continuity" || "$action" == "rollback_dependencies" || "$action" == "switch_ingress" || "$action" == "verify_public" || "$action" == "rollback_ingress" || "$action" == "verify_recovery" ]]; then
  [[ -z "$(git status --short)" ]] || { echo "production mutation phase requires a clean worktree" >&2; exit 1; }
  case "$action" in
    backup) backup_phase ;;
    freeze_mutations) mutation_freeze_phase freeze ;;
    unfreeze_mutations) mutation_freeze_phase unfreeze ;;
    pause_authoritative) authoritative_production_phase pause ;;
    resume_authoritative) authoritative_production_phase resume ;;
    export_final_snapshot) final_snapshot_phase ;;
    deploy_candidate) deploy_candidate_phase ;;
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

for target in ynx-abci ynx-bft-gatewayd ynx-consensus-keycheck; do
  package="./cmd/$target"
  GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -o "$root/prebuilt/$target" "$package"
done
GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -o "$root/prebuilt/cometbft" github.com/cometbft/cometbft/cmd/cometbft
shasum -a 256 "$root"/prebuilt/* >"$root/prebuilt.sha256"

collect_role() {
  local role="$1" user="$2" host="$3" key="$4" kind="$5"
  local role_dir="$root/roles/$role" validator services candidate_port_pattern
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
  ynx_ops_ssh "$role" "$user" "$host" "$key" "curl -fsS http://127.0.0.1:6420/status" >"$role_dir/status.json"
  ynx_ops_ssh "$role" "$user" "$host" "$key" "set -eu; manifest=/opt/ynx-chain/releases/$release/config/release-manifest.json; for service in $services; do systemctl is-active \"\$service\" >/dev/null; done; systemctl is-active ynx-consensus-overlay.service >/dev/null; ip link show ynxwg0 >/dev/null; test \"\$(sudo stat -c %a /etc/ynx/consensus-candidate)\" = 750; test \"\$(sudo stat -c %a /etc/ynx/consensus-candidate/$role/priv_validator_key.json)\" = 600; test \"\$(sudo stat -c %a /etc/ynx/consensus-candidate/$role/priv_validator_state.json)\" = 600; test \"\$(sudo stat -c %a /etc/ynx/consensus-candidate/$role/node_key.json)\" = 600; sudo test ! -e /var/lib/ynx-chain/consensus-candidate; ! systemctl is-active --quiet ynx-consensus-comet-candidate.service; ! systemctl is-active --quiet ynx-consensus-abci-candidate.service; ! ss -ltn | awk '{print \$4}' | grep -Eq '$candidate_port_pattern'; sudo test ! -e /var/lib/ynx-chain/mutation-freeze.json; sudo test -d '${BACKUP_STORAGE_PATH:-/var/backups/ynx-chain}'; test \"\$(df -Pk /var/lib/ynx-chain | awk 'NR==2 {print \$4}')\" -gt 2097152; test -f \"\$manifest\"; printf 'role=%s\\nvalidator=%s\\nrelease=%s\\nservices=active\\noverlay=active\\nkeys=restricted\\ncandidate=absent\\nfreeze=absent\\nports=free\\ndisk=ready\\nbackup=present\\nmanifest_sha256=' '$role' '$validator' '$release'; sha256sum \"\$manifest\" | awk '{print \$1}'" >"$role_dir/preflight.txt"
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
