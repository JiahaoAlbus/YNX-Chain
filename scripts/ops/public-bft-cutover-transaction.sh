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
  deploy_candidate
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
  printf '%s\n' 'rollback order: rollback_ingress rollback_dependencies rollback_candidate resume_authoritative unfreeze_mutations verify_rollback'
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
[[ ! -e "$transaction_dir" ]] || { echo "cutover transaction evidence directory already exists: $transaction_dir" >&2; exit 1; }
mkdir -p "$transaction_dir"
approval_evidence="$(node scripts/verify/validate-public-bft-cutover-approval.mjs "$PUBLIC_BFT_CUTOVER_APPROVAL_FILE" "$commit" "$release" "$PUBLIC_BFT_CUSTODY_REVIEW_FILE")"
printf '%s\n' "$approval_evidence" >"${transaction_dir}/approval.json"

export PUBLIC_BFT_CUTOVER_COMMIT="$commit"
export PUBLIC_BFT_CUTOVER_RELEASE="$release"
export PUBLIC_BFT_CUTOVER_TRANSACTION_DIR="$transaction_dir"

mutation_started=0
transaction_complete=0

journal_event() {
  local phase="$1" status="$2"
  printf '{"phase":"%s","status":"%s","at":"%s"}\n' "$phase" "$status" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >>"$journal"
}

run_phase() {
  local phase="$1"
  journal_event "$phase" started
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
  journal_event rollback started
  local rollback_failed=0

  # Every rollback command must be idempotent. A phase can mutate state and then
  # fail before returning, so completion flags cannot safely select cleanup.
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
run_phase deploy_candidate
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
