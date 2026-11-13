#!/usr/bin/env node
// A release-ref check inside the original protected same-owner operation.
// This is source eligibility DATA, never a replacement approval or permit.
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {sameOwnerProfile,readSameOwnerJSON,readSameOwnerOriginal,validateSameOwnerApproval,validateSameOwnerProjection} from './lib/public-bft-same-owner.mjs';

const repo=path.resolve(import.meta.dirname,'../..');
const repository='JiahaoAlbus/YNX-Chain';
const workflow='.github/workflows/resource-market-ci.yml';
const releaseRefs=new Set(['refs/heads/codex/ynx-pq-public-upgrade','refs/heads/codex/ynx-pq-perf-integration']);
const need=(ok,message)=>{if(!ok)throw new Error('public BFT release source rejected: '+message);};

// The CLI supplies actual Git state, never a caller-selected branch/HEAD.
// Exported only so the original PUBLIC controls can check the exact binding.
export function bindSameOwnerRelease(approvalFile,reviewFile,head,ref,mode) {
  need(/^[0-9a-f]{40}$/.test(head)&&releaseRefs.has(ref),'exact original normal release ref and full HEAD required');
  need(['execute','prepare-native','export-native','continue-native','continue-pq-native'].includes(mode),'exact original transaction phase required');
  const raw=readSameOwnerJSON(path.resolve(approvalFile));
  need(raw.custodyProfile===sameOwnerProfile,'legacy handover remains main-only');
  const commit=head.slice(0,12),release=`ynx-bft-gateway-${commit}`;
  const approval=validateSameOwnerApproval(raw,path.resolve(reviewFile),commit,release,mode==='prepare-native',{snapshot:mode==='export-native'});
  need(approval.sameOwnerEvidence.sourceCommit===head,'protected same-owner source differs from actual full HEAD');
  const review=JSON.parse(readSameOwnerOriginal(path.resolve(reviewFile),approval.sameOwnerEvidence.reviewSHA256).raw.toString('utf8'));
  const runtime=JSON.parse(readSameOwnerOriginal(path.join(path.dirname(path.resolve(reviewFile)),review.sources.runtimeManifest.file),approval.runtimeManifestSha256).raw.toString('utf8'));
  need(runtime.commit===head&&/^[1-9][0-9]*$/.test(runtime.runId),'independently pinned original runtime SOURCE CI identity required');
  return {head,ref,runId:runtime.runId,runtimeManifestSHA256:approval.runtimeManifestSha256,reviewSHA256:approval.sameOwnerEvidence.reviewSHA256,approval};
}

export function validateSameOwnerReleaseRun(run,binding) {
  need(run&&typeof run==='object'&&!Array.isArray(run),'original GitHub run metadata required');
  need(Number.isSafeInteger(run.id)&&String(run.id)===binding.runId,'run ID differs from independently pinned SOURCE');
  need(run.repository?.full_name===repository&&run.head_repository?.full_name===repository,'original repository required; fork run refused');
  need(run.path===workflow&&run.event==='push','original normal push workflow required');
  need(run.head_sha===binding.head&&run.head_branch===binding.ref.slice('refs/heads/'.length),'CI full HEAD or exact release ref differs');
  need(run.status==='completed'&&run.conclusion==='success','same-source normal CI must have completed successfully');
  return {sourceCommit:binding.head,releaseRef:binding.ref,ciRunId:binding.runId,ciWorkflow:workflow,runtimeManifestSHA256:binding.runtimeManifestSHA256,reviewSHA256:binding.reviewSHA256,sourceEligible:true,operationAuthorized:false};
}

