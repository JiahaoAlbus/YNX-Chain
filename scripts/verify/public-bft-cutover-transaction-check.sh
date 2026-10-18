#!/usr/bin/env bash
set -Eeuo pipefail

cd "$(dirname "$0")/../.."

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
repo="$tmp/repo"
mkdir -p "$repo/scripts/ops" "$repo/scripts/verify/lib"
cp scripts/ops/public-bft-cutover-transaction.sh "$repo/scripts/ops/"
cp scripts/verify/validate-public-bft-cutover-approval.mjs "$repo/scripts/verify/"
cp scripts/verify/validate-public-bft-cutover-approval-evidence.mjs "$repo/scripts/verify/"
cp scripts/verify/validate-production-custody-review.mjs "$repo/scripts/verify/"
cp scripts/verify/validate-owner-handover-receipt.mjs "$repo/scripts/verify/"
cp scripts/verify/lib/owner-handover.mjs "$repo/scripts/verify/lib/"
git -C "$repo" init -q -b main
git -C "$repo" add scripts
git -C "$repo" -c user.name='YNX self test' -c user.email='self-test@localhost' commit -q -m 'cutover fixture'
commit="$(git -C "$repo" rev-parse --short=12 HEAD)"
release="ynx-bft-gateway-${commit}"
baseline="$tmp/baseline"
state="$tmp/state"
printf '%s\n' \
  'ingress=authoritative' \
  'authoritative=running' \
  'frozen=false' \
  'candidate=absent' \
  'synthetic_hrs=19' \
  'dependencies=authoritative' >"$baseline"

future="$(date -u -v+1H +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -d '+1 hour' +%Y-%m-%dT%H:%M:%SZ)"
reviewed_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
service_signer_manifest_sha="bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
operator_plan_sha="cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
runtime_manifest_sha="eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"
owner_binding="$(node scripts/verify/write-owner-handover-fixture.mjs "$tmp" "$commit")"
custody_review="$tmp/custody-review.json"
cat >"$custody_review" <<EOF
{"schemaVersion":1,"action":"ynx-production-custody-review","reviewId":"review-${commit}","reviewer":"custody self test","reviewed":true,"commit":"${commit}","publicManifestSha256":"${service_signer_manifest_sha}","sourceCeremonyStatusSha256":"dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd","signerCount":5,"records":[{"role":"faucet","purpose":"ynx-production-faucet-signer","address":"0x1111111111111111111111111111111111111111"},{"role":"ai","purpose":"ynx-production-ai-signer","address":"0x2222222222222222222222222222222222222222"},{"role":"pay","purpose":"ynx-production-pay-signer","address":"0x3333333333333333333333333333333333333333"},{"role":"trust","purpose":"ynx-production-trust-signer","address":"0x4444444444444444444444444444444444444444"},{"role":"resource","purpose":"ynx-production-resource-signer","address":"0x5555555555555555555555555555555555555555"}],"validatorKeyRecoveryVerified":true,"serviceSignerRecoveryVerified":true,"ownerHandoverVerified":true,"rotationProcedureVerified":true,"validatorRecoveryEvidence":"offline:validator-restore-001","serviceSignerRecoveryEvidence":"offline:service-restore-001","ownerHandoverEvidence":"handover:owner-ack-001","rotationProcedureEvidence":"rotation:review-001","reviewedAt":"${reviewed_at}","expiresAt":"${future}"}
EOF
node - "$custody_review" "$owner_binding" <<'NODE'
const fs=require("fs"),[file,binding]=process.argv.slice(2),review=JSON.parse(fs.readFileSync(file));
Object.assign(review,JSON.parse(binding));
fs.writeFileSync(file,`${JSON.stringify(review)}\n`,{mode:0o600});
NODE
chmod 600 "$custody_review"
custody_evidence="sha256:$(shasum -a 256 "$custody_review" | awk '{print $1}')"
cat >"$tmp/approval.json" <<EOF
{"schemaVersion":1,"action":"ynx-public-bft-cutover","approvalId":"self-test-${commit}","approver":"transaction self test","custodyReviewer":"custody self test","custodyEvidence":"${custody_evidence}","approved":true,"commit":"${commit}","release":"${release}","publicCutoverAuthorized":true,"automaticRollbackRequired":true,"validatorKeyRecoveryVerified":true,"serviceSignerRecoveryVerified":true,"ownerHandoverVerified":true,"rotationProcedureVerified":true,"serviceSignerManifestSha256":"${service_signer_manifest_sha}","validatorManifestSha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","operatorPlanSha256":"${operator_plan_sha}","runtimeManifestSha256":"${runtime_manifest_sha}","candidateGenesisTime":"${future}","expiresAt":"${future}"}
EOF
chmod 600 "$tmp/approval.json"

node - "$tmp/approval.json" <<'NODE'
const fs=require('node:fs'),file=process.argv[2],approval=JSON.parse(fs.readFileSync(file));
// Independent synthetic public inputs; never derive these from a package or
// environment in the validator. Actual cutover requires the original approval.
approval.snapshotSourceSha256='6'.repeat(64);
approval.exporterManifestSha256='7'.repeat(64);
fs.writeFileSync(file,JSON.stringify(approval)+'\n',{mode:0o600});
NODE

