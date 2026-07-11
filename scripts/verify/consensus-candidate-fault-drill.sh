#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."
# shellcheck source=../ops/lib.sh
source scripts/ops/lib.sh
ynx_ops_init

fault_role="${CONSENSUS_CANDIDATE_FAULT_ROLE:-seoul}"
case "$fault_role" in primary|singapore|silicon-valley|seoul) ;; *) echo "invalid CONSENSUS_CANDIDATE_FAULT_ROLE" >&2; exit 1 ;; esac

if [[ "${DEPLOY_DRY_RUN:-0}" != "1" && "${CONSENSUS_CANDIDATE_FAULT_DRILL_APPROVED:-}" != "yes" ]]; then
  echo "CONSENSUS_CANDIDATE_FAULT_DRILL_APPROVED=yes is required" >&2
  exit 1
fi

tmp="$(mktemp -d)"
fault_stopped=0
cleanup() {
  if [[ "$fault_stopped" == "1" ]]; then
    restart_fault_role || true
  fi
  rm -rf "$tmp"
}
trap cleanup EXIT

collect_heights() {
  local phase="$1"
  collect_height_role() {
    local role="$1" user="$2" host="$3" key="$4" _kind="$5"
    [[ "$role" == "$fault_role" ]] && return 0
    if [[ "${DEPLOY_DRY_RUN:-0}" == "1" ]]; then
      ynx_ops_ssh "$role" "$user" "$host" "$key" "curl -fsS http://127.0.0.1:27757/status"
    else
      ynx_ops_ssh "$role" "$user" "$host" "$key" "curl -fsS http://127.0.0.1:27757/status" >"$tmp/${phase}-${role}.json"
    fi
  }
  ynx_ops_each_node collect_height_role
}

stop_fault_role() {
  stop_fault_callback() {
    local role="$1" user="$2" host="$3" key="$4" _kind="$5"
    [[ "$role" == "$fault_role" ]] || return 0
    ynx_ops_ssh "$role" "$user" "$host" "$key" "sudo systemctl stop ynx-consensus-comet-candidate.service ynx-consensus-abci-candidate.service; systemctl is-active ynx-chaind >/dev/null"
  }
  ynx_ops_each_node stop_fault_callback
}

restart_fault_role() {
  restart_fault_callback() {
    local role="$1" user="$2" host="$3" key="$4" _kind="$5"
    [[ "$role" == "$fault_role" ]] || return 0
    ynx_ops_ssh "$role" "$user" "$host" "$key" "sudo systemctl start ynx-consensus-abci-candidate.service ynx-consensus-comet-candidate.service; systemctl is-active ynx-chaind >/dev/null"
  }
  ynx_ops_each_node restart_fault_callback
}

collect_heights before
stop_fault_role
fault_stopped=1

if [[ "${DEPLOY_DRY_RUN:-0}" == "1" ]]; then
  collect_heights after
  restart_fault_role
  fault_stopped=0
  echo "candidate fault drill dry-run completed; no validator was stopped"
  exit 0
fi

sleep "${CONSENSUS_CANDIDATE_FAULT_WAIT_SECONDS:-8}"
collect_heights after
node - "$tmp" "$fault_role" <<'NODE'
const fs = require("fs");
const [root, faultRole] = process.argv.slice(2);
const roles = ["primary", "singapore", "silicon-valley", "seoul"].filter((role) => role !== faultRole);
for (const role of roles) {
  const height = (phase) => Number(JSON.parse(fs.readFileSync(`${root}/${phase}-${role}.json`)).result.sync_info.latest_block_height);
  const before = height("before");
  const after = height("after");
  if (!Number.isSafeInteger(before) || !Number.isSafeInteger(after) || after <= before) {
    throw new Error(`${role} did not advance while ${faultRole} was stopped: before=${before} after=${after}`);
  }
}
NODE

restart_fault_role
fault_stopped=0

target_height="$(node - "$tmp" "$fault_role" <<'NODE'
const fs = require("fs");
const [root, faultRole] = process.argv.slice(2);
const roles = ["primary", "singapore", "silicon-valley", "seoul"].filter((role) => role !== faultRole);
process.stdout.write(String(Math.min(...roles.map((role) => Number(JSON.parse(fs.readFileSync(`${root}/after-${role}.json`)).result.sync_info.latest_block_height)))));
NODE
)"

caught_up=0
for _attempt in $(seq 1 "${CONSENSUS_CANDIDATE_CATCHUP_ATTEMPTS:-30}"); do
  poll_fault_callback() {
    local role="$1" user="$2" host="$3" key="$4" _kind="$5"
    [[ "$role" == "$fault_role" ]] || return 0
    ynx_ops_ssh "$role" "$user" "$host" "$key" "curl -fsS http://127.0.0.1:27757/status" >"$tmp/recovered.json"
  }
  ynx_ops_each_node poll_fault_callback
  recovered_height="$(node -e 'process.stdout.write(String(Number(JSON.parse(require("fs").readFileSync(process.argv[1])).result.sync_info.latest_block_height)))' "$tmp/recovered.json")"
  if [[ "$recovered_height" =~ ^[0-9]+$ && "$recovered_height" -ge "$target_height" ]]; then
    caught_up=1
    break
  fi
  sleep 2
done
[[ "$caught_up" == "1" ]] || { echo "$fault_role did not catch up to height $target_height" >&2; exit 1; }

CONSENSUS_CANDIDATE_EVIDENCE_DIR="${CONSENSUS_CANDIDATE_EVIDENCE_DIR:-tmp/consensus-candidate-fault-evidence}" \
  bash scripts/verify/verify-consensus-candidate.sh
echo "candidate fault drill passed: stopped=$fault_role remaining_quorum_advanced=true recoveredHeight=$recovered_height targetHeight=$target_height; public cutover remains unauthorized"
