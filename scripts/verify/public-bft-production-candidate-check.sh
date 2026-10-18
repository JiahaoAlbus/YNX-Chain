#!/usr/bin/env bash
set -Eeuo pipefail

cd "$(dirname "$0")/../.."

[[ "$#" == 0 || ( "$#" == 1 && "${1:-}" == --operator-caller-only ) ]] || { echo 'usage: public-bft-production-candidate-check.sh [--operator-caller-only]' >&2; exit 1; }
# The ordinary entry point and the retained selector run the same complete
# controls. Legacy fake-go deployment is no longer an accepted production mode.
bash -n scripts/ops/public-bft-production-driver.sh
bash -n scripts/ops/remote/public-bft-dependencies.sh
bash -n scripts/ops/remote/public-bft-ingress.sh
# Historical JSON-only guards remain covered without starting paused products.
node scripts/verify/validate-public-bft-dependency-continuity.mjs --self-test
node scripts/verify/validate-public-bft-public-continuity.mjs --self-test
  # These controls execute the production caller and binding reader. Only the
  # external already-verified runtime and SSH boundary are observed by stubs;
  # they do not claim ELF/package/ledger validity, service startup or deployment.
  node --input-type=module <<'NODE'
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
const root = process.cwd(), tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ynx-operator-caller-'));
const digest = b => crypto.createHash('sha256').update(b).digest('hex');
const driver = fs.readFileSync('scripts/ops/public-bft-production-driver.sh', 'utf8');
const extract = name => {
  const match = driver.match(new RegExp(`^${name}\\(\\) \\{\\n[\\s\\S]*?^\\}`, 'm'));
  assert.ok(match, `actual ${name} function missing`);
  return match[0];
};
const fullCommit = '123456789abc' + 'd'.repeat(28), commit = fullCommit.slice(0, 12);
const release = `ynx-bft-gateway-${commit}`, manifestPin = 'e'.repeat(64);
const roles = ['primary', 'singapore', 'silicon-valley', 'seoul'];
const write = (file, value, mode = 0o600) => { fs.mkdirSync(path.dirname(file), {recursive:true}); fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value)+'\n', {mode}); };
const q = value => "'" + value.replaceAll("'", "'\\''") + "'";
const bindingCLI = path.join(root, 'scripts/verify/public-bft-candidate-binding.mjs');
// The original rollback script is executed with transport that must never run.
// This preserves its real HRS refusal rather than a fake successful rollback.
const rollbackRoot=path.join(tmp,'rollback-source');
write(path.join(rollbackRoot,'scripts/ops/rollback-consensus-candidate.sh'),fs.readFileSync('scripts/ops/rollback-consensus-candidate.sh','utf8'),0o700);
write(path.join(rollbackRoot,'scripts/ops/lib.sh'),String.raw`
ynx_ops_init(){ :; }
ynx_ops_each_node(){ for r in primary singapore silicon-valley seoul; do "$1" "$r" u host key full; done; }
ynx_ops_ssh(){ echo 'forbidden rollback transport' >&2; return 99; }
ynx_ops_copy(){ echo 'forbidden rollback copy' >&2; return 99; }
`);
function node(args, expected = 0) {
  const p = spawnSync(process.execPath, args, {encoding:'utf8', maxBuffer:4<<20});
  if (expected === 0) assert.equal(p.status, 0, p.stderr); else assert.notEqual(p.status, 0, p.stdout);
  return p;
}
function fixture(name) {
  const dir = path.join(tmp, name), transaction = path.join(dir, 'cutover-caller-fixture');
  const planPath = path.join(dir,'operator.json'), validator = path.join(dir,'validators.json');
  const recordedAt = new Date(Math.floor(Date.now()/1000)*1000).toISOString().replace('.000Z','Z');
  const genesis = new Date(Date.parse(recordedAt)+600000).toISOString().replace('.000Z','Z');
  const expires = new Date(Date.parse(recordedAt)+3600000).toISOString().replace('.000Z','Z');
  const plan = {version:'YNX-PRODUCTION-OPERATOR/v1',chainId:'ynx_6423-1',stateLayout:'atomic-json',consensusGenesisSHA256:'a'.repeat(64),originalGenesisHash:'b'.repeat(64),migrationStateHash:'c'.repeat(64),pqSchedule:null,runtimePlan:null,roles:roles.map(role=>({role,home:`/original/${role}/home`,abciState:`/original/${role}/app/state.json`,legacyKeyPath:`/original/${role}/pv.json`,legacyStatePath:`/original/${role}/hrs.json`,nodeKeyPath:`/original/${role}/node.json`}))};
  write(planPath,plan); write(validator,{version:1,validators:roles.map(role=>({role}))});
  const planPin = digest(fs.readFileSync(planPath));
  const snapshot = {height:41,lastBlockHash:'b'.repeat(64),stateHash:'c'.repeat(64),accounts:[{address:'0x'+'1'.repeat(40),balance:100,nonce:0}]};
  write(path.join(transaction,'final-snapshot/migration.json'),snapshot);
  const snapshotPins={snapshotSourceSha256:'9'.repeat(64),exporterManifestSha256:'d'.repeat(64)};
  write(path.join(transaction,'final-snapshot/remote-evidence.json'),{transactionId:path.basename(transaction),commit,authoritativeRelease:`ynx-chain-${commit}`,bftRelease:release,...snapshot,sha256:digest(fs.readFileSync(path.join(transaction,'final-snapshot/migration.json'))),pauseVerified:true,mutationFreezeVerified:true,validated:true,sourceUnchanged:true,exporterCommit:fullCommit,...snapshotPins,recordedAt});
  const approval={schemaVersion:1,action:'ynx-public-bft-cutover',approved:true,approvalId:'fixture-approval',approver:'approver',custodyReviewer:'custodian',custodyEvidence:'sha256:'+'1'.repeat(64),owner:'original owner',ownerHandoverReviewer:'separate reviewer',ownerHandoverInventoryDigest:'sha256:'+'2'.repeat(64),ownerHandoverInventoryEvidence:'sha256:'+'3'.repeat(64),ownerHandoverReceiptEvidence:'sha256:'+'4'.repeat(64),commit,release,publicCutoverAuthorized:true,automaticRollbackRequired:true,validatorKeyRecoveryVerified:true,serviceSignerRecoveryVerified:true,ownerHandoverVerified:true,rotationProcedureVerified:true,serviceSignerManifestSha256:'5'.repeat(64),candidateGenesisTime:genesis,validatorManifestSha256:digest(fs.readFileSync(validator)),operatorPlanSha256:planPin,runtimeManifestSha256:manifestPin,expiresAt:expires};
  Object.assign(approval,snapshotPins);
  write(path.join(transaction,'approval.json'),approval);
  const log=path.join(dir,'calls.jsonl'), tool=path.join(dir,'package-boundary');
  write(tool,`#!${process.execPath}\n`+String.raw`
const fs=require('fs'),path=require('path'),a=process.argv.slice(2);
fs.appendFileSync(process.env.CALL_LOG,JSON.stringify(a)+'\n');
if(process.env.FAIL_VERIFIER==='yes')process.exit(43);
const value=k=>{const i=a.indexOf(k);if(i<0||a.lastIndexOf(k)!==i||!a[i+1])throw Error(k);return a[i+1]};
if(value('-operator-plan-hash')!==process.env.EXPECTED_PLAN_PIN)throw Error('external operator pin lost');
if(a[0]==='-verify-package'){if(a.length!==4)throw Error('verify argv');process.exit(0)}
if(a.length!==12||value('-operator-plan')!==process.env.PUBLIC_BFT_PRODUCTION_OPERATOR_PLAN||value('-migration-state')!==process.env.PUBLIC_BFT_CUTOVER_TRANSACTION_DIR+'/final-snapshot/migration.json'||value('-validator-manifest')!==process.env.PUBLIC_BFT_PRODUCTION_VALIDATOR_MANIFEST)throw Error('generation argv');
const out=value('-output');fs.mkdirSync(out);fs.writeFileSync(out+'/package-manifest.json',JSON.stringify({operatorProfile:'YNX-PRODUCTION-OPERATOR/v1',operatorPlanHash:process.env.EXPECTED_PLAN_PIN,genesisTime:value('-genesis-time'),chainId:'ynx_6423-1',roles:['primary','singapore','silicon-valley','seoul'],genesisHash:'a'.repeat(64),migrationStateHash:'c'.repeat(64)})+'\n');
for(const role of ['primary','singapore','silicon-valley','seoul'])for(const file of ['scripts/start-operator.sh','scripts/backup-candidate.sh','role-manifest.json','systemd/ynx-consensus-operator-candidate.service','config/bound-migration.json','config/genesis.json']){const p=out+'/roles/'+role+'/'+file;fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,'caller-only fixture\n')}
`,0o700);
  const env={...process.env,PUBLIC_BFT_CUTOVER_COMMIT:commit,PUBLIC_BFT_CUTOVER_RELEASE:release,PUBLIC_BFT_CUTOVER_TRANSACTION_DIR:transaction,PUBLIC_BFT_PRODUCTION_CANDIDATE_APPROVED:'yes',PUBLIC_BFT_PRODUCTION_VALIDATOR_MANIFEST:validator,PUBLIC_BFT_PRODUCTION_CANDIDATE_GENESIS_TIME:genesis,PUBLIC_BFT_PRODUCTION_OPERATOR_PLAN:planPath,PUBLIC_BFT_PRODUCTION_OPERATOR_PLAN_SHA256:planPin,CONSENSUS_CANDIDATE_RUNTIME_BUNDLE:path.join(dir,'original-runtime'),CONSENSUS_CANDIDATE_RUNTIME_COMMIT:fullCommit,CONSENSUS_CANDIDATE_RUNTIME_MANIFEST_SHA256:manifestPin,EXPECTED_PLAN_PIN:planPin,CALL_LOG:log,BOUNDARY_TOOL:tool,FAIL_TRANSPORT:'no'};
  fs.mkdirSync(env.CONSENSUS_CANDIDATE_RUNTIME_BUNDLE);
  write(path.join(env.CONSENSUS_CANDIDATE_RUNTIME_BUNDLE,'original-marker'),'original 0644 bytes',0o644);
  return {dir,transaction,planPath,plan,planPin,validator,genesis,approval,env,log};
}
const harness=path.join(tmp,'caller.sh');
write(harness,`#!/usr/bin/env bash\nset -Eeuo pipefail\ncommit=${q(commit)}\nrelease=ynx-chain-${commit}\n` +
  ['public_bft_runtime_prepare','public_bft_operator_inputs','candidate_context','prepare_candidate_package','validated_candidate_initialization','deploy_candidate_phase','collect_candidate_original_guard','candidate_original_guard_command','initialize_candidate_phase','start_candidate_phase','verify_candidate_phase','rollback_candidate_phase','dependency_context','validated_candidate_result','gateway_runtime_pins','gateway_helper_command','gateway_dry_receipt','validated_gateway_start','start_dependencies_phase','verify_continuity_phase','rollback_dependencies_phase','ingress_context','validated_continuity_result','gateway_ingress_phase','switch_ingress_phase','rollback_ingress_phase','verify_public_phase','gateway_recovery_phase','recovery_phase','authoritative_production_phase','mutation_freeze_phase'].map(extract).join('\n')+String.raw`
PRIMARY_NODE_USER=u
PRIMARY_NODE_HOST=host
PRIMARY_NODE_SSH_KEY=key
uname(){ if [[ "$1" == -s ]]; then echo Linux; else echo x86_64; fi; }
git(){ [[ "$*" == 'rev-parse HEAD' ]] || return 91; printf '%s\n' "$CONSENSUS_CANDIDATE_RUNTIME_COMMIT"; }
validate_runtime_bundle(){ [[ "$#" == 3 && "$1" == "$CONSENSUS_CANDIDATE_RUNTIME_BUNDLE" && "$2" == "$CONSENSUS_CANDIDATE_RUNTIME_COMMIT" && "$3" == "$CONSENSUS_CANDIDATE_RUNTIME_MANIFEST_SHA256" ]] || return 92; printf 'validate\n' >>"$CALL_LOG.runtime"; }
prepare_runtime_bundle(){ [[ "$#" == 4 && "$1" == "$CONSENSUS_CANDIDATE_RUNTIME_BUNDLE" && "$2" == "$CONSENSUS_CANDIDATE_RUNTIME_COMMIT" && "$3" == "$CONSENSUS_CANDIDATE_RUNTIME_MANIFEST_SHA256" ]] || return 93; mkdir -m 0700 "$4"; cp "$BOUNDARY_TOOL" "$4/ynx-consensus-package"; chmod 0700 "$4/ynx-consensus-package"; printf 'not ELF (caller fixture only)\n' >"$4/ynx-comet"; cp "$4/ynx-comet" "$4/ynx-consensus-keycheck"; cp "$4/ynx-comet" "$4/ynx-bft-gatewayd"; cp "$CONSENSUS_CANDIDATE_RUNTIME_BUNDLE/original-marker" "$4/SOURCE.json"; }
ynx_ops_each_node(){ local cb="$1"; for r in primary singapore silicon-valley seoul; do "$cb" "$r" u host key full; done; }
ynx_ops_ssh(){ printf '%s\n' "$5" >>"$CALL_LOG.transport"; if [[ "$FAIL_TRANSPORT" == yes || ( "$FAIL_TRANSPORT" == partial && "$1" == singapore && "$5" == *'timeout 30s systemctl start'* ) ]]; then return 42; fi; }
ynx_ops_copy(){ test -s "$5"; printf 'copy %s\n' "$6" >>"$CALL_LOG.transport"; }
bash(){
  case "$1" in
    scripts/deploy/deploy-consensus-candidate.sh)
      [[ "$CONSENSUS_CANDIDATE_APPROVED" == yes && "$CONSENSUS_CANDIDATE_PACKAGE" == "$PUBLIC_BFT_CUTOVER_TRANSACTION_DIR/candidate/package" && "$CONSENSUS_CANDIDATE_OPERATOR_PLAN_SHA256" == "$EXPECTED_PLAN_PIN" ]] || return 95
      printf 'install boundary only\n' >>"$CALL_LOG.boundary" ;;
    scripts/verify/verify-consensus-candidate.sh)
      [[ "$CONSENSUS_CANDIDATE_PACKAGE" == "$PUBLIC_BFT_CUTOVER_TRANSACTION_DIR/candidate/package" ]] || return 96
      printf 'read-only verify boundary only\n' >>"$CALL_LOG.boundary" ;;
    scripts/ops/rollback-consensus-candidate.sh) command bash "$ROLLBACK_FIXTURE_SCRIPT" ;;
    *) echo 'unexpected bash boundary' >&2; return 97 ;;
  esac
}
case "$1" in prepare) prepare_candidate_package ;; initialize) initialize_candidate_phase ;; deploy) deploy_candidate_phase ;; start) start_candidate_phase ;; verify) verify_candidate_phase ;; rollback) rollback_candidate_phase ;; gateway) start_dependencies_phase ;; continuity) verify_continuity_phase ;; rollback-gateway) rollback_dependencies_phase ;; ingress) switch_ingress_phase ;; rollback-ingress) rollback_ingress_phase ;; public) verify_public_phase ;; recovery) recovery_phase ;; resume) authoritative_production_phase resume ;; unfreeze) mutation_freeze_phase unfreeze ;; *) exit 94 ;; esac
`,0o700);
function run(f,action='prepare',change={},expected=0){
  const p=spawnSync('bash',[harness,action],{cwd:root,env:{...f.env,ROLLBACK_FIXTURE_SCRIPT:path.join(rollbackRoot,'scripts/ops/rollback-consensus-candidate.sh'),...change},encoding:'utf8',maxBuffer:4<<20});
  if(expected===0)assert.equal(p.status,0,p.stderr);else assert.notEqual(p.status,0,p.stdout);
  return p;
}
function originals(f){return [f.planPath,f.validator,path.join(f.transaction,'approval.json'),path.join(f.transaction,'final-snapshot/migration.json'),path.join(f.transaction,'final-snapshot/remote-evidence.json'),path.join(f.env.CONSENSUS_CANDIDATE_RUNTIME_BUNDLE,'original-marker')].map(p=>[p,fs.readFileSync(p)]);}
const unchanged=before=>before.forEach(([p,b])=>assert.deepEqual(fs.readFileSync(p),b,`original changed: ${p}`));
try {
  const scoped=fixture('single-app-custody');
  scoped.approval.custodyProfile='single-app-gateway/v1';delete scoped.approval.serviceSignerRecoveryVerified;delete scoped.approval.serviceSignerManifestSha256;
  write(path.join(scoped.transaction,'approval.json'),scoped.approval);const scopedBefore=originals(scoped);run(scoped);
  const scopedBinding=JSON.parse(fs.readFileSync(path.join(scoped.transaction,'candidate/binding.json')));
  assert.equal(scopedBinding.custodyProfile,'single-app-gateway/v1');assert.equal(Object.hasOwn(scopedBinding,'serviceSignerManifestSha256'),false);unchanged(scopedBefore);
  for(const [field,value]of [['custodyProfile','unknown'],['custodyProfile',null],['serviceSignerRecoveryVerified',true],['validatorKeyRecoveryVerified',false],['ownerHandoverVerified',false],['rotationProcedureVerified',false]]){
    const x=fixture('single-app-negative-'+field+'-'+String(value));x.approval.custodyProfile='single-app-gateway/v1';delete x.approval.serviceSignerRecoveryVerified;delete x.approval.serviceSignerManifestSha256;x.approval[field]=value;
    write(path.join(x.transaction,'approval.json'),x.approval);const saved=originals(x);run(x,'prepare',{},1);assert.equal(fs.existsSync(x.log),false);assert.equal(fs.existsSync(x.log+'.transport'),false);unchanged(saved);
  }
  const f=fixture('normal'),before=originals(f);run(f);
  const binding=path.join(f.transaction,'candidate/binding.json'), raw=fs.readFileSync(binding), b=JSON.parse(raw);
  assert.equal(b.schemaVersion,2); assert.equal(b.operatorPlanSha256,f.planPin);assert.equal(b.runtimeCommit,fullCommit);assert.equal(b.runtimeManifestSha256,manifestPin);
  const calls=fs.readFileSync(f.log,'utf8').trim().split('\n').map(JSON.parse);
  assert.deepEqual(calls[0],['-migration-state',path.join(f.transaction,'final-snapshot/migration.json'),'-validator-manifest',f.validator,'-genesis-time',f.genesis,'-operator-plan',f.planPath,'-operator-plan-hash',f.planPin,'-output',path.join(f.transaction,'candidate/package')]);
  assert.deepEqual(calls[1],['-verify-package',path.join(f.transaction,'candidate/package'),'-operator-plan-hash',f.planPin]);
  run(f); assert.deepEqual(fs.readFileSync(binding),raw);unchanged(before);
  const callsBeforeReject=fs.readFileSync(f.log,'utf8').trim().split('\n').length;
  run(f,'prepare',{FAIL_VERIFIER:'yes'},1);assert.equal(fs.readFileSync(f.log,'utf8').trim().split('\n').length,callsBeforeReject+1,'verifier rejection was retried/fell back');assert.deepEqual(fs.readFileSync(binding),raw);unchanged(before);
  for(const [name,changes]of Object.entries({missingPlan:{PUBLIC_BFT_PRODUCTION_OPERATOR_PLAN:''},missingPin:{PUBLIC_BFT_PRODUCTION_OPERATOR_PLAN_SHA256:''},wrongPin:{PUBLIC_BFT_PRODUCTION_OPERATOR_PLAN_SHA256:'9'.repeat(64)},missingRuntime:{CONSENSUS_CANDIDATE_RUNTIME_COMMIT:''},wrongRuntimePin:{CONSENSUS_CANDIDATE_RUNTIME_MANIFEST_SHA256:'8'.repeat(64)}})){
    const x=fixture(name),saved=originals(x);run(x,'prepare',changes,1);assert.equal(fs.existsSync(x.log),false,'verifier ran before admission');assert.equal(fs.existsSync(path.join(x.transaction,'candidate')),false);unchanged(saved);
  }
  const noApproval=fixture('approvalMissingPin');delete noApproval.approval.operatorPlanSha256;write(path.join(noApproval.transaction,'approval.json'),noApproval.approval);run(noApproval,'prepare',{},1);assert.equal(fs.existsSync(noApproval.log),false);
  for(const field of ['snapshotSourceSha256','exporterManifestSha256']){
    for(const [label,value] of [['missing',undefined],['zero','0'.repeat(64)],['different','f'.repeat(64)],['array',['9'.repeat(64)]]]){
      const x=fixture(`snapshot-approval-${field}-${label}`);
      if(value===undefined)delete x.approval[field];else x.approval[field]=value;
      write(path.join(x.transaction,'approval.json'),x.approval);const saved=originals(x);
      run(x,'prepare',{},1);assert.equal(fs.existsSync(x.log),false,'snapshot approval mismatch reached verifier');
      assert.equal(fs.existsSync(x.log+'.transport'),false);unchanged(saved);
    }
  }
  for(const [field,value] of [['sourceUnchanged',false],['sourceUnchanged','true'],['sourceUnchanged',undefined],['exporterCommit',fullCommit.slice(0,12)+'e'.repeat(28)],['exporterCommit',undefined],['snapshotSourceSha256','f'.repeat(64)],['exporterManifestSha256','f'.repeat(64)],['snapshotSourceSha256',undefined],['exporterManifestSha256',undefined]]){
    const x=fixture(`snapshot-evidence-${field}-${value===undefined?'missing':String(value)}`);
    const file=path.join(x.transaction,'final-snapshot/remote-evidence.json'),evidence=JSON.parse(fs.readFileSync(file));
    if(value===undefined)delete evidence[field];else evidence[field]=value;
    write(file,evidence);const saved=originals(x);run(x,'prepare',{},1);
    assert.equal(fs.existsSync(x.log),false,'unqualified snapshot evidence reached verifier');
    assert.equal(fs.existsSync(x.log+'.transport'),false);unchanged(saved);
  }
  for(const [name,field,value]of [
    ['wrongOperatorApproval','operatorPlanSha256','7'.repeat(64)],['wrongRuntimeApproval','runtimeManifestSha256','6'.repeat(64)],
    ['notApproved','approved',false],['noRollbackConsent','automaticRollbackRequired',false],
    ['sameCustodian','custodyReviewer','approver'],['sameOwnerReviewer','ownerHandoverReviewer','original owner'],
    ['missingRecovery','validatorKeyRecoveryVerified',false],['missingSignerRecovery','serviceSignerRecoveryVerified',false],
    ['missingOwnerHandover','ownerHandoverVerified',false],['missingRotation','rotationProcedureVerified',false]
  ]){const x=fixture(name);x.approval[field]=value;write(path.join(x.transaction,'approval.json'),x.approval);const saved=originals(x);run(x,'prepare',{},1);assert.equal(fs.existsSync(x.log),false);assert.equal(fs.existsSync(x.log+'.transport'),false);unchanged(saved);}
  const unapproved=fixture('separateCandidateApproval'),unapprovedBefore=originals(unapproved);run(unapproved,'prepare',{PUBLIC_BFT_PRODUCTION_CANDIDATE_APPROVED:'no'},1);assert.equal(fs.existsSync(unapproved.log),false);unchanged(unapprovedBefore);
  for(const which of ['snapshot','validator','sourceIdentity','privateValidator']){
    const x=fixture(which),migration=path.join(x.transaction,'final-snapshot/migration.json'),evidence=path.join(x.transaction,'final-snapshot/remote-evidence.json');
    if(which==='snapshot')fs.appendFileSync(migration,'\n');
    if(which==='validator')fs.appendFileSync(x.validator,'\n');
    if(which==='sourceIdentity'){const v=JSON.parse(fs.readFileSync(evidence));v.authoritativeRelease='ynx-chain-'+ '0'.repeat(12);write(evidence,v);}
    if(which==='privateValidator'){const v=JSON.parse(fs.readFileSync(x.validator));v.privateKey='forbidden-public-field';write(x.validator,v);x.approval.validatorManifestSha256=digest(fs.readFileSync(x.validator));write(path.join(x.transaction,'approval.json'),x.approval);}
    const saved=originals(x);run(x,'prepare',{},1);assert.equal(fs.existsSync(x.log),false);unchanged(saved);
  }
  const pkg=path.join(f.transaction,'candidate/package/package-manifest.json'),validPackage=fs.readFileSync(pkg),legacy=JSON.parse(validPackage);delete legacy.operatorProfile;delete legacy.operatorPlanHash;write(pkg,legacy);const legacyBytes=fs.readFileSync(pkg);run(f,'prepare',{},1);assert.deepEqual(fs.readFileSync(pkg),legacyBytes);assert.deepEqual(fs.readFileSync(binding),raw);fs.writeFileSync(pkg,validPackage);
  fs.appendFileSync(pkg,'\n');const changedPackage=fs.readFileSync(pkg);run(f,'prepare',{},1);assert.deepEqual(fs.readFileSync(pkg),changedPackage);assert.deepEqual(fs.readFileSync(binding),raw);fs.writeFileSync(pkg,validPackage);
  const preflight=(plan,pin,role='primary')=>node([bindingCLI,'--operator-preflight',plan,pin,role]).stdout;
  const localCommand=preflight(f.planPath,f.planPin);assert.ok(localCommand.includes('/original/primary/pv.json'));assert.ok(localCommand.includes('/original/primary/hrs.json'));assert.ok(!localCommand.includes('/etc/ynx/consensus-candidate'));
  const freshCommand=node([bindingCLI,'--operator-preflight',f.planPath,f.planPin,'primary','fresh']).stdout;assert.ok(freshCommand.includes("sudo test ! -e '/original/primary/app'"));assert.ok(!freshCommand.includes("sudo test -s '/original/primary/app/state.json'"));
  const remote=fixture('remote');remote.plan.pqSchedule='cHVibGlj';remote.plan.roles.forEach(r=>Object.assign(r,{hostBinding:{publicOnly:true},remoteSigner:'tcp://signer:1234',signerPeerPublicKey:'f'.repeat(64),transportKeyPath:`/original/${r.role}/transport.json`}));write(remote.planPath,remote.plan);const remotePin=digest(fs.readFileSync(remote.planPath));const remoteCommand=preflight(remote.planPath,remotePin);assert.ok(remoteCommand.includes('/original/primary/transport.json'));assert.ok(!remoteCommand.includes('/original/primary/pv.json'));assert.ok(!remoteCommand.includes('/original/primary/hrs.json'));
  node([bindingCLI,'--operator-preflight',remote.planPath,f.planPin,'primary'],1);
  node([bindingCLI,'--initialization-command',remote.planPath,remotePin,'primary','/stage/primary'],1);
  const importer=node([bindingCLI,'--initialization-command',f.planPath,f.planPin,'primary','/stage/primary']).stdout;
  for(const flag of ['--consensus-genesis','--migration-state','--abci-state','--abci-state-layout','--consensus-genesis-sha256','--original-genesis-hash','--bound-migration-state-hash'])assert.ok(importer.includes(`'${flag}'`));
  assert.ok(importer.includes("sudo -u ynx env -i PATH=/usr/bin:/bin '/stage/primary/ynx-comet' initialize-application"));assert.ok(!importer.includes('--home'));assert.ok(!importer.includes('private-key'));
  run(f,'initialize',{DEPLOY_DRY_RUN:'1'},1);assert.equal(fs.existsSync(path.join(f.transaction,'candidate/initialize-attempt')),false);
  run(f,'initialize',{DEPLOY_DRY_RUN:'1',PUBLIC_BFT_PRODUCTION_INITIALIZATION_APPROVED:'yes'});
  const initResult=path.join(f.transaction,'candidate/initialize-attempt/result.json'),initRaw=fs.readFileSync(initResult);assert.equal(JSON.parse(initRaw).imported,false);assert.equal(JSON.parse(initRaw).runtimeStarted,false);
  const initCalls=fs.readFileSync(f.log+'.transport','utf8');assert.equal((initCalls.match(/ initialize-application /g)||[]).length,4);assert.ok(!initCalls.includes('systemctl start'));assert.ok(!initCalls.includes('rm -'));
  run(f,'resume',{DEPLOY_DRY_RUN:'1'},1);run(f,'unfreeze',{DEPLOY_DRY_RUN:'1'},1);assert.equal(fs.readFileSync(f.log+'.transport','utf8'),initCalls,'uncertain import resumed/unfroze the native writer');
  run(f,'initialize',{DEPLOY_DRY_RUN:'1',PUBLIC_BFT_PRODUCTION_INITIALIZATION_APPROVED:'yes'},1);assert.deepEqual(fs.readFileSync(initResult),initRaw);assert.equal(fs.readFileSync(f.log+'.transport','utf8'),initCalls);unchanged(before);
  const receipt=path.join(f.dir,'initializer-receipt.json');write(receipt,{version:'YNX-APPLICATION-INITIALIZATION/v1',statePath:f.plan.roles[0].abciState,stateLayout:f.plan.stateLayout,migrationStateHash:f.plan.migrationStateHash,height:'41',appHash:f.plan.migrationStateHash,stateSHA256:'1'.repeat(64),coldReadVerified:true,initialized:false,deployed:false,pqActivated:false});
  const receiptArgs=[bindingCLI,'--initialization-result',f.transaction,binding,f.planPath,f.planPin,'primary',receipt];node(receiptArgs);const receiptOriginal=fs.readFileSync(receipt);const badReceipt=JSON.parse(receiptOriginal);badReceipt.initialized=true;write(receipt,badReceipt);node(receiptArgs,1);fs.writeFileSync(receipt,receiptOriginal);
  const identity={transactionId:path.basename(f.transaction),commit,authoritativeRelease:`ynx-chain-${commit}`,bftRelease:release,role:'primary'};
  const ev=path.join(f.dir,'evidence'),marker={...identity,frozenAt:new Date(Math.floor(Date.now()/1000)*1000).toISOString().replace('.000Z','Z')};
  write(path.join(ev,'marker.json'),marker);write(path.join(ev,'backup.json'),{...identity,validated:true,sha256:'a'.repeat(64)});write(path.join(ev,'freeze.json'),{...identity,operation:'freeze',readStatus:200,readEvm:200,mutationStateVerified:true,markerPath:'/var/lib/ynx-chain/mutation-freeze.json',markerSha256:digest(fs.readFileSync(path.join(ev,'marker.json')))});
  const {role:ignored,...pauseIdentity}=identity;write(path.join(ev,'pause-marker.json'),{...pauseIdentity,pausedAt:marker.frozenAt});write(path.join(ev,'pause.json'),{...pauseIdentity,operation:'pause',readsOnline:true,productionStateVerified:true,pauseMarker:'/var/lib/ynx-chain/block-production-pause.json',markerSha256:digest(fs.readFileSync(path.join(ev,'pause-marker.json'))),heightBefore:41,heightAfter:41});
  const evArgs=[bindingCLI,'--activation-evidence',f.transaction,binding,'primary',ev];node(evArgs);
  for(const [file,field,value]of [['backup.json','commit','0'.repeat(12)],['freeze.json','markerSha256','0'.repeat(64)],['marker.json','schemaVersion',2],['pause.json','heightAfter',42]]){const p=path.join(ev,file),original=fs.readFileSync(p),v=JSON.parse(original);v[field]=value;write(p,v);node(evArgs,1);assert.deepEqual(fs.readFileSync(p),Buffer.from(JSON.stringify(v)+'\n'));fs.writeFileSync(p,original)}
  // Normal install caller requires an exact initializer receipt. Its external
  // installer is a boundary observer here; no fake-go/ELF success is asserted.
  const beforeDeploy=fs.readFileSync(f.log+'.transport');
  run(f,'deploy',{DEPLOY_DRY_RUN:'0'},1);assert.equal(fs.existsSync(f.log+'.boundary'),false);assert.deepEqual(fs.readFileSync(f.log+'.transport'),beforeDeploy);
  run(f,'deploy',{DEPLOY_DRY_RUN:'1'});
  const deployPath=path.join(f.transaction,'candidate/deploy-result.json'),deployRaw=fs.readFileSync(deployPath),deploy=JSON.parse(deployRaw);
  assert.equal(deploy.deployed,true);assert.equal(deploy.runtimeStarted,false);assert.equal(deploy.dryRun,true);assert.equal(deploy.bindingSha256,digest(raw));
  const installCalls=fs.readFileSync(f.log+'.boundary');run(f,'deploy',{DEPLOY_DRY_RUN:'1'});assert.deepEqual(fs.readFileSync(f.log+'.boundary'),installCalls);assert.deepEqual(fs.readFileSync(deployPath),deployRaw);
  const walk=dir=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)):[path.join(dir,e.name)]);
  const archives=walk(path.join(f.transaction,'candidate')).filter(p=>p.endsWith('.tar.gz'));assert.equal(archives.length,4);for(const p of archives)assert.equal(fs.statSync(p).mode&0o077,0,'public staging archive must remain private');
  run(f,'start',{DEPLOY_DRY_RUN:'1'},1);assert.equal(fs.existsSync(path.join(f.transaction,'candidate/start-attempt')),false,'missing start approval mutated attempt');
  run(f,'verify',{DEPLOY_DRY_RUN:'0'},1); // no real start; cannot use dry install
  run(f,'start',{DEPLOY_DRY_RUN:'1',PUBLIC_BFT_PRODUCTION_CANDIDATE_START_APPROVED:'yes'});
  const startPath=path.join(f.transaction,'candidate/start-attempt/result.json'),startRaw=fs.readFileSync(startPath),result=JSON.parse(startRaw);
  assert.equal(result.started,false);assert.equal(result.dryRun,true);assert.equal(result.pqActivationVerified,false);
  const transport=fs.readFileSync(f.log+'.transport','utf8');assert.equal((transport.match(/timeout 30s systemctl start/g)||[]).length,4);assert.ok(!transport.includes('enable --now'));assert.ok(!transport.includes('ynx-ai-gatewayd'));assert.ok(transport.includes('ynx-consensus-operator-candidate.service'));
  run(f,'start',{DEPLOY_DRY_RUN:'1',PUBLIC_BFT_PRODUCTION_CANDIDATE_START_APPROVED:'yes'},1);assert.deepEqual(fs.readFileSync(startPath),startRaw);assert.equal(fs.readFileSync(f.log+'.transport','utf8'),transport,'UNKNOWN/start was retried');unchanged(before);
  run(f,'verify',{DEPLOY_DRY_RUN:'1'});const dryVerified=JSON.parse(fs.readFileSync(path.join(f.transaction,'candidate/verify-result.json')));assert.equal(dryVerified.verified,false);assert.equal(dryVerified.dryRun,true);
  const phaseEnv={DEPLOY_DRY_RUN:'1',PUBLIC_BFT_PRODUCTION_DEPENDENCIES_APPROVED:'yes',PUBLIC_BFT_PRODUCTION_INGRESS_APPROVED:'yes'};
  run(f,'gateway',{...phaseEnv,PUBLIC_BFT_PRODUCTION_DEPENDENCIES_APPROVED:'no'},1);
  run(f,'gateway',{...phaseEnv,PUBLIC_BFT_PRODUCTION_DEPENDENCY_MODE:'legacy'},1);
  const verifyFile=path.join(f.transaction,'candidate/verify-result.json'),verifyBytes=fs.readFileSync(verifyFile);fs.unlinkSync(verifyFile);run(f,'gateway',phaseEnv,1);fs.writeFileSync(verifyFile,verifyBytes,{mode:0o600});assert.equal(fs.existsSync(path.join(f.transaction,'dependencies/start-attempt')),false);
  run(f,'gateway',phaseEnv);const gatewayPath=path.join(f.transaction,'dependencies/start-result.json'),gatewayRaw=fs.readFileSync(gatewayPath),gateway=JSON.parse(gatewayRaw);
  assert.equal(gateway.mode,'single-app-gateway');assert.equal(gateway.dependenciesActive,false);assert.equal(gateway.publicIngressChanged,false);assert.equal(gateway.backupSHA256,'unobserved-dry-run');assert.equal(gateway.runtimeCommit,fullCommit);
  const gatewayTransport=fs.readFileSync(f.log+'.transport');run(f,'gateway',phaseEnv,1);assert.deepEqual(fs.readFileSync(f.log+'.transport'),gatewayTransport);assert.deepEqual(fs.readFileSync(gatewayPath),gatewayRaw);
  const gatewayCommand=fs.readFileSync(path.join(f.transaction,'dependencies/start-attempt/command.sh'),'utf8');
  assert.ok(gatewayCommand.includes("'single-app-gateway'"));assert.ok(gatewayCommand.includes(fullCommit));assert.ok(gatewayCommand.includes(f.planPin));assert.ok(gatewayCommand.includes(manifestPin));assert.ok(!/AI_SIGNER|PAY_SIGNER|TRUST_SIGNER|faucet\.key|ynx-ai-gatewayd|2762[6-9]|2763[0-2]/.test(gatewayCommand));
  assert.equal(fs.statSync(path.join(f.transaction,'dependencies/start-attempt/gateway-runtime.tar.gz')).mode&0o077,0);
  for(const [field,value]of [['migrationBlockHash','f'.repeat(64)],['operatorPlanSHA256','9'.repeat(64)],['runtimeSOURCEsha256','8'.repeat(64)],['mode','legacy']]){write(gatewayPath,{...gateway,[field]:value});run(f,'continuity',phaseEnv,1);assert.equal(fs.existsSync(path.join(f.transaction,'dependencies/continuity')),false);fs.writeFileSync(gatewayPath,gatewayRaw);}
  run(f,'continuity',phaseEnv);const continuityPath=path.join(f.transaction,'dependencies/continuity-result.json'),continuityRaw=fs.readFileSync(continuityPath),continuity=JSON.parse(continuityRaw);assert.equal(continuity.verified,false);assert.equal(continuity.ecosystemContinuityVerified,false);
  const observed=fs.readFileSync(path.join(f.transaction,'dependencies/continuity/gateway-before-health.json'));run(f,'continuity',phaseEnv,1);assert.deepEqual(fs.readFileSync(path.join(f.transaction,'dependencies/continuity/gateway-before-health.json')),observed);assert.deepEqual(fs.readFileSync(continuityPath),continuityRaw);
  run(f,'ingress',{...phaseEnv,PUBLIC_BFT_PRODUCTION_INGRESS_APPROVED:'no'},1);assert.equal(fs.existsSync(path.join(f.transaction,'ingress/switch-attempt')),false);
  write(continuityPath,{...continuity,runtimeSOURCEsha256:'9'.repeat(64)});run(f,'ingress',phaseEnv,1);fs.writeFileSync(continuityPath,continuityRaw);assert.equal(fs.existsSync(path.join(f.transaction,'ingress/switch-attempt')),false);
  run(f,'ingress',phaseEnv);const ingressPath=path.join(f.transaction,'ingress/switch-result.json'),ingressRaw=fs.readFileSync(ingressPath),ingress=JSON.parse(ingressRaw);assert.equal(ingress.rpcOnly,true);assert.equal(ingress.publicIngressChanged,false);assert.equal(ingress.ecosystemContinuityVerified,false);
  const ingressTransport=fs.readFileSync(f.log+'.transport');run(f,'ingress',phaseEnv,1);assert.deepEqual(fs.readFileSync(f.log+'.transport'),ingressTransport);assert.deepEqual(fs.readFileSync(ingressPath),ingressRaw);
  run(f,'public',phaseEnv);const publicResult=JSON.parse(fs.readFileSync(path.join(f.transaction,'ingress/public-result.json')));assert.equal(publicResult.verified,false);assert.equal(publicResult.publicIngressChanged,false);assert.equal(publicResult.ecosystemContinuityVerified,false);const endpoints=fs.readFileSync(path.join(f.transaction,'ingress/public-continuity/endpoints.txt'),'utf8');assert.ok(endpoints.includes('rpc.ynxweb4.com'));assert.ok(!/ai\.ynx|pay\.ynx|trust\.ynx|explorer\.ynx/.test(endpoints));
  run(f,'recovery',phaseEnv);const recovery=JSON.parse(fs.readFileSync(path.join(f.transaction,'recovery-gateway/result.json')));assert.equal(recovery.nativeProducerResumed,false);assert.equal(recovery.verified,false);run(f,'resume',phaseEnv,1);
  run(f,'unfreeze',phaseEnv);const unfreezeTransport=fs.readFileSync(f.log+'.transport','utf8');assert.ok(unfreezeTransport.includes('http://127.0.0.1:6420,http://127.0.0.1:27620'));assert.ok(!/:642[89]|:643[0-2]/.test(unfreezeTransport));
  run(f,'rollback-ingress',phaseEnv);assert.equal(JSON.parse(fs.readFileSync(path.join(f.transaction,'ingress/rollback-result.json'))).ingress,'authoritative');run(f,'rollback-ingress',phaseEnv,1);
  run(f,'rollback-gateway',phaseEnv);const rollbackGateway=JSON.parse(fs.readFileSync(path.join(f.transaction,'dependencies/rollback-result.json')));assert.equal(rollbackGateway.originalMaterialRetained,true);assert.equal(rollbackGateway.gatewayStopped,false);run(f,'rollback-gateway',phaseEnv,1);unchanged(before);
  // Pure receipt/source controls use synthetic public JSON. They do not claim
  // process/inode observation; the remote-helper regression owns that boundary.
  const proofDir=path.join(f.dir,'source-controls'),realStart={...gateway,version:'YNX-SINGLE-APP-GATEWAY-START/v1',dryRun:false,dependenciesActive:true,backupSHA256:'a'.repeat(64),unitSHA256:'1'.repeat(64),launcherSHA256:'2'.repeat(64),environmentSHA256:'3'.repeat(64),mainPid:'123',runningExecutableSHA256:gateway.gatewaySHA256,runningExecutableDeviceInode:'2049:12345'};
  const health=h=>({ok:true,service:'ynx-bft-gatewayd',mode:'cometbft-backed',truthfulStatus:'cometbft-rpc-and-abci-backed',chainId:6423,nativeSymbol:'YNXT',cometChainId:'ynx_6423-1',validatorCount:4,publicCutoverReady:false,build:{commit,release},migrationHeight:41,migrationBlockHash:'b'.repeat(64),height:h});
  const status={chainId:6423,nativeCurrencySymbol:'YNXT',consensusEngine:'cometbft',cometChainId:'ynx_6423-1',truthfulStatus:'cometbft-rpc-and-abci-backed',validatorCount:4,publicCutoverReady:false,migrationHeight:41,migrationBlockHash:'b'.repeat(64),earliestBlockHeight:42,earliestBlockHash:'d'.repeat(64),height:44};
  write(path.join(proofDir,'start.json'),realStart);write(path.join(proofDir,'before.json'),health(43));write(path.join(proofDir,'after.json'),health(44));write(path.join(proofDir,'gateway-status.json'),status);
  const observeArgs=[bindingCLI,'--gateway-observe',binding,...['start.json','before.json','after.json','gateway-status.json'].map(n=>path.join(proofDir,n))];const observedJSON=node(observeArgs).stdout;assert.equal(JSON.parse(observedJSON).source,'configured-comet-rpc');assert.equal(JSON.parse(observedJSON).independentFinalityVerified,false);
  for(const [file,field,value]of [['start.json','runningExecutableSHA256','f'.repeat(64)],['after.json','height',43],['after.json','migrationBlockHash','f'.repeat(64)],['after.json','chainId',1],['gateway-status.json','earliestBlockHeight',41]]){const p=path.join(proofDir,file),old=fs.readFileSync(p);write(p,{...JSON.parse(old),[field]:value});const bad=fs.readFileSync(p);node(observeArgs,1);assert.deepEqual(fs.readFileSync(p),bad);fs.writeFileSync(p,old);}
  const publicTargets=node([bindingCLI,'--public-read-targets',binding,path.join(f.transaction,'final-snapshot/migration.json'),path.join(proofDir,'gateway-status.json')]).stdout;
  node([...observeArgs,'public'],1);for(const file of ['before.json','after.json','gateway-status.json']){const p=path.join(proofDir,file);write(p,{...JSON.parse(fs.readFileSync(p)),publicCutoverReady:true});}node(observeArgs,1);const publicObservation=node([...observeArgs,'public']).stdout;
  write(path.join(proofDir,'read-targets.txt'),publicTargets);write(path.join(proofDir,'observation.json'),publicObservation);write(path.join(proofDir,'account.json'),{address:'0x'+'1'.repeat(40),balance:100,nonce:0});write(path.join(proofDir,'block.json'),{height:42,hash:'d'.repeat(64)});write(path.join(proofDir,'evm-chain-id.json'),{jsonrpc:'2.0',id:1,result:'0x1917'});
  write(path.join(proofDir,'mutation-freeze.json'),{httpStatus:503});
  const publicArgs=[bindingCLI,'--public-readback',binding,proofDir],publicSource=JSON.parse(node(publicArgs).stdout);assert.equal(publicSource.accountBalanceVerified,false);assert.equal(publicSource.allNativeHistoryVerified,false);assert.equal(publicSource.ecosystemContinuityVerified,false);
  for(const [file,field,value]of [['account.json','address','0x'+'2'.repeat(40)],['block.json','hash','f'.repeat(64)],['evm-chain-id.json','result','0x1'],['mutation-freeze.json','httpStatus',404]]){const p=path.join(proofDir,file),old=fs.readFileSync(p);write(p,{...JSON.parse(old),[field]:value});node(publicArgs,1);fs.writeFileSync(p,old);}
  const unknown=fixture('unknown');run(unknown);const ub=fs.readFileSync(path.join(unknown.transaction,'candidate/binding.json'));write(path.join(unknown.transaction,'candidate/deploy-result.json'),{...deploy,transactionId:path.basename(unknown.transaction),bindingSha256:digest(ub)});write(path.join(unknown.transaction,'candidate/initialize-attempt/result.json'),{...JSON.parse(initRaw),bindingSha256:digest(ub)});
  run(unknown,'start',{DEPLOY_DRY_RUN:'1',PUBLIC_BFT_PRODUCTION_CANDIDATE_START_APPROVED:'yes',FAIL_TRANSPORT:'partial'},1);const intent=path.join(unknown.transaction,'candidate/start-attempt/intent.json');assert.equal(JSON.parse(fs.readFileSync(intent)).status,'unknown');assert.equal(fs.existsSync(path.join(unknown.transaction,'candidate/start-attempt/result.json')),false);const failedCalls=fs.readFileSync(unknown.log+'.transport');assert.equal((failedCalls.toString().match(/timeout 30s systemctl start/g)||[]).length,2);run(unknown,'start',{DEPLOY_DRY_RUN:'1',PUBLIC_BFT_PRODUCTION_CANDIDATE_START_APPROVED:'yes'},1);assert.deepEqual(fs.readFileSync(unknown.log+'.transport'),failedCalls);
  const rollback=fixture('rollback'),rollbackBefore=originals(rollback);run(rollback,'rollback',{DEPLOY_DRY_RUN:'0'},1);assert.equal(fs.existsSync(rollback.log+'.transport'),false);assert.equal(fs.existsSync(path.join(rollback.transaction,'candidate/rollback-result.json')),false);
  const firstRollback=fs.readFileSync(path.join(rollback.transaction,'candidate/rollback.txt'));run(rollback,'rollback',{DEPLOY_DRY_RUN:'1'});run(rollback,'rollback',{DEPLOY_DRY_RUN:'1'});assert.deepEqual(fs.readFileSync(path.join(rollback.transaction,'candidate/rollback.txt')),firstRollback);
  for(const n of [2,3]){const text=fs.readFileSync(path.join(rollback.transaction,`candidate/rollback-attempt-${n}.txt`),'utf8');for(const role of roles)assert.ok(text.includes(`DRY RUN [${role}]`));assert.ok(text.includes('no transport or rollback performed'));}
  rollback.approval.automaticRollbackRequired=false;write(path.join(rollback.transaction,'approval.json'),rollback.approval);run(rollback,'rollback',{DEPLOY_DRY_RUN:'1'},1);assert.equal(fs.existsSync(path.join(rollback.transaction,'candidate/rollback-attempt-4.txt')),false);write(path.join(rollback.transaction,'approval.json'),JSON.parse(rollbackBefore.find(([p])=>p.endsWith('/approval.json'))[1]));unchanged(rollbackBefore);
  assert.ok(!/\bgo (run|build)\b/.test(driver),'mutable-source compiler remains in driver');
  console.log('PUBLIC_BFT_OPERATOR_CALLER_BINDING_PASS (caller/binding only; no package, service or deployment claim)');
} finally { fs.rmSync(tmp,{recursive:true,force:true}); }
NODE