# Exercise both actual validators on the original mode-0600 approval and its
# projection. These public fixture pins are inputs, never package/env defaults.
node - "$repo" "$tmp" "$commit" "$release" "$custody_review" <<'NODE'
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const [repo,tmp,commit,release,custody]=process.argv.slice(2);
const rawPath=path.join(tmp,'approval.json'),original=fs.readFileSync(rawPath),raw=JSON.parse(original);
const fields=['operatorPlanSha256','runtimeManifestSha256','snapshotSourceSha256','exporterManifestSha256'];
const first=path.join(repo,'scripts/verify/validate-public-bft-cutover-approval.mjs');
const second=path.join(repo,'scripts/verify/validate-public-bft-cutover-approval-evidence.mjs');
const call=(script,file,extra)=>spawnSync(process.execPath,[script,file,commit,release,...extra],{
  encoding:'utf8',maxBuffer:1<<20,
  env:{...process.env,PUBLIC_BFT_PRODUCTION_OPERATOR_PLAN_SHA256:raw.operatorPlanSha256,CONSENSUS_CANDIDATE_RUNTIME_MANIFEST_SHA256:raw.runtimeManifestSha256},
});
const project=call(first,rawPath,[custody]);
assert.equal(project.status,0,project.stderr);
const projected=JSON.parse(project.stdout);
for(const field of fields)assert.equal(projected[field],raw[field],`CUTOVER_APPROVAL_INDEPENDENT_PIN_DROPPED: ${field}`);
const projectedPath=path.join(tmp,'projected-approval.json');
fs.writeFileSync(projectedPath,project.stdout,{flag:'wx',mode:0o600});
const evidence=call(second,projectedPath,[]);
assert.equal(evidence.status,0,evidence.stderr);
const forwarded=JSON.parse(evidence.stdout);
for(const field of fields)assert.equal(forwarded[field],raw[field],`CUTOVER_APPROVAL_EVIDENCE_PIN_DROPPED: ${field}`);
assert.deepEqual(forwarded,{...projected,validated:true});
const invalid=[['missing',undefined],['empty',''],['zero','0'.repeat(64)],['uppercase','A'.repeat(64)],['short','a'.repeat(63)],['whitespace',' '+raw.operatorPlanSha256],['array',[raw.operatorPlanSha256]],['number',123],['null',null]];
for(const [stage,script,base,extra] of [['raw',first,raw,[custody]],['evidence',second,projected,[]]]){
  for(const field of fields){
    for(const [name,value] of invalid){
      const input={...base};if(value===undefined)delete input[field];else input[field]=value;
      const file=path.join(tmp,`${stage}-${field}-${name}.json`),bytes=JSON.stringify(input)+'\n';
      fs.writeFileSync(file,bytes,{flag:'wx',mode:0o600});
      const rejected=call(script,file,extra);
      assert.notEqual(rejected.status,0,`${stage} accepted ${field}/${name}`);
      assert.equal(rejected.stdout,'',`${stage} emitted approval for ${field}/${name}`);
      assert.ok(rejected.stderr.includes(field),`wrong rejection cause for ${field}/${name}: ${rejected.stderr}`);
      assert.equal(fs.readFileSync(file,'utf8'),bytes,'validator rewrote rejected input');
    }
    // A well-formed but different approval pin must remain different. Only the
    // independent normal binding comparison may decide whether it is approved.
    const changed={...base,[field]:'9'.repeat(64)},file=path.join(tmp,`${stage}-${field}-different.json`);
    fs.writeFileSync(file,JSON.stringify(changed)+'\n',{flag:'wx',mode:0o600});
    const result=call(script,file,extra);assert.equal(result.status,0,result.stderr);
    assert.equal(JSON.parse(result.stdout)[field],changed[field],'validator substituted an environment or prior pin');
  }
}
assert.deepEqual(fs.readFileSync(rawPath),original,'original protected approval changed');
assert.equal(fs.readFileSync(projectedPath,'utf8'),project.stdout,'original approval projection changed');
console.log('CUTOVER_APPROVAL_INDEPENDENT_PINS_PRESERVED: raw/projected exact, missing/malformed refused, no environment fallback');
NODE

