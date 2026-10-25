#!/usr/bin/env bash
set -euo pipefail

consensus_candidate_verify() {
  package_root="${CONSENSUS_CANDIDATE_PACKAGE:-}"
  [[ -n "$package_root" && -d "$package_root" ]] || { echo "CONSENSUS_CANDIDATE_PACKAGE must reference a generated candidate package" >&2; return 1; }
  runtime_bundle="${CONSENSUS_CANDIDATE_RUNTIME_BUNDLE:-}"
  runtime_commit="${CONSENSUS_CANDIDATE_RUNTIME_COMMIT:-}"
  runtime_manifest_sha="${CONSENSUS_CANDIDATE_RUNTIME_MANIFEST_SHA256:-}"
  validate_runtime_bundle "$runtime_bundle" "$runtime_commit" "$runtime_manifest_sha" || return $?
  [[ "$(git rev-parse HEAD)" == "$runtime_commit" ]] || { echo "candidate verifier source differs from independently pinned runtime commit" >&2; return 1; }

  evidence_root="${CONSENSUS_CANDIDATE_EVIDENCE_DIR:-tmp/consensus-candidate-evidence}"
  local evidence_parent evidence_leaf canonical_package
  evidence_parent="$(cd "$(dirname -- "$evidence_root")" && pwd -P)" || { echo "candidate evidence parent must already exist" >&2; return 1; }
  evidence_leaf="$(basename -- "$evidence_root")"
  [[ "$evidence_leaf" != . && "$evidence_leaf" != .. ]] || { echo "candidate evidence requires a new directory" >&2; return 1; }
  evidence_root="${evidence_parent%/}/$evidence_leaf"
  canonical_package="$(cd "$package_root" && pwd -P)" || return $?
  if [[ "$evidence_root" == "$runtime_bundle" || "$evidence_root" == "$runtime_bundle/"* || "$evidence_root" == "$canonical_package" || "$evidence_root" == "$canonical_package/"* ]]; then
    echo "candidate evidence must be outside the original runtime and package" >&2
    return 1
  fi
  umask 077
  if ! mkdir -m 0700 "$evidence_root"; then
    echo "candidate evidence already exists or cannot be reserved; retain and reconcile the original evidence and UNKNOWN result" >&2
    return 1
  fi
  evidence_root="$(cd "$evidence_root" && pwd -P)"
  # Keep exact downloaded bytes, including 0644 artifacts. Revalidate a new
  # exclusive retained copy before setting only its executable bits. A failure
  # leaves the evidence root and any partial copy untouched for reconciliation.
  prepare_runtime_bundle "$runtime_bundle" "$runtime_commit" "$runtime_manifest_sha" "$evidence_root/runtime" || return $?
  verify_candidate_package "$evidence_root/runtime/ynx-consensus-package" "$package_root" || return $?

  # No environment initialization or remote operation occurs until both the
  # independent runtime pins and the actual public package have been verified.
  ynx_ops_init
  set -o noclobber
  collect_status() {
    local role="$1" user="$2" host="$3" key="$4" _kind="$5"
    mkdir -m 0700 "$evidence_root/$role"
    if [[ "${DEPLOY_DRY_RUN:-0}" == "1" ]]; then
      ynx_ops_ssh "$role" "$user" "$host" "$key" "curl -fsS http://127.0.0.1:27757/status"
    else
      ynx_ops_ssh "$role" "$user" "$host" "$key" "curl -fsS http://127.0.0.1:27757/status" >"$evidence_root/$role/status.json"
    fi
  }
  ynx_ops_each_node collect_status

  if [[ "${DEPLOY_DRY_RUN:-0}" == "1" ]]; then
    echo "candidate evidence dry-run completed; no remote or public proof was generated"
    return 0
  fi

  height="$(node -e 'const fs=require("fs"),p=process.argv[1],roles=["primary","singapore","silicon-valley","seoul"]; const hs=roles.map(r=>Number(JSON.parse(fs.readFileSync(`${p}/${r}/status.json`)).result.sync_info.latest_block_height)); if(hs.some(h=>!Number.isSafeInteger(h)||h<=1)) process.exit(1); process.stdout.write(String(Math.min(...hs)-1));' "$evidence_root")"

  collect_common_evidence() {
    local role="$1" user="$2" host="$3" key="$4" _kind="$5"
    ynx_ops_ssh "$role" "$user" "$host" "$key" "curl -fsS 'http://127.0.0.1:27757/validators?height=$height'" >"$evidence_root/$role/validators.json"
    ynx_ops_ssh "$role" "$user" "$host" "$key" "curl -fsS http://127.0.0.1:27757/net_info" >"$evidence_root/$role/net_info.json"
    ynx_ops_ssh "$role" "$user" "$host" "$key" "curl -fsS 'http://127.0.0.1:27757/block?height=$height'" >"$evidence_root/$role/block.json"
  }
  ynx_ops_each_node collect_common_evidence

  output="$evidence_root/consensus-candidate-evidence.json"
  node scripts/verify/consensus-candidate-evidence.mjs "$package_root" "$evidence_root" "$output"
  echo "candidate evidence written to $output; public cutover remains unauthorized"
}

# Regression callers may source the real collection flow and replace only the
# external transport. Sourcing never initializes deployment or gathers data.
if [[ "${BASH_SOURCE[0]}" != "$0" ]]; then
  return 0
fi

cd "$(dirname "$0")/../.."
# shellcheck source=../deploy/deploy-consensus-candidate.sh
source scripts/deploy/deploy-consensus-candidate.sh
# shellcheck source=../ops/lib.sh
source scripts/ops/lib.sh
consensus_candidate_verify
