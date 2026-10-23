#!/usr/bin/env bash
set -Eeuo pipefail

cd "$(dirname "$0")/../.."

mode="${PUBLIC_BFT_CUTOVER_MODE:-plan}"
case "$mode" in
  plan|execute|prepare-native|continue-native) ;;
  *) echo "PUBLIC_BFT_CUTOVER_MODE must be plan, execute, prepare-native or continue-native" >&2; exit 1 ;;
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
if [[ "$mode" == continue-native ]]; then
  # No preflight/backup/freeze/pause is replayed. The exact completed original
  # preparation, not a newly constructed checkpoint or successful exit alone,
  # selects this one continuation. Any uncertain attempt remains exclusive.
  node --input-type=module - "$transaction_dir" <<'NODE'
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
const root=path.resolve(process.argv[2]),info=fs.lstatSync(root);
assert.ok(info.isDirectory()&&!info.isSymbolicLink()&&(info.mode&0o7777)===0o700&&fs.realpathSync(root)===root,'original private canonical transaction required');
const forbidden=['approval.json','continuation-attempt','candidate/initialize-attempt','candidate/start-attempt'];
for(const name of forbidden)assert.equal(fs.existsSync(path.join(root,name))||(()=>{try{fs.lstatSync(path.join(root,name));return true}catch(e){if(e.code==='ENOENT')return false;throw e}})(),false,'existing continuation/initialization/UNKNOWN must be retained');
function scan(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){assert.ok(!entry.isSymbolicLink(),'unexpected original evidence symlink');assert.ok(!/UNKNOWN|\.partial|\.tmp(?:$|[-.])/.test(entry.name),'retained partial/UNKNOWN blocks continuation');if(entry.isDirectory())scan(path.join(dir,entry.name));}}
scan(root);
const rows=fs.readFileSync(path.join(root,'journal.jsonl'),'utf8').trimEnd().split('\n').map(JSON.parse);
const expected=['preflight','backup','freeze_mutations','pause_authoritative'].flatMap(phase=>[[phase,'started'],[phase,'passed']]);expected.push(['preparation','awaiting_final_snapshot_authorization']);
assert.equal(rows.length,expected.length,'incomplete or changed original preparation');
rows.forEach((row,index)=>{assert.deepEqual(Object.keys(row).sort(),['at','phase','status']);assert.deepEqual([row.phase,row.status],expected[index]);assert.match(row.at,/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);});
NODE
  approval_evidence="$(node scripts/verify/validate-public-bft-cutover-approval.mjs "$PUBLIC_BFT_CUTOVER_APPROVAL_FILE" "$commit" "$release" "$PUBLIC_BFT_CUSTODY_REVIEW_FILE")"
  # Revalidate the original preparation projection and compare every stable
  # approved field, including original expiry. Only the independently granted
  # final source hash may be added, never inferred from the new source itself.
  node scripts/verify/validate-public-bft-cutover-approval-evidence.mjs "$transaction_dir/preparation-approval.json" "$commit" "$release" --prepare-native >/dev/null
  # stdin is used for JSON, so keep the program in -e rather than a here-doc.
  printf '%s\n' "$approval_evidence" | node --input-type=module -e '
import fs from "node:fs";import assert from "node:assert/strict";
const before=JSON.parse(fs.readFileSync(process.argv[1],"utf8")),after=JSON.parse(fs.readFileSync(0,"utf8"));
assert.equal(before.preparationOnly,true);assert.ok(after.authoritativeCommit);assert.ok(!Object.hasOwn(after,"preparationOnly"));
assert.match(after.snapshotSourceSha256,/^[0-9a-f]{64}$/);delete before.preparationOnly;delete after.snapshotSourceSha256;
assert.deepEqual(after,before,"continuation changed original stable authorization or expiry");' "$transaction_dir/preparation-approval.json"
  mkdir -- "$transaction_dir/continuation-attempt"
  (set -C; printf '{"status":"unknown","automaticRetry":false}\n' >"$transaction_dir/continuation-attempt/intent.json")
  [[ -f "$PUBLIC_BFT_CUTOVER_APPROVAL_FILE" && ! -L "$PUBLIC_BFT_CUTOVER_APPROVAL_FILE" ]] || { echo "original continuation approval must be a protected regular file" >&2; exit 1; }
  (set -C; cat -- "$PUBLIC_BFT_CUTOVER_APPROVAL_FILE" >"$transaction_dir/continuation-attempt/approval.original.json")
  cmp -- "$PUBLIC_BFT_CUTOVER_APPROVAL_FILE" "$transaction_dir/continuation-attempt/approval.original.json" >/dev/null
  printf '%s\n' "$approval_evidence" | cmp - <(node scripts/verify/validate-public-bft-cutover-approval.mjs "$transaction_dir/continuation-attempt/approval.original.json" "$commit" "$release" "$PUBLIC_BFT_CUSTODY_REVIEW_FILE") >/dev/null
  (set -C; printf '%s\n' "$approval_evidence" >"${transaction_dir}/approval.json")
  node -e 'const fs=require("fs");for(const p of process.argv.slice(1)){const fd=fs.openSync(p,"r");try{fs.fsyncSync(fd)}finally{fs.closeSync(fd)}}' "$transaction_dir/continuation-attempt/intent.json" "$transaction_dir/continuation-attempt/approval.original.json" "$transaction_dir/continuation-attempt" "$transaction_dir/approval.json" "$transaction_dir"
