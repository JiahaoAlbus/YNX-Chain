#!/usr/bin/env bash
set -Eeuo pipefail

cd "$(dirname "$0")/../.."
# shellcheck source=lib.sh
source scripts/ops/lib.sh
ynx_ops_init

action="${1:-rehearse}"
[[ "$action" == "rehearse" || "$action" == "preflight" || "$action" == "backup" || "$action" == "freeze_mutations" || "$action" == "unfreeze_mutations" || "$action" == "verify_recovery" ]] || {
  echo "production driver phase $action is not implemented; public cutover remains blocked" >&2
  exit 64
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

if [[ "$action" == "backup" || "$action" == "freeze_mutations" || "$action" == "unfreeze_mutations" || "$action" == "verify_recovery" ]]; then
  [[ -z "$(git status --short)" ]] || { echo "production mutation phase requires a clean worktree" >&2; exit 1; }
  case "$action" in
    backup) backup_phase ;;
    freeze_mutations) mutation_freeze_phase freeze ;;
    unfreeze_mutations) mutation_freeze_phase unfreeze ;;
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
  local role_dir="$root/roles/$role" validator services
  mkdir -p "$role_dir"
  case "$role" in
    primary) validator=ynx_validator_primary ;;
    singapore) validator=ynx_validator_singapore ;;
    silicon-valley) validator=ynx_validator_silicon_valley ;;
    seoul) validator=ynx_validator_seoul ;;
  esac
  services="$(ynx_ops_services_for_kind "$kind")"
  ynx_ops_ssh "$role" "$user" "$host" "$key" "curl -fsS http://127.0.0.1:6420/status" >"$role_dir/status.json"
  ynx_ops_ssh "$role" "$user" "$host" "$key" "set -eu; manifest=/opt/ynx-chain/releases/$release/config/release-manifest.json; for service in $services; do systemctl is-active \"\$service\" >/dev/null; done; systemctl is-active ynx-consensus-overlay.service >/dev/null; ip link show ynxwg0 >/dev/null; test \"\$(sudo stat -c %a /etc/ynx/consensus-candidate)\" = 750; test \"\$(sudo stat -c %a /etc/ynx/consensus-candidate/$role/priv_validator_key.json)\" = 600; test \"\$(sudo stat -c %a /etc/ynx/consensus-candidate/$role/priv_validator_state.json)\" = 600; test \"\$(sudo stat -c %a /etc/ynx/consensus-candidate/$role/node_key.json)\" = 600; sudo test ! -e /var/lib/ynx-chain/consensus-candidate; ! systemctl is-active --quiet ynx-consensus-comet-candidate.service; ! systemctl is-active --quiet ynx-consensus-abci-candidate.service; ! ss -ltn | awk '{print \$4}' | grep -Eq ':(27656|27757|27858)$'; sudo test ! -e /var/lib/ynx-chain/mutation-freeze.json; sudo test -d '${BACKUP_STORAGE_PATH:-/var/backups/ynx-chain}'; test \"\$(df -Pk /var/lib/ynx-chain | awk 'NR==2 {print \$4}')\" -gt 2097152; test -f \"\$manifest\"; printf 'role=%s\\nvalidator=%s\\nrelease=%s\\nservices=active\\noverlay=active\\nkeys=restricted\\ncandidate=absent\\nfreeze=absent\\nports=free\\ndisk=ready\\nbackup=present\\nmanifest_sha256=' '$role' '$validator' '$release'; sha256sum \"\$manifest\" | awk '{print \$1}'" >"$role_dir/preflight.txt"
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
