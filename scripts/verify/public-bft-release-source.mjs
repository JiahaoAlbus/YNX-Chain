#!/usr/bin/env node
// A release-ref check inside the original protected same-owner operation.
// This is source eligibility DATA, never a replacement approval or permit.
import assert from 'node:assert/strict';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {sameOwnerProfile,readSameOwnerJSON,readSameOwnerOriginal,validateSameOwnerApproval} from './lib/public-bft-same-owner.mjs';

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
function main(args) {
  need(args.length===3,'original approval, review and transaction phase required');
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