function git(...args) {return execFileSync('git',args,{cwd:repo,encoding:'utf8',timeout:10000,maxBuffer:1<<20}).trim();}
function actualSource() {
  const state={head:git('rev-parse','HEAD'),ref:git('symbolic-ref','--quiet','HEAD')};
  need(git('status','--short')==='','clean original release checkout required');
  return state;
}
const digest=raw=>crypto.createHash('sha256').update(raw).digest('hex');
function privateTransaction(root) {
  need(path.isAbsolute(root)&&fs.realpathSync(root)===root,'canonical retained transaction required');
  const st=fs.lstatSync(root);need(st.isDirectory()&&(st.mode&0o777)===0o700&&st.uid===process.geteuid(),'private retained transaction required');
  for(const name of ['approval.json','continuation-attempt','candidate/initialize-attempt','candidate/start-attempt','pq-continuation-attempt'])
    need(!fs.existsSync(path.join(root,name))&&!fs.lstatSync(path.join(root,name),{throwIfNoEntry:false}),'candidate/continuation footprint forbids native inverse');
  return root;
}
export function retainedNativeRelease(original,review,root,actual) {
  privateTransaction(root);
  const filename=name=>path.join(root,name),record=readSameOwnerJSON(filename('preparation-release.json'));
  need(Object.keys(record).sort().join(',')===['version','transactionId','approvalOriginalSHA256','approvalSHA256','source'].sort().join(','),'closed original preparation qualification required');
  need(record.version==='YNX-NATIVE-PREPARATION-RELEASE/v1'&&record.transactionId===path.basename(root),'original qualification scope differs');
  const raw=readSameOwnerOriginal(filename('preparation-approval.original.json'),record.approvalOriginalSHA256).raw;
  need(readSameOwnerOriginal(path.resolve(original),record.approvalOriginalSHA256).raw.equals(raw),'abort must name original preparation approval');
  const bytes=readSameOwnerOriginal(filename('preparation-approval.json'),record.approvalSHA256).raw;
  const a=validateSameOwnerProjection(readSameOwnerJSON(filename('preparation-approval.json')),actual.head.slice(0,12),`ynx-bft-gateway-${actual.head.slice(0,12)}`,true,{current:false});
  need(a.transactionId===record.transactionId&&a.sameOwnerEvidence.sourceCommit===actual.head,'retained operation/source differs');
  const expected={sourceCommit:actual.head,releaseRef:actual.ref,ciRunId:record.source.ciRunId,ciWorkflow:workflow,runtimeManifestSHA256:a.runtimeManifestSha256,reviewSHA256:a.sameOwnerEvidence.reviewSHA256,sourceEligible:true,operationAuthorized:false};
  need(releaseRefs.has(actual.ref)&&/^[1-9][0-9]*$/.test(expected.ciRunId),'original formal release identity required');
  assert.deepEqual(record.source,expected,'retained qualification differs from original source/scope');
  const originalReview=readSameOwnerJSON(path.resolve(review));
  readSameOwnerOriginal(path.resolve(review),expected.reviewSHA256);
  const runtime=JSON.parse(readSameOwnerOriginal(path.join(path.dirname(path.resolve(review)),originalReview.sources.runtimeManifest.file),expected.runtimeManifestSHA256).raw);
  need(runtime.commit===actual.head&&runtime.runId===expected.ciRunId,'retained CI differs from independently pinned original SOURCE');
  return expected;
}
function retainPreparation(args,actual) {
  const [original,review,,root]=args;privateTransaction(root);
  need(!fs.lstatSync(path.join(root,'journal.jsonl'),{throwIfNoEntry:false}),'cannot backfill source qualification after preparation began');
  const binding=bindSameOwnerRelease(original,review,actual.head,actual.ref,'prepare-native');
  const raw=execFileSync('gh',['api','--hostname','github.com','--method','GET',`repos/${repository}/actions/runs/${binding.runId}`],{cwd:repo,encoding:'utf8',timeout:30000,maxBuffer:2<<20});
  const source=validateSameOwnerReleaseRun(JSON.parse(raw),binding);
  const approval=readSameOwnerOriginal(path.join(root,'preparation-approval.json')).raw;
  assert.deepEqual(approval,Buffer.from(JSON.stringify(binding.approval)+'\n'),'preparation projection differs');
  const input=readSameOwnerOriginal(path.join(root,'preparation-approval.original.json')).raw;
  need(input.equals(readSameOwnerOriginal(path.resolve(original)).raw),'preparation original changed');
  assert.deepEqual(actualSource(),actual,'source changed while retaining qualification');
  const result={version:'YNX-NATIVE-PREPARATION-RELEASE/v1',transactionId:path.basename(root),approvalOriginalSHA256:digest(input),approvalSHA256:digest(approval),source};
  need(binding.approval.transactionId===result.transactionId,'preparation transaction differs');
  const out=path.join(root,'preparation-release.json'),fd=fs.openSync(out,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
  try{fs.writeFileSync(fd,JSON.stringify(result)+'\n');fs.fsyncSync(fd)}finally{fs.closeSync(fd)}
  const dir=fs.openSync(root,'r');try{fs.fsyncSync(dir)}finally{fs.closeSync(dir)}
  return result;
}
function main(args) {
  need(args.length===3||args.length===4&&['retain-preparation','abort-native'].includes(args[2]),'original approval, review and transaction phase required');
  if(args.length===4){const before=actualSource();const result=args[2]==='retain-preparation'?retainPreparation(args,before):retainedNativeRelease(args[0],args[1],args[3],before);assert.deepEqual(actualSource(),before);process.stdout.write(JSON.stringify(result)+'\n');return;}
  const before=actualSource(),binding=bindSameOwnerRelease(args[0],args[1],before.head,before.ref,args[2]);
  // No caller JSON, environment switch, branch pattern or alternate repository
  // can substitute the original run identified by approved runtime SOURCE.
  const raw=execFileSync('gh',['api','--hostname','github.com','--method','GET',`repos/${repository}/actions/runs/${binding.runId}`],{cwd:repo,encoding:'utf8',timeout:30000,maxBuffer:2<<20});
  const result=validateSameOwnerReleaseRun(JSON.parse(raw),binding);
  assert.deepEqual(actualSource(),before,'release checkout changed during CI readback');
  assert.deepEqual(bindSameOwnerRelease(args[0],args[1],before.head,before.ref,args[2]),binding,'protected original changed during CI readback');
  process.stdout.write(JSON.stringify(result)+'\n');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main(process.argv.slice(2));
