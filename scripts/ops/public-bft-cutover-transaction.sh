#!/usr/bin/env bash
set -Eeuo pipefail

cd "$(dirname "$0")/../.."

mode="${PUBLIC_BFT_CUTOVER_MODE:-plan}"
case "$mode" in
  plan|execute) ;;
  *) echo "PUBLIC_BFT_CUTOVER_MODE must be plan or execute" >&2; exit 1 ;;
esac

commit="$(git rev-parse --short=12 HEAD)"
release="ynx-bft-gateway-${commit}"
driver="${PUBLIC_BFT_CUTOVER_DRIVER:-}"
evidence_root="${PUBLIC_BFT_CUTOVER_EVIDENCE_DIR:-tmp/public-bft-cutover}"
transaction_id="${PUBLIC_BFT_CUTOVER_TRANSACTION_ID:-cutover-${commit}-$(date -u +%Y%m%dT%H%M%SZ)}"
transaction_dir="${evidence_root}/${transaction_id}"
journal="${transaction_dir}/journal.jsonl"
[[ "$transaction_id" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$ ]] || { echo "PUBLIC_BFT_CUTOVER_TRANSACTION_ID is invalid" >&2; exit 1; }

forward_phases=(
  preflight
  backup
  freeze_mutations
  pause_authoritative
  export_final_snapshot
  initialize_candidate
  deploy_candidate
  start_candidate
  verify_candidate
  start_dependencies
  verify_continuity
  switch_ingress
  verify_public
  unfreeze_mutations
)

if [[ "$mode" == "plan" ]]; then
  printf 'public BFT cutover plan: commit=%s release=%s\n' "$commit" "$release"
  printf 'forward phase: %s\n' "${forward_phases[@]}"
  printf '%s\n' 'before-initialization rollback order: rollback_ingress rollback_dependencies rollback_candidate resume_authoritative unfreeze_mutations verify_rollback'
  printf '%s\n' 'after any candidate initialization attempt: preserve staging/partial/UNKNOWN; reconcile original writer/freeze/pause/backup evidence before any old-chain resume; no automatic cleanup or retry'
  printf '%s\n' 'after any candidate start attempt: preserve UNKNOWN and original evidence/state/HRS; no automatic rollback, resume, unfreeze, or retry'
  printf '%s\n' 'fresh native import only: existing application state must use its normal operator resume/upgrade path, never this initialization transaction'
  printf '%s\n' 'plan only: no service, state, mutation route, or public ingress was changed'
  exit 0
fi

[[ "${PUBLIC_BFT_CUTOVER_APPROVED:-}" == "yes" ]] || { echo "PUBLIC_BFT_CUTOVER_APPROVED=yes is required" >&2; exit 1; }
[[ -n "$driver" && -x "$driver" ]] || { echo "PUBLIC_BFT_CUTOVER_DRIVER must be an executable file" >&2; exit 1; }
[[ -n "${PUBLIC_BFT_CUTOVER_APPROVAL_FILE:-}" ]] || { echo "PUBLIC_BFT_CUTOVER_APPROVAL_FILE is required" >&2; exit 1; }
[[ -n "${PUBLIC_BFT_CUSTODY_REVIEW_FILE:-}" ]] || { echo "PUBLIC_BFT_CUSTODY_REVIEW_FILE is required" >&2; exit 1; }

[[ "$(git branch --show-current)" == "main" ]] || { echo "public BFT cutover requires main branch" >&2; exit 1; }
[[ -z "$(git status --short)" ]] || { echo "public BFT cutover requires a clean worktree" >&2; exit 1; }

umask 077
[[ ! -e "$transaction_dir" && ! -L "$transaction_dir" ]] || { echo "cutover transaction evidence directory already exists: $transaction_dir" >&2; exit 1; }
mkdir -p -- "$evidence_root"
# Creation, not a prior existence check, decides ownership of this attempt.
mkdir -- "$transaction_dir"
approval_evidence="$(node scripts/verify/validate-public-bft-cutover-approval.mjs "$PUBLIC_BFT_CUTOVER_APPROVAL_FILE" "$commit" "$release" "$PUBLIC_BFT_CUSTODY_REVIEW_FILE")"
printf '%s\n' "$approval_evidence" >"${transaction_dir}/approval.json"

