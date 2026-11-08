#!/usr/bin/env bash
set -Eeuo pipefail

cd "$(dirname "$0")/../.."

mode="${PUBLIC_BFT_CUTOVER_MODE:-plan}"
case "$mode" in
  plan|execute|prepare-native|continue-native|continue-pq-native) ;;
  *) echo "PUBLIC_BFT_CUTOVER_MODE must be plan, execute, prepare-native, continue-native or continue-pq-native" >&2; exit 1 ;;
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
  printf '%s\n' 'explicit quiet bootstrap pauses after its normal ready observation; continue-pq-native verifies the original independently approved PQ transition before only the remaining dependency/ingress phases'
  printf '%s\n' 'plan only: no service, state, mutation route, or public ingress was changed'
  exit 0
fi

[[ "${PUBLIC_BFT_CUTOVER_APPROVED:-}" == "yes" ]] || { echo "PUBLIC_BFT_CUTOVER_APPROVED=yes is required" >&2; exit 1; }
[[ -n "$driver" && -x "$driver" ]] || { echo "PUBLIC_BFT_CUTOVER_DRIVER must be an executable file" >&2; exit 1; }
[[ -n "${PUBLIC_BFT_CUTOVER_APPROVAL_FILE:-}" ]] || { echo "PUBLIC_BFT_CUTOVER_APPROVAL_FILE is required" >&2; exit 1; }
[[ -n "${PUBLIC_BFT_CUSTODY_REVIEW_FILE:-}" ]] || { echo "PUBLIC_BFT_CUSTODY_REVIEW_FILE is required" >&2; exit 1; }

release_ref="$(git symbolic-ref --quiet HEAD)" || { echo "public BFT cutover requires an original named release checkout" >&2; exit 1; }
case "$release_ref" in
  refs/heads/main) ;; # Original handover profile remains main-only.
  refs/heads/codex/ynx-pq-public-upgrade|refs/heads/codex/ynx-pq-perf-integration)
    # Only the new same-owner profile may use the existing normal release
    # refs. Revalidate its complete protected inputs and the original SOURCE
    # run against actual GitHub success before creating an operation attempt.
    node scripts/verify/public-bft-release-source.mjs "$PUBLIC_BFT_CUTOVER_APPROVAL_FILE" "$PUBLIC_BFT_CUSTODY_REVIEW_FILE" "$mode"
    ;;
  *) echo "public BFT cutover requires main or an independently qualified same-owner normal release ref" >&2; exit 1 ;;
esac
[[ -z "$(git status --short)" ]] || { echo "public BFT cutover requires a clean worktree" >&2; exit 1; }

umask 077
if [[ "$mode" == prepare-native || "$mode" == continue-native ]]; then
  selected_bootstrap_mode="$(python3 -B scripts/ops/public-bft-quiet-continuation.py mode --plan "${PUBLIC_BFT_PRODUCTION_OPERATOR_PLAN:-}" --plan-sha256 "${PUBLIC_BFT_PRODUCTION_OPERATOR_PLAN_SHA256:-}")"
  if [[ "$selected_bootstrap_mode" == quiet-first-registration-v1 ]]; then
    # Reject a late canonical-path failure before any native freeze/start.
    python3 -B - "$evidence_root" <<'PYROOT'
import pathlib,sys
p=pathlib.Path(sys.argv[1]);assert p.is_absolute() and str(p)==str(p.resolve(strict=False)), 'quiet evidence parent must use its canonical absolute spelling'
PYROOT
  fi
