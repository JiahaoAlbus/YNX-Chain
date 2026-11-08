#!/usr/bin/env node
// Pure PUBLIC fixtures only. No key creation, signing, network, Git writes,
// service execution, final snapshot or actual operation authorization.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {sameOwnerProfile,validateSameOwnerApproval,validateSameOwnerReview,validateSameOwnerProjection} from './lib/public-bft-same-owner.mjs';
import {bindSameOwnerRelease,validateSameOwnerReleaseRun} from './public-bft-release-source.mjs';
import {validatorRoles, isSingleAppCustody} from './lib/owner-handover.mjs';
const repo=path.resolve(import.meta.dirname,'../..'),root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'ynx-same-owner-public-')));
fs.chmodSync(root,0o700);
const hash=x=>crypto.createHash('sha256').update(x).digest('hex'), clone=x=>structuredClone(x);
const now=new Date(),utc=d=>d.toISOString().replace(/\.\d{3}Z$/,'Z');
const full='123456789abc'+'d'.repeat(28),commit=full.slice(0,12),release=`ynx-bft-gateway-${commit}`,tx='same-owner-synthetic-transaction-001';
let assertions=0;
const write=(name,value)=>{const raw=Buffer.isBuffer(value)?value:Buffer.from(JSON.stringify(value)+'\n');fs.writeFileSync(path.join(root,name),raw,{mode:0o600});return {file:name,sha256:hash(raw)};};
const call=(script,args)=>{const r=spawnSync(process.execPath,[path.join(repo,script),...args],{encoding:'utf8',cwd:repo,timeout:10000,maxBuffer:2<<20});assert.ifError(r.error);return r;};
const accepted=r=>{assert.equal(r.status,0,r.stderr);assertions++;return JSON.parse(r.stdout);};
const refused=(fn,label)=>{assert.throws(fn,undefined,label);assertions++;};
try {
const validators=validatorRoles.map((role,i)=>{const pub=Buffer.alloc(32,i+1);return {role,validatorAddress:`ynx_validator_${role.replaceAll('-','_')}`,privateP2PHost:`10.77.42.${i+1}`,p2pPort:27656,nodeId:String(i+1).repeat(40),consensusKeyType:'tendermint/PubKeyEd25519',consensusPubKey:pub.toString('base64'),consensusAddress:hash(pub).slice(0,40).toUpperCase()};});
const manifest={version:1,purpose:'ynx-production-bft-candidate-public-keys-only',chainId:'ynx_6423-1',validators};
const oldManifest=write('original-validators.json',manifest),newManifest=write('target-validators.json',{...manifest,validators:[...validators].sort((a,b)=>a.role.localeCompare(b.role))});
const nativeSource={statePath:'/var/lib/ynx-chain/testnet/devnet-state.json',integrityMarkerPath:'/var/lib/ynx-chain/testnet/devnet-state.integrity-version',pauseMarkerPath:'/var/lib/ynx-chain/block-production-pause.json',mutationMarkerPath:'/var/lib/ynx-chain/mutation-freeze.json'};
const native={authoritativeCommit:'b'.repeat(40),authoritativeRelease:'ynx-chain-'+ 'b'.repeat(12),authoritativeBinarySha256:'c'.repeat(64),authoritativeSource:nativeSource,authoritativeSystemd:{fragmentSha256:'d'.repeat(64),dropIns:[]}};
const plan={version:'YNX-PRODUCTION-OPERATOR/v1',chainId:'ynx_6423-1',validatorManifestSHA256:newManifest.sha256,originalGenesisHash:'e'.repeat(64),stateLayout:'atomic-json',runtimePlan:null,runtimePlanHash:'',pqSchedule:null,pqScheduleHash:'',preparationOnly:true,bootstrapRegistrationMode:'quiet-first-registration-v1',roles:validatorRoles.map(role=>({role,home:`/var/lib/ynx-chain/consensus-candidate/${role}`,abciState:`/var/lib/ynx-chain/consensus-candidate/${role}/data/application.json`,legacyKeyPath:`/etc/ynx/consensus-candidate/${role}/priv_validator_key.json`,legacyStatePath:`/etc/ynx/consensus-candidate/${role}/priv_validator_state.json`,nodeKeyPath:`/etc/ynx/consensus-candidate/${role}/node_key.json`}))};
const planRef=write('preparation-plan.json',plan);
const runtime={version:'YNX-PQ-LINUX-RUNTIME-CANDIDATE/v3',commit:full,runId:'1234',platform:'linux/amd64',runtimeStarted:false,publicDeployment:false,pqActivation:false};
const exporter={version:'YNX-PQ-OFFLINE-MIGRATION-TOOLS/v2',commit:full,platform:'linux/amd64',runtimeStarted:false,deploymentReady:false,authorityGranted:false,executionReady:false};
const operations=Object.fromEntries(['scripts/ops/public-bft-cutover-transaction.sh','scripts/ops/public-bft-production-driver.sh','scripts/ops/remote/public-bft-native-identity.py','scripts/ops/init-consensus-candidate-keys.sh'].map(name=>{const raw=fs.readFileSync(path.join(repo,name));return [name,{bytes:raw.length,sha256:hash(raw)}];}));
const rows=validators.map((v,i)=>{
 const role=v.role,custody=`/etc/ynx/consensus-candidate/${role}`;
 const roleManifest={version:1,purpose:manifest.purpose,chainId:manifest.chainId,candidateRoot:`/var/lib/ynx-chain/consensus-candidate/${role}`,genesisHash:'9'.repeat(64),migrationStateHash:'8'.repeat(64),node:v,privateValidatorKeyPath:`${custody}/priv_validator_key.json`,nodeKeyPath:`${custody}/node_key.json`};
 const rm=write(`${role}-role.json`,roleManifest);
 const {privateP2PHost,p2pPort,...identity}=v;
 const recovery={version:'YNX-CONSENSUS-KEYCHECK-ISOLATED-RECOVERY/v1',role,serviceUID:1000+i,roleManifestSHA256:rm.sha256,sourceDirectory:custody,privateRecoveryDirectory:`/var/lib/ynx-chain/recovery/${role}/attempt`,publicRecord:{version:1,purpose:manifest.purpose,...identity,custodyBoundary:'owner-controlled-host-local'}};
 for(const k of ['sourceReadOnly','sourceFilesUnchanged','backupBytesMatched','restoreBytesMatched','restoredIdentityMatched','restoredHRSConsistency','manifestMatched','isolatedRecoveryVerified','sameHost'])recovery[k]=true;
 for(const k of ['offHostRecoveryVerified','hrsHistoryVerified','independentReview','authorityGranted','signingPerformed','liveRestorePerformed','serviceChanged','rotationVerified'])recovery[k]=false;
 const observation={version:'YNX-PUBLIC-BFT-NATIVE-IDENTITY/v1',role,...native,transactionId:tx,commit,mainPid:String(100+i),runningExecutablePath:'/usr/local/bin/ynx-chaind',runningExecutableDeviceInode:`2049:${100+i}`,unitSHA256:native.authoritativeSystemd.fragmentSha256,dataPath:'/var/lib/ynx-chain/testnet',pauseMarkerPath:nativeSource.pauseMarkerPath,mutationMarkerPath:nativeSource.mutationMarkerPath,readOnly:true,deployment:false,nativeRootAuthorized:false};
 delete observation.authoritativeSource;
 return {role,roleManifest:rm,priorRecovery:write(`${role}-prior.json`,recovery),currentRecovery:write(`${role}-current.json`,Buffer.from(JSON.stringify({...recovery,privateRecoveryDirectory:`/var/lib/ynx-chain/recovery-current/${role}/attempt`}))),nativeObservation:write(`${role}-native.json`,observation)};
});
const review={version:'YNX-SAME-OWNER-INPLACE-CUSTODY/v1',custodyProfile:sameOwnerProfile,reviewId:'synthetic-review-001',transactionId:tx,sourceCommit:full,reviewedAt:utc(now),expiresAt:utc(new Date(now.getTime()+3600000)),sources:{originalValidatorManifest:oldManifest,validatorManifest:newManifest,operatorPreparationPlan:planRef,runtimeManifest:write('runtime-SOURCE.json',runtime),exporterManifest:write('exporter-SOURCE.json',exporter),operationAuthorization:write('original-authorization.txt',Buffer.from('SYNTHETIC PUBLIC CONTROL ONLY; not a real operation approval\n'))},roles:rows,operations};
// Normal keycheck file is compact without LF, while an older retained CLI
// stdout can include LF. Both independent raw pins survive without re-encoding.
assert.notEqual(rows[0].priorRecovery.sha256,rows[0].currentRecovery.sha256);
assert.equal(fs.readFileSync(path.join(root,rows[0].currentRecovery.file)).at(-1),125);
let reviewRef=write('same-owner-review.json',review);
const rawApproval={custodyProfile:sameOwnerProfile,schemaVersion:1,action:'ynx-public-bft-cutover',approved:true,approvalId:'synthetic-operation-001',transactionId:tx,commit,release,publicCutoverAuthorized:true,automaticRollbackRequired:true,custodyEvidence:`sha256:${reviewRef.sha256}`,operationAuthorizationEvidence:`sha256:${review.sources.operationAuthorization.sha256}`,validatorManifestSha256:newManifest.sha256,operatorPreparationPlanSha256:planRef.sha256,runtimeManifestSha256:review.sources.runtimeManifest.sha256,exporterManifestSha256:review.sources.exporterManifest.sha256,...native,authoritativeRoles:Object.fromEntries(validatorRoles.map(r=>[r,clone(native)])),preparationOnly:true,expiresAt:review.expiresAt};
const reviewPath=path.join(root,reviewRef.file),rawPath=path.join(root,'approval.json');write('approval.json',rawApproval);
const before=fs.readFileSync(reviewPath);
// The normal existing packet writer seals the actual public bytes, without
// creating any approval or owner/reviewer attribution.
const packetDir=path.join(root,'retained-public-packet');
const packet=accepted(call('scripts/ops/write-production-custody-review-packet.mjs',['--same-owner',reviewPath,reviewRef.sha256,packetDir]));
assert.equal(packet.operationAuthorized,false);assert.equal(packet.deploymentVerified,false);
assert.deepEqual(fs.readFileSync(packet.reviewPath),before);
const repeated=call('scripts/ops/write-production-custody-review-packet.mjs',['--same-owner',reviewPath,reviewRef.sha256,packetDir]);assert.notEqual(repeated.status,0);assert.equal(repeated.stdout,'');assertions++;
assert.deepEqual(fs.readFileSync(packet.reviewPath),before);
accepted(call('scripts/verify/validate-production-custody-review.mjs',[packet.reviewPath,commit,newManifest.sha256]));
const projected=accepted(call('scripts/verify/validate-public-bft-cutover-approval.mjs',[rawPath,commit,release,reviewPath,'--prepare-native']));
assert.equal(projected.sameOwnerEvidence.handover,'not-applicable-same-owner-verified');
assert.equal(projected.sameOwnerEvidence.hrsHistoryVerified,false);assert.equal(projected.sameOwnerEvidence.pqRecoveryVerified,false);
for(const k of ['ownerHandoverVerified','ownerHandoverReviewer','custodyReviewer','rotationProcedureVerified','serviceSignerRecoveryVerified'])assert.equal(Object.hasOwn(projected,k),false);
assert.deepEqual(fs.readFileSync(reviewPath),before);
accepted(call('scripts/verify/validate-production-custody-review.mjs',[reviewPath,commit,newManifest.sha256]));
const projectedPath=path.join(root,'projected.json');write('projected.json',projected);
assert.deepEqual(accepted(call('scripts/verify/validate-public-bft-cutover-approval-evidence.mjs',[projectedPath,commit,release,'--prepare-native'])),{...projected,validated:true});
// The original formal release refs are eligible only with the same complete
// protected approval/review and the exact normal CI run pinned by SOURCE.
// These are PUBLIC control records, never a claim of actual GitHub success.
const officialRef='refs/heads/codex/ynx-pq-perf-integration';
const bound=bindSameOwnerRelease(rawPath,reviewPath,full,officialRef,'prepare-native');assertions++;
const ci={id:1234,repository:{full_name:'JiahaoAlbus/YNX-Chain'},head_repository:{full_name:'JiahaoAlbus/YNX-Chain'},path:'.github/workflows/resource-market-ci.yml',event:'push',head_sha:full,head_branch:'codex/ynx-pq-perf-integration',status:'completed',conclusion:'success'};
assert.equal(validateSameOwnerReleaseRun(ci,bound).operationAuthorized,false);assertions++;
const publicRef='refs/heads/codex/ynx-pq-public-upgrade';
validateSameOwnerReleaseRun({...ci,head_branch:publicRef.slice('refs/heads/'.length)},bindSameOwnerRelease(rawPath,reviewPath,full,publicRef,'prepare-native'));assertions++;
for(const ref of ['refs/heads/codex/ynx-invoice-ledger-20261031','refs/heads/codex/arbitrary','refs/tags/release','HEAD','refs/heads/main'])refused(()=>bindSameOwnerRelease(rawPath,reviewPath,full,ref,'prepare-native'),'unapproved release ref '+ref);
refused(()=>bindSameOwnerRelease(rawPath,reviewPath,commit+'f'.repeat(28),officialRef,'prepare-native'),'same short prefix is not full source');
refused(()=>bindSameOwnerRelease(rawPath,reviewPath,full,officialRef,'plan'),'wrong phase cannot select release gate');
const legacyPath=path.join(root,'legacy-branch-control.json');write('legacy-branch-control.json',{...rawApproval,custodyProfile:'single-app-gateway/v1'});
refused(()=>bindSameOwnerRelease(legacyPath,reviewPath,full,officialRef,'prepare-native'),'old handover remains main-only');
for(const [label,change]of [
 ['wrong run',x=>x.id=1235],['string run ID',x=>x.id='1234'],['foreign repository',x=>x.repository.full_name='foreign/repo'],['fork head repository',x=>x.head_repository.full_name='foreign/repo'],['other workflow',x=>x.path='.github/workflows/chain-core.yml'],['dispatch',x=>x.event='workflow_dispatch'],['pull request',x=>x.event='pull_request'],['other HEAD',x=>x.head_sha='f'.repeat(40)],['same HEAD wrong ref',x=>x.head_branch='main'],['pending',x=>x.status='in_progress'],['failed',x=>x.conclusion='failure'],['cancelled',x=>x.conclusion='cancelled'],['missing conclusion',x=>delete x.conclusion]
]){const bad=clone(ci);change(bad);refused(()=>validateSameOwnerReleaseRun(bad,bound),label);}
// Exercise the normal helper and transaction process, replacing only actual
// Git/GitHub/remote observations in an isolated control PATH. No real Git ref,
// API call, operation permission, service, key or ledger is created/changed.
const bin=path.join(root,'control-bin');fs.mkdirSync(bin);
const gitControl=path.join(bin,'git'),ghControl=path.join(bin,'gh');
fs.writeFileSync(gitControl,`#!/bin/sh
case "$*" in
 'rev-parse --short=12 HEAD') printf '%s\\n' "$CONTROL_SHORT";;
 'rev-parse HEAD') if test -e "$CONTROL_CHANGED"; then printf '%s\\n' ffffffffffffffffffffffffffffffffffffffff; else printf '%s\\n' "$CONTROL_HEAD"; fi;;
 'symbolic-ref --quiet HEAD') printf '%s\\n' "$CONTROL_REF";;
 'status --short') printf '%s' "\${CONTROL_DIRTY:-}";;
 *) exit 93;;
esac
`,{mode:0o700});
fs.writeFileSync(ghControl,`#!/bin/sh
test "$*" = 'api --hostname github.com --method GET repos/JiahaoAlbus/YNX-Chain/actions/runs/1234' || exit 94
printf 'read\\n' >> "$CONTROL_GH_TRACE"
test "\${CONTROL_GH_FAIL:-0}" = 0 || exit 95
if test "\${CONTROL_CHANGE_AFTER_CI:-0}" = 1; then : > "$CONTROL_CHANGED"; fi
cat "$CONTROL_CI"
`,{mode:0o700});
const ciPath=path.join(root,'ci-control.json');write('ci-control.json',ci);
const controlEnv={...process.env,PATH:bin+':'+process.env.PATH,CONTROL_SHORT:commit,CONTROL_HEAD:full,CONTROL_REF:officialRef,CONTROL_CI:ciPath,CONTROL_CHANGED:path.join(root,'checkout-changed'),CONTROL_GH_TRACE:path.join(root,'ci-read-trace')};
const sourceCLI=(extra={})=>spawnSync(process.execPath,[path.join(repo,'scripts/verify/public-bft-release-source.mjs'),rawPath,reviewPath,'prepare-native'],{cwd:repo,encoding:'utf8',timeout:10000,env:{...controlEnv,...extra}});
assert.equal(accepted(sourceCLI()).sourceCommit,full);
for(const env of [{CONTROL_DIRTY:' M original'}, {CONTROL_REF:'refs/heads/codex/ynx-invoice-ledger-20261031'}, {CONTROL_GH_FAIL:'1'}, {CONTROL_CHANGE_AFTER_CI:'1'}]){const r=sourceCLI(env);assert.notEqual(r.status,0);assert.equal(r.stdout,'');assertions++;fs.rmSync(controlEnv.CONTROL_CHANGED,{force:true});}
const driver=path.join(root,'public-phase-control.sh');fs.writeFileSync(driver,'#!/bin/sh\nprintf "%s\\n" "$1" >> "$CONTROL_PHASES"\n',{mode:0o700});
const evidence=path.join(root,'release-transaction'),phases=path.join(root,'release-phases');
const transactionEnv={...controlEnv,PUBLIC_BFT_CUTOVER_MODE:'prepare-native',PUBLIC_BFT_CUTOVER_APPROVED:'yes',PUBLIC_BFT_CUTOVER_DRIVER:driver,PUBLIC_BFT_CUTOVER_APPROVAL_FILE:rawPath,PUBLIC_BFT_CUSTODY_REVIEW_FILE:reviewPath,PUBLIC_BFT_CUTOVER_EVIDENCE_DIR:evidence,PUBLIC_BFT_CUTOVER_TRANSACTION_ID:tx,PUBLIC_BFT_PRODUCTION_OPERATOR_PLAN:path.join(root,planRef.file),PUBLIC_BFT_PRODUCTION_OPERATOR_PLAN_SHA256:planRef.sha256,CONTROL_PHASES:phases};
const shell=spawnSync('bash',[path.join(repo,'scripts/ops/public-bft-cutover-transaction.sh')],{cwd:repo,encoding:'utf8',timeout:20000,env:transactionEnv});
assert.equal(shell.status,0,shell.stderr);assert.match(shell.stdout,/awaiting_final_snapshot_authorization/);assertions++;
assert.deepEqual(fs.readFileSync(phases,'utf8').trim().split('\n'),['preflight','backup','freeze_mutations','pause_authoritative']);
assert.deepEqual(fs.readFileSync(path.join(evidence,tx,'preparation-operator-plan.json')),fs.readFileSync(path.join(root,planRef.file)));
assert.equal(fs.existsSync(path.join(evidence,tx,'candidate')),false);
// A failed CI result is refused before an operation directory or phase call.
write('ci-control.json',{...ci,conclusion:'failure'});
const refusedEvidence=path.join(root,'refused-release-transaction');
const failed=spawnSync('bash',[path.join(repo,'scripts/ops/public-bft-cutover-transaction.sh')],{cwd:repo,encoding:'utf8',timeout:10000,env:{...transactionEnv,PUBLIC_BFT_CUTOVER_EVIDENCE_DIR:refusedEvidence}});
assert.notEqual(failed.status,0);assert.equal(fs.existsSync(refusedEvidence),false);assertions++;write('ci-control.json',ci);
// The main branch path must not call the new helper or acquire a different
// source policy. All original handover validators still run later unchanged.
const transactionSource=fs.readFileSync(path.join(repo,'scripts/ops/public-bft-cutover-transaction.sh'),'utf8');
const branchGuard=transactionSource.slice(transactionSource.indexOf('release_ref="$(git symbolic-ref'),transactionSource.indexOf('\numask 077'));
assert.ok(branchGuard.includes('refs/heads/main) ;;'));
const oldMain=spawnSync('bash',['-c','set -e\nnode() { echo unexpected-new-main-gate >&2; return 97; }\n'+branchGuard],{cwd:repo,encoding:'utf8',timeout:10000,env:{...controlEnv,CONTROL_REF:'refs/heads/main'}});
assert.equal(oldMain.status,0,oldMain.stderr);assert.equal(oldMain.stdout,'');assertions++;
const retain=call('scripts/verify/public-bft-candidate-binding.mjs',['--retain-operator-preparation',path.join(root,planRef.file),planRef.sha256,newManifest.sha256,path.join(root,'retained-plan.json')]);assert.equal(retain.status,0,retain.stderr);assert.deepEqual(fs.readFileSync(path.join(root,'retained-plan.json')),fs.readFileSync(path.join(root,planRef.file)));assertions++;
// Actual final phase requires separately pinned actual final inputs; its stable
// preparation evidence cannot authorize a different owner/key/source/expiry.
const g=Buffer.from('{"synthetic":"control only"}');const finalPlan={...plan,consensusGenesis:g.toString('base64'),consensusGenesisSHA256:hash(g),migrationStateHash:'a'.repeat(64)};delete finalPlan.preparationOnly;
const finalRef=write('final-plan.json',finalPlan);
const fullApproval={...rawApproval,operatorPlanSha256:finalRef.sha256,snapshotSourceSha256:'f'.repeat(64),candidateGenesisTime:utc(now)};delete fullApproval.preparationOnly;
write('final-approval.json',fullApproval);
const finalProjection=accepted(call('scripts/verify/validate-public-bft-cutover-approval.mjs',[path.join(root,'final-approval.json'),commit,release,reviewPath]));
const finalCheck=call('scripts/verify/public-bft-candidate-binding.mjs',['--operator-continuation',path.join(root,planRef.file),planRef.sha256,path.join(root,finalRef.file),finalRef.sha256]);assert.equal(finalCheck.status,0,finalCheck.stderr);assertions++;
// Run the actual shell's stable continuation comparison, without a shell
// transaction, transport, initialization, or service side effect.
const transaction=fs.readFileSync(path.join(repo,'scripts/ops/public-bft-cutover-transaction.sh'),'utf8');
const continuation=transaction.match(/printf '%s\\n' "\$approval_evidence" \| node --input-type=module -e '\n([\s\S]*?)' "\$transaction_dir\/preparation-approval.json"/);assert.ok(continuation);
write('preparation-approval.json',projected);write('preparation-operator-plan.json',plan);
const compare=spawnSync(process.execPath,['--input-type=module','-e',continuation[1],path.join(root,'preparation-approval.json')],{cwd:repo,input:JSON.stringify(finalProjection),encoding:'utf8',timeout:10000,env:{...process.env,PUBLIC_BFT_PRODUCTION_OPERATOR_PLAN:path.join(root,finalRef.file),PUBLIC_BFT_PRODUCTION_OPERATOR_PLAN_SHA256:finalRef.sha256}});assert.equal(compare.status,0,compare.stderr);assertions++;
// Existing remote capture consumes the exact projection (not a parallel
// grant); quiet resume likewise preserves the same expiry and transaction.
const quietRoot=path.join(root,tx);fs.mkdirSync(quietRoot,{mode:0o700});fs.writeFileSync(path.join(quietRoot,'approval.json'),JSON.stringify(finalProjection)+'\n',{mode:0o600});
const python=process.env.YNX_CONTROL_PYTHON||'python3';
const py=spawnSync(python,['-B','-c',`import importlib.util,json,sys,pathlib,copy\ndef load(n,p):\n s=importlib.util.spec_from_file_location(n,p);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m\nc=load('same_owner_capture',sys.argv[1]);q=load('same_owner_quiet',sys.argv[2]);v=json.load(open(sys.argv[3]));c.preparation(v,v['transactionId'])\nfor key,val in [('handover','completed'),('hrsHistoryVerified',True),('pqRecoveryVerified',True),('sourceCommit','f'*40)]:\n b=copy.deepcopy(v);b['sameOwnerEvidence'][key]=val\n try:c.preparation(b,v['transactionId'])\n except (ValueError,AssertionError):pass\n else:raise AssertionError('remote accepted '+key)\nr=pathlib.Path(sys.argv[4]);a,raw=q.approval(r);assert a['custodyProfile']==v['custodyProfile']\nprint('SAME_OWNER_REMOTE_CAPTURE_QUIET_PHASE_PASS')`,path.join(repo,'scripts/ops/remote/public-bft-capture-snapshot-source.py'),path.join(repo,'scripts/ops/public-bft-quiet-continuation.py'),projectedPath,quietRoot],{encoding:'utf8',timeout:10000});assert.equal(py.status,0,py.stderr);assertions++;
// Every failure changes an actual pinned original and its outer evidence pin;
// rejection must come from semantics, not merely a stale SHA in the fixture.
function changedOriginal(label,ref,change){const p=path.join(root,ref.file),saved=fs.readFileSync(p),savedPin=ref.sha256;try{const v=JSON.parse(saved);change(v);ref.sha256=write(ref.file,v).sha256;write(reviewRef.file,review);refused(()=>validateSameOwnerReview(reviewPath,commit,newManifest.sha256),label);}finally{fs.writeFileSync(p,saved);ref.sha256=savedPin;write(reviewRef.file,review);}}
for(const [label,change]of [
 ['owner UID changed',v=>v.serviceUID++],['custody moved',v=>v.sourceDirectory+='/new'],['key changed',v=>v.publicRecord.consensusPubKey=Buffer.alloc(32,11).toString('base64')],['HRS restore failed',v=>v.restoredHRSConsistency=false],['UNKNOWN restore',v=>v.restoreBytesMatched=false],['history false claim',v=>v.hrsHistoryVerified=true],['signing side effect',v=>v.signingPerformed=true],['owner transfer claim',v=>v.owner='agent alias'],['wrong role',v=>v.role='foreign']])changedOriginal(label,rows[0].currentRecovery,change);
changedOriginal('secret field in public original',rows[0].roleManifest,v=>v.node.private_key='must never publish');
changedOriginal('different manifest key',newManifest,v=>v.validators[0].nodeId='9'.repeat(40));
changedOriginal('duplicate role',newManifest,v=>v.validators[1]=clone(v.validators[0]));
changedOriginal('new history path',planRef,v=>v.roles[0].legacyStatePath='/new/reset.json');
changedOriginal('future genesis before freeze',planRef,v=>v.consensusGenesisSHA256='a'.repeat(64));
changedOriginal('new runtime source',review.sources.runtimeManifest,v=>v.commit='f'.repeat(40));
changedOriginal('source claims deployment',review.sources.runtimeManifest,v=>v.publicDeployment=true);
changedOriginal('wrong exporter source',review.sources.exporterManifest,v=>v.commit='f'.repeat(40));
for(const [label,change]of [
 ['expired',v=>v.expiresAt='2000-01-01T00:00:00Z'],['wrong scope',v=>v.custodyProfile='single-app-same-owner-inplace/v2'],['ops source',v=>v.operations['scripts/ops/public-bft-production-driver.sh'].sha256='f'.repeat(64)],['missing role',v=>v.roles.pop()],['unexpected handover',v=>v.ownerHandoverVerified=true]]){
 const bad=clone(review);change(bad);write(reviewRef.file,bad);refused(()=>validateSameOwnerReview(reviewPath,commit,newManifest.sha256),label);write(reviewRef.file,review);
}
for(const [label,change]of [['wrong tx',v=>v.transactionId='different-operation-002'],['expired approval',v=>v.expiresAt='2000-01-01T00:00:00Z'],['wrong scope',v=>v.action='other'],['fake handover',v=>v.ownerHandoverVerified=true],['names are not facts',v=>v.owner='agent-one'],['source pin',v=>v.runtimeManifestSha256='f'.repeat(64)],['raw injected success',v=>v.validated=true],['missing authorization',v=>delete v.operationAuthorizationEvidence],['future state',v=>v.snapshotSourceSha256='a'.repeat(64)]]){
 const bad=clone(rawApproval);change(bad);refused(()=>validateSameOwnerApproval(bad,reviewPath,commit,release,true),label);
}
for(const [label,change]of [['handover true',v=>v.sameOwnerEvidence.handover=true],['missing role history pin',v=>delete v.sameOwnerEvidence.roleEvidenceSHA256],['PQ recovery fake',v=>v.sameOwnerEvidence.pqRecoveryVerified=true]]){const b=clone(projected);change(b);refused(()=>validateSameOwnerProjection(b,commit,release,true),label);}
// Native data paths/current systemd/source are bound through the existing
// normal observation validator, not accepted from the recovery result.
for(const [label,change]of [['native source',v=>v.authoritativeCommit='a'.repeat(40)],['native data',v=>v.dataPath='/different/history'],['wrong current operation',v=>v.transactionId='foreign-operation-001'],['wrong current runtime',v=>v.authoritativeBinarySha256='f'.repeat(64)],['changed systemd',v=>v.unitSHA256='f'.repeat(64)]]){
 const ref=rows[0].nativeObservation,p=path.join(root,ref.file),saved=fs.readFileSync(p),oldPin=ref.sha256;
 const bad=JSON.parse(saved);change(bad);ref.sha256=write(ref.file,bad).sha256;
 const changedReview=write(reviewRef.file,review),a={...rawApproval,custodyEvidence:`sha256:${changedReview.sha256}`};
 refused(()=>validateSameOwnerApproval(a,reviewPath,commit,release,true),label);
 fs.writeFileSync(p,saved);ref.sha256=oldPin;write(reviewRef.file,review);
}
// Duplicate raw approval must fail before any new profile projection.
const duplicateRaw=Buffer.from('{"approved":false,'+JSON.stringify(rawApproval).slice(1));
write('approval-duplicate.json',duplicateRaw);const duplicateResult=call('scripts/verify/validate-public-bft-cutover-approval.mjs',[path.join(root,'approval-duplicate.json'),commit,release,reviewPath,'--prepare-native']);assert.notEqual(duplicateResult.status,0);assert.equal(duplicateResult.stdout,'');assertions++;
const symlink=path.join(root,'alias.json');fs.symlinkSync(reviewPath,symlink);refused(()=>validateSameOwnerReview(symlink,commit,newManifest.sha256),'symlink original');
fs.chmodSync(reviewPath,0o644);refused(()=>validateSameOwnerReview(reviewPath,commit,newManifest.sha256),'public-readable approval');fs.chmodSync(reviewPath,0o600);
const rawReview=fs.readFileSync(reviewPath);fs.writeFileSync(reviewPath,Buffer.from('{"version":"ignored",'+rawReview.toString().slice(1)));refused(()=>validateSameOwnerReview(reviewPath,commit,newManifest.sha256),'duplicate original field');fs.writeFileSync(reviewPath,rawReview);
// Original handover admission remains strict: the new profile cannot enter
// old owner inventory/receipt functions, and no old unknown profile is enabled.
assert.equal(isSingleAppCustody({custodyProfile:'single-app-gateway/v1'}),true);
assert.equal(isSingleAppCustody({}),false);refused(()=>isSingleAppCustody({custodyProfile:sameOwnerProfile}),'legacy must not reinterpret same owner as handover');
console.log(JSON.stringify({version:'YNX-SAME-OWNER-PUBLIC-CONTROLS/v1',assertions,normalApproval:true,normalPhaseComparison:true,remoteCapture:true,syntheticOnly:true,keysCreated:false,servicesChanged:false,operationAuthorized:false,deployment:false}));
}finally{fs.rmSync(root,{recursive:true,force:true});}