# The new scope is bound end-to-end through actual public inventory, receipt,
# custody review and original protected approval. Old nine-identity originals
# remain byte-for-byte unchanged; this creates a separate synthetic QA packet.
node --input-type=module - "$repo" "$tmp" "$commit" "$release" <<'NODE'
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
const [repo,tmp,commit,release]=process.argv.slice(2),project=process.cwd();
const {inventoryCore,sha256,validateInventory}=await import(pathToFileURL(path.join(repo,'scripts/verify/lib/owner-handover.mjs')));
const profile='single-app-gateway/v1',dir=path.join(tmp,'single-app-custody');fs.mkdirSync(dir,{mode:0o700});
const oldPaths=['owner-handover-inventory.json','owner-handover-receipt.json','custody-review.json','approval.json'].map(n=>path.join(tmp,n));
const originals=oldPaths.map(p=>fs.readFileSync(p)),[oldInventory,oldReceipt,oldReview,oldApproval]=originals.map(b=>JSON.parse(b));
const write=(name,value)=>{const p=path.join(dir,name);fs.writeFileSync(p,JSON.stringify(value)+'\n',{mode:0o600});return p;};
const inventory={...oldInventory,custodyProfile:profile,sources:{validatorManifestSha256:oldApproval.validatorManifestSha256,operatorPlanSha256:oldApproval.operatorPlanSha256,runtimeManifestSha256:oldApproval.runtimeManifestSha256},records:oldInventory.records.filter(r=>r.category==='production-validator'),readiness:{recordCount:4,validatorCount:4,serviceSignerCount:0,handoverRequiredCount:4,unknownOwnershipCount:0,offlineRecoveryVerified:false,ownerHandoverVerified:false,rotationProcedureVerified:false,independentCustodyReviewVerified:false,publicBFTReady:false}};
inventory.inventoryDigest='sha256:'+sha256(JSON.stringify(inventoryCore(inventory))+'\n');validateInventory(inventory,commit);
const inventoryPath=write('owner-handover-inventory.json',inventory);
const receipt={...oldReceipt,custodyProfile:profile,inventoryDigest:inventory.inventoryDigest,inventoryFileSha256:sha256(fs.readFileSync(inventoryPath)),recordCount:4,handoverRequiredIds:inventory.records.map(r=>r.id)};
delete receipt.serviceSignerOfflineRecoveryVerified;delete receipt.serviceSignerRecoveryEvidence;
const receiptPath=write('owner-handover-receipt.json',receipt);
const review={...oldReview,custodyProfile:profile,...inventory.sources,validatorCount:4,records:inventory.records.map(r=>({role:r.role,consensusAddress:r.publicIdentity,nodeId:r.secondaryPublicIdentity})),ownerHandoverInventoryDigest:inventory.inventoryDigest,ownerHandoverInventoryEvidence:'sha256:'+sha256(fs.readFileSync(inventoryPath)),ownerHandoverReceiptEvidence:'sha256:'+sha256(fs.readFileSync(receiptPath))};
for(const k of ['publicManifestSha256','sourceCeremonyStatusSha256','signerCount','serviceSignerRecoveryVerified','serviceSignerRecoveryEvidence'])delete review[k];
const reviewPath=write('review.json',review);
const approval={...oldApproval,custodyProfile:profile,custodyEvidence:'sha256:'+sha256(fs.readFileSync(reviewPath))};
delete approval.serviceSignerRecoveryVerified;delete approval.serviceSignerManifestSha256;
const approvalPath=write('approval.json',approval);
const run=(file,args,ok=true)=>{const p=spawnSync(process.execPath,[path.join(repo,'scripts/verify',file),...args],{encoding:'utf8'});if(ok)assert.equal(p.status,0,p.stderr);else assert.notEqual(p.status,0,'unqualified scoped custody accepted');return p;};
const projected=run('validate-public-bft-cutover-approval.mjs',[approvalPath,commit,release,reviewPath]);
const value=JSON.parse(projected.stdout);assert.equal(value.custodyProfile,profile);assert.equal(Object.hasOwn(value,'serviceSignerRecoveryVerified'),false);assert.equal(Object.hasOwn(value,'serviceSignerManifestSha256'),false);
const projectedPath=path.join(dir,'projected.json');fs.writeFileSync(projectedPath,projected.stdout,{mode:0o600});
const forwarded=JSON.parse(run('validate-public-bft-cutover-approval-evidence.mjs',[projectedPath,commit,release]).stdout);assert.deepEqual(forwarded,{...value,validated:true});
for(const [field,bad] of [['custodyProfile',undefined],['custodyProfile','legacy'],['custodyProfile',null],['serviceSignerRecoveryVerified',true],['validatorKeyRecoveryVerified',false],['rotationProcedureVerified',false],['ownerHandoverVerified',false],['operatorPlanSha256','1'.repeat(64)],['runtimeManifestSha256','2'.repeat(64)],['validatorManifestSha256','3'.repeat(64)],['custodyReviewer',approval.approver]]){
  const a={...approval};if(bad===undefined)delete a[field];else a[field]=bad;const p=write('invalid-approval.json',a);
  run('validate-public-bft-cutover-approval.mjs',[p,commit,release,reviewPath],false);
}
const reviewBytes=fs.readFileSync(reviewPath);
for(const [field,bad] of [['custodyProfile',undefined],['custodyProfile','other'],['serviceSignerRecoveryVerified',true],['validatorKeyRecoveryVerified',false],['validatorCount',3],['reviewer',receipt.owner],['reviewer',receipt.independentReviewer],['expiresAt','2000-01-01T00:00:00Z'],['validatorRecoveryEvidence','offline:unapproved-restore']]){
  const r={...review};if(bad===undefined)delete r[field];else r[field]=bad;write('review.json',r);
  run('validate-production-custody-review.mjs',[reviewPath,commit,inventory.sources.validatorManifestSha256],false);
}
write('review.json',{...review,records:review.records.map((r,i)=>i===1?{...r,nodeId:'f'.repeat(40)}:r)});
run('validate-production-custody-review.mjs',[reviewPath,commit,inventory.sources.validatorManifestSha256],false);fs.writeFileSync(reviewPath,reviewBytes);
for(const mutate of [i=>{delete i.custodyProfile;},i=>{i.records[1].role=i.records[0].role;},i=>{i.records[1].secondaryPublicIdentity=i.records[0].secondaryPublicIdentity;},i=>{i.records[0].handoverRequired=false;},i=>{i.sources.operatorPlanSha256='0'.repeat(64);},i=>{i.records.push(oldInventory.records.find(r=>r.category==='service-signer'));}]){
  const i=structuredClone(inventory);mutate(i);i.inventoryDigest='sha256:'+sha256(JSON.stringify(inventoryCore(i))+'\n');
  const p=write('invalid-inventory.json',i);run('validate-owner-handover-receipt.mjs',[receiptPath,p,commit],false);
}
for(const [field,bad]of [['custodyProfile',undefined],['serviceSignerOfflineRecoveryVerified',true],['validatorRecoveryVerified',false],['rotationProcedureVerified',false],['independentReviewer',receipt.owner]]){
  const r={...receipt};if(bad===undefined)delete r[field];else r[field]=bad;
  run('validate-owner-handover-receipt.mjs',[write('invalid-receipt.json',r),inventoryPath,commit],false);
}
// The production service selector revalidates original custody and compares
// the exact protected projection. An environment flag cannot choose scope.
const driver=fs.readFileSync(path.join(project,'scripts/ops/public-bft-production-driver.sh'),'utf8');
const body=driver.match(/^public_bft_preflight_services\(\) \{\n[\s\S]*?^\}/m)?.[0];assert.ok(body);
const q=x=>"'"+x.replaceAll("'","'\\''")+"'",shell=path.join(dir,'preflight.sh'),transaction=path.join(dir,'transaction');fs.mkdirSync(transaction);
fs.writeFileSync(path.join(transaction,'approval.json'),projected.stdout,{mode:0o600});
fs.writeFileSync(shell,`set -euo pipefail\ncd ${q(project)}\ncommit=${q(commit)}\nynx_ops_services_for_kind(){ printf legacy-full-services; }\n${body}\npublic_bft_preflight_services full\n`,{mode:0o700});
const env={...process.env,PUBLIC_BFT_CUTOVER_TRANSACTION_DIR:transaction,PUBLIC_BFT_CUTOVER_APPROVAL_FILE:approvalPath,PUBLIC_BFT_CUSTODY_REVIEW_FILE:reviewPath};
let selected=spawnSync('bash',[shell],{env,encoding:'utf8'});assert.equal(selected.status,0,selected.stderr);assert.equal(selected.stdout,'ynx-chaind');
fs.writeFileSync(path.join(transaction,'approval.json'),JSON.stringify({...value,operatorPlanSha256:'f'.repeat(64)})+'\n');
selected=spawnSync('bash',[shell],{env,encoding:'utf8'});assert.notEqual(selected.status,0);assert.equal(selected.stdout,'');
selected=spawnSync('bash',[shell],{env:{...env,PUBLIC_BFT_CUTOVER_TRANSACTION_DIR:'',PUBLIC_BFT_CUSTODY_PROFILE:profile},encoding:'utf8'});assert.equal(selected.status,0);assert.equal(selected.stdout,'legacy-full-services');
// Exercise the real collect_role command builder. The transport records the
// command without executing curl/systemctl/ss; the unrelated key preflight is
// an explicit public fixture stub. Original approval validation remains real.
const collect=driver.match(/^collect_role\(\) \{\n[\s\S]*?^\}/m)?.[0];assert.ok(collect);
const collectShell=path.join(dir,'collect.sh'),commands=path.join(dir,'commands.txt');
fs.writeFileSync(path.join(transaction,'approval.json'),projected.stdout,{mode:0o600});
const fullServices='ynx-chaind ynx-indexerd ynx-explorerd ynx-faucetd ynx-ai-gatewayd ynx-payd ynx-trustd ynx-resourced';
fs.writeFileSync(collectShell,`set -euo pipefail\ncd ${q(project)}\ncommit=${q(commit)}\nrelease=${q(release)}\nroot=${q(path.join(dir,'collect-evidence'))}\ncandidate_operator_plan=/public-fixture/operator-plan.json\ncandidate_operator_pin=${q('c'.repeat(64))}\nynx_ops_services_for_kind(){ if [[ "$1" == full ]]; then printf '%s' ${q(fullServices)}; else printf ynx-chaind; fi; }\nnode(){ if [[ "$1" == scripts/verify/public-bft-candidate-binding.mjs && "$2" == --operator-preflight ]]; then printf true; else ${q(process.execPath)} "$@"; fi; }\nynx_ops_ssh(){ printf '%s\\n' "$5" >> "$CALLER_COMMANDS"; }\n${body}\n${collect}\ncollect_role primary fixture-user fixture-host fixture-key full\n`,{mode:0o700});
let collected=spawnSync('bash',[collectShell],{env:{...env,CALLER_COMMANDS:commands},encoding:'utf8'});assert.equal(collected.status,0,collected.stderr);
let command=fs.readFileSync(commands,'utf8');assert.ok(command.includes('for service in ynx-chaind;'));assert.ok(command.includes(':(27620|27656|27757|27858)$'));assert.ok(command.includes('ynx-consensus-overlay.service'));assert.equal(/2762[6-9]|2763[0-2]|ynx-ai-gatewayd|ynx-payd|ynx-trustd/.test(command),false,'scoped collect still depends on paused candidate services/ports');
const legacyCommands=path.join(dir,'legacy-commands.txt');collected=spawnSync('bash',[collectShell],{env:{...env,PUBLIC_BFT_CUTOVER_TRANSACTION_DIR:'',PUBLIC_BFT_CUSTODY_PROFILE:profile,CALLER_COMMANDS:legacyCommands},encoding:'utf8'});assert.equal(collected.status,0,collected.stderr);command=fs.readFileSync(legacyCommands,'utf8');assert.ok(command.includes(`for service in ${fullServices};`));assert.ok(command.includes(':(27620|27626|27627|27628|27629|27630|27631|27632|27656|27757|27858)$'));
oldPaths.forEach((p,i)=>assert.deepEqual(fs.readFileSync(p),originals[i],'original full-profile custody changed'));
console.log('SINGLE_APP_CUSTODY_CHAIN_VALIDATED: four original identities, exact pins/profile, separate reviewers, no fabricated service recovery, original full profile preserved');
NODE