fi
if [[ "$mode" == continue-pq-native ]]; then
  # Resume the retained SAME transaction; never export/import/deploy/start
  # again. Original approval/expiry and the independent transition inputs are
  # revalidated before reserving the exclusive continuation attempt.
  approval_evidence="$(node scripts/verify/validate-public-bft-cutover-approval.mjs "$PUBLIC_BFT_CUTOVER_APPROVAL_FILE" "$commit" "$release" "$PUBLIC_BFT_CUSTODY_REVIEW_FILE")"
  printf '%s\n' "$approval_evidence" | node -e 'const a=JSON.parse(require("fs").readFileSync(0,"utf8"));if(a.custodyProfile==="single-app-same-owner-inplace/v1"&&a.transactionId!==process.argv[1])throw Error("same-owner original transaction mismatch")' "$transaction_id"
  printf '%s\n' "$approval_evidence" | cmp - "$transaction_dir/approval.json" >/dev/null || { echo "PQ continuation changed original full authorization or expiry" >&2; exit 1; }
  node scripts/verify/validate-public-bft-cutover-approval-evidence.mjs "$transaction_dir/approval.json" "$commit" "$release" >/dev/null
  [[ "${PUBLIC_BFT_PQ_CONTINUATION_INPUT:-}" == /* && "${PUBLIC_BFT_PQ_CONTINUATION_INPUT_SHA256:-}" =~ ^[0-9a-f]{64}$ ]] || { echo "independent exact PQ continuation public inputs are required" >&2; exit 1; }
  resume_state="$(python3 -B scripts/ops/public-bft-quiet-continuation.py resume-check --transaction "$transaction_dir" --plan "${PUBLIC_BFT_PRODUCTION_OPERATOR_PLAN:-}" --plan-sha256 "${PUBLIC_BFT_PRODUCTION_OPERATOR_PLAN_SHA256:-}" --input "$PUBLIC_BFT_PQ_CONTINUATION_INPUT" --input-sha256 "$PUBLIC_BFT_PQ_CONTINUATION_INPUT_SHA256" )"
  if [[ "$(printf '%s' "$resume_state" | python3 -B -c 'import json,sys;print(json.load(sys.stdin)["status"])')" == passed ]]; then
    printf '%s\n' "$resume_state"
    exit 0
  fi
  mkdir -m 0700 "$transaction_dir/pq-continuation-attempt"
  (set -C; printf '{"status":"unknown","automaticRetry":false,"inputSHA256":"%s"}\n' "$PUBLIC_BFT_PQ_CONTINUATION_INPUT_SHA256" >"$transaction_dir/pq-continuation-attempt/intent.json")
  (set -C; cat -- "$PUBLIC_BFT_PQ_CONTINUATION_INPUT" >"$transaction_dir/pq-continuation-attempt/input.json")
  cmp -- "$PUBLIC_BFT_PQ_CONTINUATION_INPUT" "$transaction_dir/pq-continuation-attempt/input.json" >/dev/null
  python3 -B - "$transaction_dir/pq-continuation-attempt/input.json" "$PUBLIC_BFT_PQ_CONTINUATION_INPUT_SHA256" <<'PY'
import hashlib,pathlib,sys
assert hashlib.sha256(pathlib.Path(sys.argv[1]).read_bytes()).hexdigest()==sys.argv[2]
PY
  node -e 'const fs=require("fs");for(const p of process.argv.slice(1)){const fd=fs.openSync(p,"r");try{fs.fsyncSync(fd)}finally{fs.closeSync(fd)}}' "$transaction_dir/pq-continuation-attempt/intent.json" "$transaction_dir/pq-continuation-attempt/input.json" "$transaction_dir/pq-continuation-attempt" "$transaction_dir"
elif [[ "$mode" == continue-native ]]; then
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
  printf '%s\n' "$approval_evidence" | node -e 'const a=JSON.parse(require("fs").readFileSync(0,"utf8"));if(a.custodyProfile==="single-app-same-owner-inplace/v1"&&a.transactionId!==process.argv[1])throw Error("same-owner original transaction mismatch")' "$transaction_id"
  # Revalidate the original preparation projection and compare every stable
  # approved stable field, including original expiry. The final source, plan
  # and genesis time require the full independent authorization; original
  # custody/layout are compared with the retained preparation, not self-pinned.
  node scripts/verify/validate-public-bft-cutover-approval-evidence.mjs "$transaction_dir/preparation-approval.json" "$commit" "$release" --prepare-native >/dev/null
  # stdin is used for JSON, so keep the program in -e rather than a here-doc.
  printf '%s\n' "$approval_evidence" | node --input-type=module -e '
import fs from "node:fs";import assert from "node:assert/strict";import {execFileSync} from "node:child_process";import path from "node:path";
const before=JSON.parse(fs.readFileSync(process.argv[1],"utf8")),after=JSON.parse(fs.readFileSync(0,"utf8"));
assert.equal(before.preparationOnly,true);assert.ok(after.authoritativeCommit);assert.ok(!Object.hasOwn(after,"preparationOnly"));
assert.match(after.snapshotSourceSha256,/^[0-9a-f]{64}$/);
assert.equal(after.operatorPreparationPlanSha256,before.operatorPreparationPlanSha256);
assert.equal(process.env.PUBLIC_BFT_PRODUCTION_OPERATOR_PLAN_SHA256,after.operatorPlanSha256,"final operator plan must match the complete independent approval");
execFileSync(process.execPath,["scripts/verify/public-bft-candidate-binding.mjs","--operator-continuation",path.join(path.dirname(process.argv[1]),"preparation-operator-plan.json"),before.operatorPreparationPlanSha256,process.env.PUBLIC_BFT_PRODUCTION_OPERATOR_PLAN||"",after.operatorPlanSha256],{stdio:["ignore","ignore","pipe"]});
assert.ok(!Object.hasOwn(before,"caddySource"),"preparation cannot contain future final-plan Caddy authority");delete after.caddySource;
delete before.preparationOnly;delete after.snapshotSourceSha256;delete after.operatorPlanSha256;delete after.candidateGenesisTime;
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
  approval_evidence="$(node scripts/verify/validate-public-bft-cutover-approval.mjs "$approval_input" "$commit" "$release" "$PUBLIC_BFT_CUSTODY_REVIEW_FILE" ${approval_mode[@]+"${approval_mode[@]}"})"
  printf '%s\n' "$approval_evidence" | node -e 'const a=JSON.parse(require("fs").readFileSync(0,"utf8"));if(a.custodyProfile==="single-app-same-owner-inplace/v1"&&a.transactionId!==process.argv[1])throw Error("same-owner original transaction mismatch")' "$transaction_id"
  if [[ "$mode" == prepare-native ]]; then
    (set -C; printf '%s\n' "$approval_evidence" >"${transaction_dir}/preparation-approval.json")
    preparation_plan_pin="$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1])).operatorPreparationPlanSha256)' "$transaction_dir/preparation-approval.json")"
    validator_pin="$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1])).validatorManifestSha256)' "$transaction_dir/preparation-approval.json")"
    [[ "${PUBLIC_BFT_PRODUCTION_OPERATOR_PLAN_SHA256:-}" == "$preparation_plan_pin" ]] || { echo "native preparation operator pin differs from original approval" >&2; exit 1; }
    node scripts/verify/public-bft-candidate-binding.mjs --retain-operator-preparation "${PUBLIC_BFT_PRODUCTION_OPERATOR_PLAN:-}" "$preparation_plan_pin" "$validator_pin" "$transaction_dir/preparation-operator-plan.json"
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
  if [[ "$mode" == prepare-native || "$mode" == continue-native || "$mode" == continue-pq-native ]]; then
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

if [[ "$mode" != continue-native && "$mode" != continue-pq-native ]]; then
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
if [[ "$mode" == continue-pq-native ]]; then
  run_phase verify_pq_continuation
else
  run_phase export_final_snapshot
  run_phase initialize_candidate
  run_phase deploy_candidate
  run_phase start_candidate
  run_phase verify_candidate
  if [[ "$mode" == continue-native ]]; then
    quiet_mode="$(python3 -B scripts/ops/public-bft-quiet-continuation.py mode --plan "$PUBLIC_BFT_PRODUCTION_OPERATOR_PLAN" --plan-sha256 "$PUBLIC_BFT_PRODUCTION_OPERATOR_PLAN_SHA256")"
    if [[ "$quiet_mode" == quiet-first-registration-v1 ]]; then
      python3 -B scripts/ops/public-bft-quiet-continuation.py pause --transaction "$transaction_dir" --plan "$PUBLIC_BFT_PRODUCTION_OPERATOR_PLAN" --plan-sha256 "$PUBLIC_BFT_PRODUCTION_OPERATOR_PLAN_SHA256"
      transaction_complete=1
      trap - EXIT INT TERM
      printf 'public BFT bootstrap awaiting_pq_activation: id=%s evidence=%s; native remains frozen/paused; no dependencies, public ingress or unfreeze\n' "$transaction_id" "$transaction_dir"
      exit 0
    fi
  fi
fi
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
if [[ "$mode" == continue-pq-native ]]; then
  (set -C; printf '{"status":"passed","automaticRetry":false,"inputSHA256":"%s"}\n' "$PUBLIC_BFT_PQ_CONTINUATION_INPUT_SHA256" >"$transaction_dir/pq-continuation-attempt/result.json")
  node -e 'const fs=require("fs");for(const p of process.argv.slice(1)){const fd=fs.openSync(p,"r");try{fs.fsyncSync(fd)}finally{fs.closeSync(fd)}}' "$transaction_dir/pq-continuation-attempt/result.json" "$transaction_dir/journal.jsonl" "$transaction_dir/pq-continuation-attempt" "$transaction_dir"
fi
transaction_complete=1
trap - EXIT INT TERM
printf 'public BFT cutover transaction passed: id=%s evidence=%s\n' "$transaction_id" "$transaction_dir"
