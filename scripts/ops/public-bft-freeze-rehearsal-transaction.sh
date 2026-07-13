#!/usr/bin/env bash
set -Eeuo pipefail

cd "$(dirname "$0")/../.."

mode="${PUBLIC_BFT_FREEZE_REHEARSAL_MODE:-plan}"
case "$mode" in
  plan|execute) ;;
  *) echo "PUBLIC_BFT_FREEZE_REHEARSAL_MODE must be plan or execute" >&2; exit 1 ;;
esac

commit="$(git rev-parse --short=12 HEAD)"
release="ynx-bft-gateway-${commit}"
driver="${PUBLIC_BFT_FREEZE_REHEARSAL_DRIVER:-scripts/ops/public-bft-production-driver.sh}"
evidence_root="${PUBLIC_BFT_FREEZE_REHEARSAL_EVIDENCE_DIR:-tmp/public-bft-freeze-rehearsal}"
transaction_id="${PUBLIC_BFT_FREEZE_REHEARSAL_TRANSACTION_ID:-freeze-rehearsal-${commit}-$(date -u +%Y%m%dT%H%M%SZ)}"
transaction_dir="${evidence_root}/${transaction_id}"
journal="${transaction_dir}/journal.jsonl"
[[ "$transaction_id" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$ ]] || { echo "PUBLIC_BFT_FREEZE_REHEARSAL_TRANSACTION_ID is invalid" >&2; exit 1; }

phases=(preflight backup freeze_mutations unfreeze_mutations verify_recovery)
if [[ "$mode" == "plan" ]]; then
  printf 'public BFT freeze rehearsal plan: commit=%s release=%s\n' "$commit" "$release"
  printf 'bounded phase: %s\n' "${phases[@]}"
  printf '%s\n' 'prohibited: authoritative pause, candidate deployment, dependency transition, public ingress change, and public cutover'
  printf '%s\n' 'plan only: no remote backup, mutation freeze, service state, or public ingress was changed'
  exit 0
fi

[[ "${PUBLIC_BFT_FREEZE_REHEARSAL_APPROVED:-}" == "yes" ]] || { echo "PUBLIC_BFT_FREEZE_REHEARSAL_APPROVED=yes is required" >&2; exit 1; }
[[ -x "$driver" ]] || { echo "PUBLIC_BFT_FREEZE_REHEARSAL_DRIVER must be executable" >&2; exit 1; }
[[ -n "${PUBLIC_BFT_FREEZE_REHEARSAL_APPROVAL_FILE:-}" ]] || { echo "PUBLIC_BFT_FREEZE_REHEARSAL_APPROVAL_FILE is required" >&2; exit 1; }
[[ -n "${PUBLIC_BFT_CUSTODY_REVIEW_FILE:-}" ]] || { echo "PUBLIC_BFT_CUSTODY_REVIEW_FILE is required" >&2; exit 1; }
[[ "$(git branch --show-current)" == "main" ]] || { echo "public BFT freeze rehearsal requires main branch" >&2; exit 1; }
[[ -z "$(git status --short)" ]] || { echo "public BFT freeze rehearsal requires a clean worktree" >&2; exit 1; }

umask 077
[[ ! -e "$transaction_dir" ]] || { echo "freeze rehearsal evidence already exists: $transaction_dir" >&2; exit 1; }
mkdir -p "$transaction_dir"
approval_evidence="$(node scripts/verify/validate-public-bft-freeze-rehearsal-approval.mjs \
  "$PUBLIC_BFT_FREEZE_REHEARSAL_APPROVAL_FILE" "$commit" "$release" "$transaction_id" "$PUBLIC_BFT_CUSTODY_REVIEW_FILE")"
printf '%s\n' "$approval_evidence" >"$transaction_dir/approval.json"
max_freeze_seconds="$(node -e 'const a=JSON.parse(process.argv[1]); process.stdout.write(String(a.maxFreezeSeconds));' "$approval_evidence")"

export PUBLIC_BFT_CUTOVER_COMMIT="$commit"
export PUBLIC_BFT_CUTOVER_RELEASE="$release"
export PUBLIC_BFT_CUTOVER_TRANSACTION_DIR="$transaction_dir"
export PUBLIC_BFT_PRODUCTION_BACKUP_APPROVED=yes
export PUBLIC_BFT_PRODUCTION_FREEZE_APPROVED=yes

freeze_started=0
freeze_started_epoch=0
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

run_timed_driver() {
  local seconds="$1" phase="$2"
  (( seconds >= 1 )) || return 124
  perl -e '$seconds = shift @ARGV; $SIG{ALRM} = sub { exit 124 }; alarm $seconds; exec @ARGV' \
    "$seconds" "$driver" "$phase"
}

rollback_rehearsal() {
  local original_status="$?"
  trap - EXIT INT TERM
  if [[ "$transaction_complete" == "1" || "$freeze_started" != "1" ]]; then
    exit "$original_status"
  fi
  set +e
  journal_event automatic_unfreeze started
  local rollback_failed=0
  run_timed_driver "$max_freeze_seconds" unfreeze_mutations || rollback_failed=1
  "$driver" verify_recovery || rollback_failed=1
  if [[ "$rollback_failed" == "0" ]]; then
    journal_event automatic_unfreeze passed
  else
    journal_event automatic_unfreeze failed
    echo "automatic unfreeze/recovery failed; inspect $journal immediately" >&2
  fi
  exit "$original_status"
}
trap rollback_rehearsal EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

run_phase preflight
run_phase backup
freeze_started=1
freeze_started_epoch="$(date +%s)"
journal_event freeze_mutations started
run_timed_driver "$max_freeze_seconds" freeze_mutations
journal_event freeze_mutations passed
remaining_seconds=$((freeze_started_epoch + max_freeze_seconds - $(date +%s)))
journal_event unfreeze_mutations started
run_timed_driver "$remaining_seconds" unfreeze_mutations
journal_event unfreeze_mutations passed
freeze_duration_seconds=$(($(date +%s) - freeze_started_epoch))
printf '{"phase":"freeze_window","status":"passed","durationSeconds":%s,"maximumSeconds":%s,"at":"%s"}\n' \
  "$freeze_duration_seconds" "$max_freeze_seconds" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >>"$journal"
run_phase verify_recovery
journal_event transaction passed
transaction_complete=1
trap - EXIT INT TERM
printf 'public BFT freeze rehearsal passed: id=%s evidence=%s\n' "$transaction_id" "$transaction_dir"