cat >"$tmp/driver" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
phase="$1"
state="${CUTOVER_TEST_STATE:?}"
failure_marker="${PUBLIC_BFT_CUTOVER_TRANSACTION_DIR}/failure-injected"
attempt="${PUBLIC_BFT_CUTOVER_TRANSACTION_DIR}/candidate/start-attempt"
initialization="${PUBLIC_BFT_CUTOVER_TRANSACTION_DIR}/candidate/initialize-attempt"
application="${PUBLIC_BFT_CUTOVER_TRANSACTION_DIR}/candidate/fresh-application"
# This is an isolated workflow-state stub, never a node, signer, transport, or
# paused product. The custody fixture names below do not start any service.
printf '%s\n' "$phase" >>"${PUBLIC_BFT_CUTOVER_TRANSACTION_DIR}/driver-calls.txt"
set_value() {
  local key="$1" value="$2" next="${state}.next"
  awk -F= -v key="$key" -v value="$value" 'BEGIN { OFS="=" } $1 == key { $2=value } { print }' "$state" >"$next"
  mv "$next" "$state"
}
if [[ "${CUTOVER_TEST_FAIL_PHASE:-}" == "$phase" && ! -e "$failure_marker" ]]; then
  touch "$failure_marker"
  cp "$state" "${PUBLIC_BFT_CUTOVER_TRANSACTION_DIR}/failure-state"
  exit 72