export PUBLIC_BFT_CUTOVER_COMMIT="$commit"
export PUBLIC_BFT_CUTOVER_RELEASE="$release"
export PUBLIC_BFT_CUTOVER_TRANSACTION_DIR="$transaction_dir"

mutation_started=0
candidate_initialization_dispatched=0
candidate_start_dispatched=0
transaction_complete=0

journal_event() {
  local phase="$1" status="$2"
  printf '{"phase":"%s","status":"%s","at":"%s"}\n' "$phase" "$status" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >>"$journal"
}

run_phase() {
  local phase="$1"
  journal_event "$phase" started
  if [[ "$phase" == "initialize_candidate" ]]; then
    candidate_initialization_dispatched=1
  fi
  if [[ "$phase" == "start_candidate" ]]; then
    # Once handed to the driver, a failed/missing reply cannot prove that no
    # validator started. Its exclusive candidate/start-attempt stays intact.
    candidate_start_dispatched=1
  fi
  "$driver" "$phase"
  journal_event "$phase" passed
}

rollback_transaction() {
  local original_status="$?"
  trap - EXIT INT TERM
  if [[ "$transaction_complete" == "1" || "$mutation_started" != "1" ]]; then
    exit "$original_status"
  fi
  set +e
  if [[ "$candidate_start_dispatched" == "1" || -e "$transaction_dir/candidate/start-attempt" || -L "$transaction_dir/candidate/start-attempt" ]]; then
    journal_event transaction unknown
    echo "PUBLIC_BFT_CUTOVER_START_OUTCOME_UNKNOWN: status=$original_status; preserve $transaction_dir and original state/HRS; reconcile without automatic rollback, resume, unfreeze, or retry" >&2
    # An incomplete transaction must never become success because a caller
    # exited without an error after dispatching a potentially effective start.
    [[ "$original_status" != "0" ]] || original_status=1
    exit "$original_status"
  fi
  if [[ "$candidate_initialization_dispatched" == "1" || -e "$transaction_dir/candidate/initialize-attempt" || -L "$transaction_dir/candidate/initialize-attempt" ]]; then
    journal_event transaction unknown
    echo "PUBLIC_BFT_CUTOVER_INITIALIZATION_OUTCOME_UNKNOWN: status=$original_status; preserve $transaction_dir and original staging/state/HRS; reconcile writer/freeze/pause/backup evidence before old-chain resume; no automatic cleanup or retry; this is not evidence of consensus start" >&2
    # No consensus start is implied. A missing reply also cannot establish that
    # a remote initialization writer stopped, or authorize old-chain resumption.
    [[ "$original_status" != "0" ]] || original_status=1
    exit "$original_status"
  fi
  journal_event rollback started
  local rollback_failed=0

  # Only failures before any candidate initialization may use the old rollback.
  # Those phases can mutate then fail, so completion flags cannot select cleanup.
  "$driver" rollback_ingress || rollback_failed=1
  "$driver" rollback_dependencies || rollback_failed=1
  "$driver" rollback_candidate || rollback_failed=1
  "$driver" resume_authoritative || rollback_failed=1
  "$driver" unfreeze_mutations || rollback_failed=1
  "$driver" verify_rollback || rollback_failed=1
  if [[ "$rollback_failed" == "0" ]]; then
    journal_event rollback passed
  else
    journal_event rollback failed
    echo "automatic rollback failed; inspect $journal immediately" >&2
  fi
  exit "$original_status"
}
trap rollback_transaction EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

run_phase preflight
run_phase backup
mutation_started=1
run_phase freeze_mutations
run_phase pause_authoritative
run_phase export_final_snapshot
run_phase initialize_candidate
run_phase deploy_candidate
run_phase start_candidate
run_phase verify_candidate
run_phase start_dependencies
run_phase verify_continuity
run_phase switch_ingress
run_phase verify_public
run_phase unfreeze_mutations
journal_event transaction passed
transaction_complete=1
trap - EXIT INT TERM
printf 'public BFT cutover transaction passed: id=%s evidence=%s\n' "$transaction_id" "$transaction_dir"