else
  [[ ! -e "$transaction_dir" && ! -L "$transaction_dir" ]] || { echo "cutover transaction evidence directory already exists: $transaction_dir" >&2; exit 1; }
  mkdir -p -- "$evidence_root"
  # Creation, not a prior existence check, decides ownership of this attempt.
  mkdir -- "$transaction_dir"
  approval_mode=()
  [[ "$mode" != prepare-native ]] || approval_mode=(--prepare-native)
  approval_input="$PUBLIC_BFT_CUTOVER_APPROVAL_FILE"
  if [[ "$mode" == prepare-native ]]; then
    [[ -f "$approval_input" && ! -L "$approval_input" ]] || { echo "original preparation approval must be a protected regular file" >&2; exit 1; }
    node -e 'const fs=require("fs"),s=fs.lstatSync(process.argv[1]);if(!s.isFile()||(s.mode&0o077)!==0)throw Error("original preparation approval permissions are not private")' "$approval_input"
    (set -C; cat -- "$approval_input" >"${transaction_dir}/preparation-approval.original.json")
    cmp -- "$approval_input" "${transaction_dir}/preparation-approval.original.json" >/dev/null
    approval_input="${transaction_dir}/preparation-approval.original.json"
  fi
  approval_evidence="$(node scripts/verify/validate-public-bft-cutover-approval.mjs "$approval_input" "$commit" "$release" "$PUBLIC_BFT_CUSTODY_REVIEW_FILE" "${approval_mode[@]}")"
  if [[ "$mode" == prepare-native ]]; then
    (set -C; printf '%s\n' "$approval_evidence" >"${transaction_dir}/preparation-approval.json")
    node -e 'const fs=require("fs");for(const p of process.argv.slice(1)){const fd=fs.openSync(p,"r");try{fs.fsyncSync(fd)}finally{fs.closeSync(fd)}}' "$transaction_dir/preparation-approval.original.json" "$transaction_dir/preparation-approval.json" "$transaction_dir"
  else
    printf '%s\n' "$approval_evidence" | node -e 'const fs=require("fs"),a=JSON.parse(fs.readFileSync(0,"utf8"));if(Object.hasOwn(a,"authoritativeCommit"))throw Error("independent native source requires prepare-native then continue-native")'
    (set -C; printf '%s\n' "$approval_evidence" >"${transaction_dir}/approval.json")
  fi
fi

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
  if [[ "$mode" == prepare-native || "$mode" == continue-native ]]; then
    journal_event transaction unknown
    echo "PUBLIC_BFT_NATIVE_OUTCOME_UNKNOWN: preserve original journal/markers/DB/attempt; no automatic resume, unfreeze, cleanup or retry" >&2
    [[ "$original_status" != 0 ]] || original_status=1
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

if [[ "$mode" != continue-native ]]; then
  run_phase preflight
  run_phase backup
  mutation_started=1
  run_phase freeze_mutations
  run_phase pause_authoritative
fi
if [[ "$mode" == prepare-native ]]; then
  journal_event preparation awaiting_final_snapshot_authorization
  node -e 'const fs=require("fs");for(const p of process.argv.slice(1)){const fd=fs.openSync(p,"r");try{fs.fsyncSync(fd)}finally{fs.closeSync(fd)}}' "$transaction_dir/journal.jsonl" "$transaction_dir"
  transaction_complete=1
  trap - EXIT INT TERM
  printf 'public BFT native preparation awaiting_final_snapshot_authorization: id=%s evidence=%s; native remains frozen/paused; no export, initialization, start or ingress\n' "$transaction_id" "$transaction_dir"
  exit 0
fi
mutation_started=1
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
if [[ "$mode" == continue-native ]]; then
  (set -C; printf '{"status":"passed","automaticRetry":false}\n' >"$transaction_dir/continuation-attempt/result.json")
  node -e 'const fs=require("fs");for(const p of process.argv.slice(1)){const fd=fs.openSync(p,"r");try{fs.fsyncSync(fd)}finally{fs.closeSync(fd)}}' "$transaction_dir/continuation-attempt/result.json" "$transaction_dir/journal.jsonl" "$transaction_dir/continuation-attempt" "$transaction_dir"
fi
transaction_complete=1
trap - EXIT INT TERM
printf 'public BFT cutover transaction passed: id=%s evidence=%s\n' "$transaction_id" "$transaction_dir"