fi
case "$phase" in
  preflight) cmp "$state" "${CUTOVER_TEST_BASELINE:?}" >/dev/null ;;
  backup) cp "$state" "${PUBLIC_BFT_CUTOVER_TRANSACTION_DIR}/state.backup" ;;
  freeze_mutations) set_value frozen true ;;
  pause_authoritative) set_value authoritative paused ;;
  export_final_snapshot)
    grep -Fxq 'frozen=true' "$state" && grep -Fxq 'authoritative=paused' "$state"
    case "${CUTOVER_TEST_EXISTING_INITIALIZATION:-}" in
      '') ;;
      file|directory|dangling-symlink)
        mkdir "${PUBLIC_BFT_CUTOVER_TRANSACTION_DIR}/candidate"
        case "$CUTOVER_TEST_EXISTING_INITIALIZATION" in
          file) printf 'original-initialization-unknown\n' >"$initialization" ;;
          directory) mkdir "$initialization" ;;
          dangling-symlink) ln -s absent-original-initialization "$initialization" ;;
        esac
        ;;
      *) exit 64 ;;
    esac
    ;;
  initialize_candidate)
    grep -Fxq 'frozen=true' "$state"
    grep -Fxq 'authoritative=paused' "$state"
    [[ "${PUBLIC_BFT_PRODUCTION_INITIALIZATION_APPROVED:-}" == yes ]]
    mkdir "${PUBLIC_BFT_CUTOVER_TRANSACTION_DIR}/candidate"
    mkdir "$initialization"
    printf '{"status":"unknown","automaticRetry":false,"syntheticOnly":true}\n' >"$initialization/intent.json"
    mkdir "$application"
    printf '{"originalImportedState":true,"syntheticOnly":true}\n' >"$application/state.json"
    if [[ "${CUTOVER_TEST_FAIL_PHASE:-}" == "initialize_candidate:partial" || "${CUTOVER_TEST_FAIL_PHASE:-}" == "initialize_candidate:timeout" ]]; then
      set_value candidate initialization-partial
      printf 'original-partial-output\n' >"$initialization/state.partial"
      cp "$state" "${PUBLIC_BFT_CUTOVER_TRANSACTION_DIR}/failure-state"
      [[ "${CUTOVER_TEST_FAIL_PHASE:-}" != "initialize_candidate:timeout" ]] || exit 124
      exit 74
    fi
    set_value candidate initialized
    printf '{"imported":true,"dryRun":false,"consensusInitialized":false,"runtimeStarted":false,"syntheticOnly":true}\n' >"$initialization/result.json"
    ;;
  deploy_candidate)
    grep -Fxq 'candidate=initialized' "$state"
    grep -Fxq '{"imported":true,"dryRun":false,"consensusInitialized":false,"runtimeStarted":false,"syntheticOnly":true}' "$initialization/result.json"
    set_value candidate installed
    case "${CUTOVER_TEST_EXISTING_ATTEMPT:-}" in
      '') ;;
      file) printf 'original-unknown-attempt\n' >"$attempt" ;;
      directory) mkdir "$attempt" ;;
      dangling-symlink) ln -s absent-original-start "$attempt" ;;
      *) exit 64 ;;
    esac
    ;;
  start_candidate)
    grep -Fxq 'candidate=installed' "$state"
    grep -Fxq 'frozen=true' "$state"
    grep -Fxq 'authoritative=paused' "$state"
    mkdir "$attempt"
    printf '{"status":"unknown","automaticRetry":false,"syntheticOnly":true}\n' >"$attempt/intent.json"
    printf '{"height":"20","syntheticOnly":true}\n' >"$attempt/hrs.json"
    set_value synthetic_hrs 20
    if [[ "${CUTOVER_TEST_FAIL_PHASE:-}" == "start_candidate:partial" || "${CUTOVER_TEST_FAIL_PHASE:-}" == "start_candidate:timeout" ]]; then
      set_value candidate partially-started
      cp "$state" "${PUBLIC_BFT_CUTOVER_TRANSACTION_DIR}/failure-state"
      # Model the transport's timeout exit without starting a child/service.
      [[ "${CUTOVER_TEST_FAIL_PHASE:-}" != "start_candidate:timeout" ]] || exit 124
      exit 74
    fi
    set_value candidate running
    printf '{"started":true,"dryRun":false,"syntheticOnly":true}\n' >"$attempt/result.json"
    ;;
  verify_candidate) grep -Fxq 'candidate=running' "$state" ;;
  start_dependencies) set_value dependencies bft ;;
  verify_continuity) grep -Fxq 'dependencies=bft' "$state" ;;
  switch_ingress) set_value ingress bft ;;
  verify_public) grep -Fxq 'ingress=bft' "$state" && grep -Fxq 'candidate=running' "$state" ;;
  unfreeze_mutations) set_value frozen false ;;
  rollback_ingress) set_value ingress authoritative ;;
  rollback_dependencies) set_value dependencies authoritative ;;
  rollback_candidate) set_value candidate absent ;;
  resume_authoritative) set_value authoritative running ;;
  verify_rollback) cmp "$state" "${CUTOVER_TEST_BASELINE:?}" >/dev/null ;;
  *) echo "unexpected cutover driver phase: $phase" >&2; exit 64 ;;
esac
if [[ "${CUTOVER_TEST_FAIL_PHASE:-}" == "${phase}:after" && ! -e "$failure_marker" ]]; then
  touch "$failure_marker"
  cp "$state" "${PUBLIC_BFT_CUTOVER_TRANSACTION_DIR}/failure-state"
  exit 73
fi
EOF
chmod 700 "$tmp/driver"

run_transaction() {
  local id="$1" fail_phase="${2:-}" existing_attempt="${3:-}" existing_initialization="${4:-}"
  (cd "$repo" && PUBLIC_BFT_CUTOVER_MODE=execute \
  PUBLIC_BFT_CUTOVER_APPROVED=yes \
  PUBLIC_BFT_CUTOVER_APPROVAL_FILE="$tmp/approval.json" \
  PUBLIC_BFT_CUSTODY_REVIEW_FILE="$custody_review" \
  PUBLIC_BFT_PRODUCTION_INITIALIZATION_APPROVED=yes \
  PUBLIC_BFT_CUTOVER_DRIVER="$tmp/driver" \
  PUBLIC_BFT_CUTOVER_EVIDENCE_DIR="$tmp/evidence" \
  PUBLIC_BFT_CUTOVER_TRANSACTION_ID="$id" \
  CUTOVER_TEST_STATE="$state" \
  CUTOVER_TEST_BASELINE="$baseline" \
  CUTOVER_TEST_FAIL_PHASE="$fail_phase" \
  CUTOVER_TEST_EXISTING_ATTEMPT="$existing_attempt" \
  CUTOVER_TEST_EXISTING_INITIALIZATION="$existing_initialization" \
  bash scripts/ops/public-bft-cutover-transaction.sh)
}

plan="$(cd "$repo" && PUBLIC_BFT_CUTOVER_MODE=plan bash scripts/ops/public-bft-cutover-transaction.sh)"
grep -Fq 'plan only: no service, state, mutation route, or public ingress was changed' <<<"$plan"
grep -Fq 'forward phase: initialize_candidate' <<<"$plan"
grep -Fq 'forward phase: start_candidate' <<<"$plan"
grep -Fq 'after any candidate initialization attempt: preserve staging/partial/UNKNOWN' <<<"$plan"
grep -Fq 'after any candidate start attempt: preserve UNKNOWN' <<<"$plan"

for phase in freeze_mutations pause_authoritative export_final_snapshot; do
  cp "$baseline" "$state"
  if run_transaction "fail-${phase}" "${phase}:after" >/dev/null 2>&1; then
    echo "failure injection unexpectedly passed at $phase" >&2
    exit 1
  fi
  cmp "$state" "$baseline" >/dev/null || { echo "rollback did not restore baseline after $phase" >&2; exit 1; }
  grep -Fq '"phase":"rollback","status":"passed"' "$tmp/evidence/fail-${phase}/journal.jsonl"
  if grep -Eq '^(initialize_candidate|start_candidate)$' "$tmp/evidence/fail-${phase}/driver-calls.txt"; then
    echo "pre-initialization failure dispatched a candidate writer at $phase" >&2; exit 1
  fi
done

# An initialization reply cannot prove a timed-out writer is gone. Preserve
# partial imports without inventing either consensus start or old-chain resume.
for phase in initialize_candidate initialize_candidate:partial initialize_candidate:timeout initialize_candidate:after deploy_candidate deploy_candidate:after; do
  id="unknown-${phase//:/-}"
  cp "$baseline" "$state"
  status=0
  run_transaction "$id" "$phase" >"$tmp/$id.log" 2>&1 || status=$?
  case "$phase" in
    initialize_candidate|deploy_candidate) expected_status=72 ;;
    initialize_candidate:partial) expected_status=74 ;;
    initialize_candidate:timeout) expected_status=124 ;;
    *) expected_status=73 ;;
  esac
  [[ "$status" == "$expected_status" ]] || { echo "initialization UNKNOWN lost original status at $phase: $status" >&2; exit 1; }
  evidence="$tmp/evidence/$id"
  cmp "$state" "$evidence/failure-state" >/dev/null
  grep -Fxq 'synthetic_hrs=19' "$state"
  grep -Fxq 'frozen=true' "$state"
  grep -Fxq 'authoritative=paused' "$state"
  grep -Fq 'PUBLIC_BFT_CUTOVER_INITIALIZATION_OUTCOME_UNKNOWN' "$tmp/$id.log"
  grep -Fq 'this is not evidence of consensus start' "$tmp/$id.log"
  grep -Fq '"phase":"transaction","status":"unknown"' "$evidence/journal.jsonl"
  if grep -Eq '^(start_candidate|rollback_|resume_authoritative$|unfreeze_mutations$|verify_rollback$)' "$evidence/driver-calls.txt" || grep -Fq '"phase":"rollback"' "$evidence/journal.jsonl"; then
    echo "initialization UNKNOWN started consensus or resumed old chain at $phase" >&2; exit 1
  fi
  [[ "$(grep -Fxc initialize_candidate "$evidence/driver-calls.txt")" == 1 ]]
  if [[ "$phase" == "initialize_candidate" ]]; then
    [[ ! -e "$evidence/candidate/initialize-attempt" ]]
    [[ ! -e "$evidence/candidate/fresh-application" ]]
  else
    grep -Fxq '{"status":"unknown","automaticRetry":false,"syntheticOnly":true}' "$evidence/candidate/initialize-attempt/intent.json"
    grep -Fxq '{"originalImportedState":true,"syntheticOnly":true}' "$evidence/candidate/fresh-application/state.json"
    if [[ "$phase" == "initialize_candidate:partial" || "$phase" == "initialize_candidate:timeout" ]]; then
      [[ ! -e "$evidence/candidate/initialize-attempt/result.json" ]]
      grep -Fxq original-partial-output "$evidence/candidate/initialize-attempt/state.partial"
    fi
  fi
  cp "$evidence/journal.jsonl" "$tmp/original-init-journal"
  cp "$evidence/driver-calls.txt" "$tmp/original-init-calls"
  if run_transaction "$id" >/dev/null 2>&1; then
    echo "UNKNOWN initialization was retried at $phase" >&2; exit 1
  fi
  cmp "$state" "$evidence/failure-state" >/dev/null
  cmp "$evidence/journal.jsonl" "$tmp/original-init-journal" >/dev/null
  cmp "$evidence/driver-calls.txt" "$tmp/original-init-calls" >/dev/null
done

for kind in file directory dangling-symlink; do
  id="retained-initialization-$kind"
  cp "$baseline" "$state"
  status=0
  run_transaction "$id" export_final_snapshot:after '' "$kind" >"$tmp/$id.log" 2>&1 || status=$?
  [[ "$status" == 73 ]]
  evidence="$tmp/evidence/$id"
  cmp "$state" "$evidence/failure-state" >/dev/null
  grep -Fq 'PUBLIC_BFT_CUTOVER_INITIALIZATION_OUTCOME_UNKNOWN' "$tmp/$id.log"
  if grep -Eq '^(initialize_candidate|start_candidate|rollback_|resume_authoritative$|unfreeze_mutations$|verify_rollback$)' "$evidence/driver-calls.txt"; then
    echo "retained initialization dispatched writer or recovery for $kind" >&2; exit 1
  fi
  case "$kind" in
    file) grep -Fxq original-initialization-unknown "$evidence/candidate/initialize-attempt" ;;
    directory) [[ -d "$evidence/candidate/initialize-attempt" ]] ;;
    dangling-symlink) [[ -L "$evidence/candidate/initialize-attempt" && "$(readlink "$evidence/candidate/initialize-attempt")" == absent-original-initialization ]] ;;
  esac
done

# Original failures after deployment must now preserve possible signed history,
# including a timeout/partial start and a failure before any driver reply.
for phase in start_candidate start_candidate:partial start_candidate:timeout start_candidate:after verify_candidate:after start_dependencies:after verify_continuity:after switch_ingress:after verify_public:after unfreeze_mutations:after; do
  id="unknown-${phase//:/-}"
  cp "$baseline" "$state"
  status=0
  run_transaction "$id" "$phase" >"$tmp/$id.log" 2>&1 || status=$?
  case "$phase" in
    start_candidate) expected_status=72 ;;
    start_candidate:partial) expected_status=74 ;;
    start_candidate:timeout) expected_status=124 ;;
    *) expected_status=73 ;;
  esac
  [[ "$status" == "$expected_status" ]] || { echo "candidate UNKNOWN lost original failure status at $phase: $status" >&2; exit 1; }
  evidence="$tmp/evidence/$id"
  cmp "$state" "$evidence/failure-state" >/dev/null || { echo "candidate UNKNOWN changed original state/HRS after $phase" >&2; exit 1; }
  grep -Fq 'PUBLIC_BFT_CUTOVER_START_OUTCOME_UNKNOWN' "$tmp/$id.log"
  grep -Fq '"phase":"transaction","status":"unknown"' "$evidence/journal.jsonl"
  if grep -Fq '"phase":"rollback"' "$evidence/journal.jsonl" || grep -Eq '^(rollback_|resume_authoritative$|verify_rollback$)' "$evidence/driver-calls.txt"; then
    echo "candidate UNKNOWN invoked automatic recovery at $phase" >&2; exit 1
  fi
  [[ "$(grep -Fxc start_candidate "$evidence/driver-calls.txt")" == 1 ]]
  if [[ "$phase" == "start_candidate" ]]; then
    [[ ! -e "$evidence/candidate/start-attempt" ]]
    grep -Fxq 'candidate=installed' "$state"
    grep -Fxq 'synthetic_hrs=19' "$state"
  else
    grep -Fxq 'synthetic_hrs=20' "$state"
    grep -Fxq '{"height":"20","syntheticOnly":true}' "$evidence/candidate/start-attempt/hrs.json"
    grep -Fxq '{"status":"unknown","automaticRetry":false,"syntheticOnly":true}' "$evidence/candidate/start-attempt/intent.json"
  fi
  if [[ "$phase" == "start_candidate:partial" || "$phase" == "start_candidate:timeout" ]]; then
    [[ ! -e "$evidence/candidate/start-attempt/result.json" ]]
    grep -Fxq 'candidate=partially-started' "$state"
  fi
  expected_unfreeze_calls=0
  [[ "$phase" != "unfreeze_mutations:after" ]] || expected_unfreeze_calls=1
  [[ "$(grep -Fc unfreeze_mutations "$evidence/driver-calls.txt" || true)" == "$expected_unfreeze_calls" ]]
  cp "$evidence/journal.jsonl" "$tmp/original-journal"
  cp "$evidence/driver-calls.txt" "$tmp/original-driver-calls"
  if run_transaction "$id" >/dev/null 2>&1; then
    echo "UNKNOWN transaction was retried at $phase" >&2
    exit 1
  fi
  cmp "$state" "$evidence/failure-state" >/dev/null
  cmp "$evidence/journal.jsonl" "$tmp/original-journal" >/dev/null
  cmp "$evidence/driver-calls.txt" "$tmp/original-driver-calls" >/dev/null
done

# A retained attempt is authoritative for preservation even before this process
# dispatches start, including partial files/directories and dangling symlinks.
for kind in file directory dangling-symlink; do
  id="retained-attempt-$kind"
  cp "$baseline" "$state"
  status=0
  run_transaction "$id" deploy_candidate:after "$kind" >"$tmp/$id.log" 2>&1 || status=$?
  [[ "$status" == 73 ]]
  evidence="$tmp/evidence/$id"
  cmp "$state" "$evidence/failure-state" >/dev/null
  grep -Fq 'PUBLIC_BFT_CUTOVER_START_OUTCOME_UNKNOWN' "$tmp/$id.log"
  if grep -Eq '^(start_candidate|rollback_|resume_authoritative$|unfreeze_mutations$|verify_rollback$)' "$evidence/driver-calls.txt"; then
    echo "retained attempt triggered start or recovery for $kind" >&2; exit 1
  fi
  case "$kind" in
    file) grep -Fxq original-unknown-attempt "$evidence/candidate/start-attempt" ;;
    directory) [[ -d "$evidence/candidate/start-attempt" ]] ;;
    dangling-symlink) [[ -L "$evidence/candidate/start-attempt" && "$(readlink "$evidence/candidate/start-attempt")" == absent-original-start ]] ;;
  esac
done

cp "$baseline" "$state"
run_transaction success-path >/dev/null
grep -Fq '"automaticRollbackRequired":true' "$tmp/evidence/success-path/approval.json"
grep -Fq '"custodyReviewer":"custody self test"' "$tmp/evidence/success-path/approval.json"
grep -Fq '"validatorManifestSha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"' "$tmp/evidence/success-path/approval.json"
grep -Fq "\"operatorPlanSha256\":\"$operator_plan_sha\"" "$tmp/evidence/success-path/approval.json"
grep -Fq "\"runtimeManifestSha256\":\"$runtime_manifest_sha\"" "$tmp/evidence/success-path/approval.json"
grep -Fxq 'ingress=bft' "$state"
grep -Fxq 'authoritative=paused' "$state"
grep -Fxq 'frozen=false' "$state"
grep -Fxq 'candidate=running' "$state"
grep -Fxq 'synthetic_hrs=20' "$state"
grep -Fxq 'dependencies=bft' "$state"
grep -Fq '"phase":"transaction","status":"passed"' "$tmp/evidence/success-path/journal.jsonl"
printf '%s\n' preflight backup freeze_mutations pause_authoritative export_final_snapshot initialize_candidate deploy_candidate start_candidate verify_candidate start_dependencies verify_continuity switch_ingress verify_public unfreeze_mutations >"$tmp/expected-success-calls"
cmp "$tmp/expected-success-calls" "$tmp/evidence/success-path/driver-calls.txt" >/dev/null
grep -Fxq '{"started":true,"dryRun":false,"syntheticOnly":true}' "$tmp/evidence/success-path/candidate/start-attempt/result.json"
grep -Fxq '{"imported":true,"dryRun":false,"consensusInitialized":false,"runtimeStarted":false,"syntheticOnly":true}' "$tmp/evidence/success-path/candidate/initialize-attempt/result.json"
grep -Fxq '{"originalImportedState":true,"syntheticOnly":true}' "$tmp/evidence/success-path/candidate/fresh-application/state.json"

cp "$baseline" "$state"
if run_transaction success-path >/dev/null 2>&1; then
  echo "reused transaction evidence directory unexpectedly passed" >&2
  exit 1
fi
cmp "$state" "$baseline" >/dev/null

ln -s absent-original-transaction "$tmp/evidence/retained-transaction-link"
if run_transaction retained-transaction-link >/dev/null 2>&1; then
  echo "dangling transaction evidence was reused" >&2
  exit 1
fi
[[ -L "$tmp/evidence/retained-transaction-link" && "$(readlink "$tmp/evidence/retained-transaction-link")" == absent-original-transaction ]]
[[ ! -e "$tmp/evidence/absent-original-transaction" ]]
cmp "$state" "$baseline" >/dev/null

cp "$tmp/approval.json" "$tmp/insecure-approval.json"
chmod 644 "$tmp/insecure-approval.json"
if (cd "$repo" && node scripts/verify/validate-public-bft-cutover-approval.mjs "$tmp/insecure-approval.json" "$commit" "$release" "$custody_review") >/dev/null 2>&1; then
  echo "insecure approval permissions passed validation" >&2
  exit 1
fi
if (cd "$repo" && node scripts/verify/validate-public-bft-cutover-approval.mjs "$tmp/approval.json" 000000000000 ynx-bft-gateway-000000000000 "$custody_review") >/dev/null 2>&1; then
  echo "approval bound to another commit unexpectedly passed validation" >&2
  exit 1
fi
node -e 'const fs=require("fs"),[i,o]=process.argv.slice(1),v=JSON.parse(fs.readFileSync(i));delete v.validatorManifestSha256;fs.writeFileSync(o,JSON.stringify(v)+"\n",{mode:0o600})' "$tmp/approval.json" "$tmp/incomplete-approval.json"
if (cd "$repo" && node scripts/verify/validate-public-bft-cutover-approval.mjs "$tmp/incomplete-approval.json" "$commit" "$release" "$custody_review") >/dev/null 2>&1; then
  echo "approval without a validator manifest checksum unexpectedly passed validation" >&2
  exit 1
fi
node -e 'const fs=require("fs"),[i,o]=process.argv.slice(1),v=JSON.parse(fs.readFileSync(i));v.serviceSignerRecoveryVerified=false;fs.writeFileSync(o,JSON.stringify(v)+"\n",{mode:0o600})' "$tmp/approval.json" "$tmp/incomplete-custody-approval.json"
if (cd "$repo" && node scripts/verify/validate-public-bft-cutover-approval.mjs "$tmp/incomplete-custody-approval.json" "$commit" "$release" "$custody_review") >/dev/null 2>&1; then
  echo "cutover approval without service signer recovery unexpectedly passed validation" >&2
  exit 1
fi
node -e 'const fs=require("fs"),[i,o]=process.argv.slice(1),v=JSON.parse(fs.readFileSync(i));v.custodyEvidence="free-form-review-reference";fs.writeFileSync(o,JSON.stringify(v)+"\n",{mode:0o600})' "$tmp/approval.json" "$tmp/free-form-custody-approval.json"
if (cd "$repo" && node scripts/verify/validate-public-bft-cutover-approval.mjs "$tmp/free-form-custody-approval.json" "$commit" "$release" "$custody_review") >/dev/null 2>&1; then
  echo "cutover approval with free-form custody evidence unexpectedly passed validation" >&2
  exit 1
fi
cp "$custody_review" "$tmp/tampered-custody-review.json"
printf ' ' >>"$tmp/tampered-custody-review.json"
chmod 600 "$tmp/tampered-custody-review.json"
if (cd "$repo" && node scripts/verify/validate-public-bft-cutover-approval.mjs "$tmp/approval.json" "$commit" "$release" "$tmp/tampered-custody-review.json") >/dev/null 2>&1; then
  echo "cutover approval with a tampered custody review unexpectedly passed validation" >&2
  exit 1
fi
node -e 'const fs=require("fs"),[i,o]=process.argv.slice(1),v=JSON.parse(fs.readFileSync(i));v.custodyReviewer=v.approver;fs.writeFileSync(o,JSON.stringify(v)+"\n",{mode:0o600})' "$tmp/approval.json" "$tmp/self-reviewed-approval.json"
if (cd "$repo" && node scripts/verify/validate-public-bft-cutover-approval.mjs "$tmp/self-reviewed-approval.json" "$commit" "$release" "$custody_review") >/dev/null 2>&1; then
  echo "self-reviewed cutover custody unexpectedly passed validation" >&2
  exit 1
fi
node -e 'const fs=require("fs"),[i,o]=process.argv.slice(1),v=JSON.parse(fs.readFileSync(i));v.approver="owner fixture";fs.writeFileSync(o,JSON.stringify(v)+"\n",{mode:0o600})' "$tmp/approval.json" "$tmp/owner-approved.json"
if (cd "$repo" && node scripts/verify/validate-public-bft-cutover-approval.mjs "$tmp/owner-approved.json" "$commit" "$release" "$custody_review") >/dev/null 2>&1; then
  echo "owner acting as transaction approver unexpectedly passed validation" >&2
  exit 1
fi

echo "public-bft-cutover-transaction-check passed: source-only stub, no service or transport; approval/custody remain commit-bound; fresh import precedes install and one explicit start; three pre-initialization failures restore baseline; six initialization/install failures, ten start-or-later failures and six retained attempts preserve original status/state/HRS without rollback or retry"
