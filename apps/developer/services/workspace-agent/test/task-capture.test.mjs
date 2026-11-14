import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { getEventListeners } from 'node:events';
import { createWorkspaceRuntime } from '../src/runtime.mjs';
const deferred=()=>{let resolve;return {promise:new Promise(r=>resolve=r),resolve:(...args)=>resolve(...args)};};
const error=code=>Object.assign(Error(code),{code});
const task=projectId=>({protocolVersion:'ynx-code/v1',task:'build-run-active',projectId,activePath:'main.js',files:{'main.js':'ORIGINAL SOURCE'},approval:'execute-once'});
async function fixture(t){
 const root=await mkdtemp(join(tmpdir(),'ynx-task-capture-')),entered=deferred(),release=deferred(),environments=[];
 const runtime=createWorkspaceRuntime({root,concurrency:1,environmentResolver:async(_owner,project)=>{environments.push(project);if(project==='first'){entered.resolve();await release.promise;}return {revision:0,environment:{}};}});
 t.after(async()=>{runtime.cancelAll();runtime.closeAdmission();await rm(root,{recursive:true,force:true});});
 let firstChecks=0;const first=runtime.runTaskForOwner('owner',task('first'),undefined,{assertCurrent:()=>{if(++firstChecks>1)throw error('first_retired');}});
 const firstResult=Promise.allSettled([first]);await entered.promise;return {root,runtime,release,environments,firstResult};
}
test('queued task snapshots validated project, path and source bytes before caller mutation',async t=>{
 const h=await fixture(t),body=task('original-project');let checks=0,materialized;
 const result=h.runtime.runTaskForOwner('owner',body,undefined,{assertCurrent:async()=>{if(++checks===3){for(const project of await readdir(h.root)){for(const dir of await readdir(join(h.root,project))){materialized=await readFile(join(h.root,project,dir,'main.js'),'utf8');}}throw error('checked_before_spawn');}}});
 const rejected=assert.rejects(result,{code:'checked_before_spawn'});
 body.projectId='wrong-project';body.activePath='wrong.js';body.files['main.js']='MUTATED SOURCE';body.files['wrong.js']='WRONG FILE';body.task='test-project';
 h.release.resolve();await h.firstResult;await rejected;
 assert.deepEqual(h.environments,['first','original-project']);assert.equal(materialized,'ORIGINAL SOURCE');
});
test('queued authorization callback is captured and cannot be replaced by caller',async t=>{
 const h=await fixture(t),original=new AbortController(),replacement=new AbortController(),operation={signal:original.signal,assertCurrent:()=>{throw error('original_authority');}};
 const result=h.runtime.runTaskForOwner('owner',task('second'),undefined,operation);const rejected=assert.rejects(result,{code:'original_authority'});
 assert.equal(getEventListeners(original.signal,'abort').length,1);
 operation.signal=replacement.signal;operation.assertCurrent=()=>{throw error('replaced_authority');};h.release.resolve();await h.firstResult;await rejected;assert.deepEqual(h.environments,['first']);
 assert.equal(getEventListeners(original.signal,'abort').length,0);assert.equal(getEventListeners(replacement.signal,'abort').length,0);
});
test('queued cancellation and listener cleanup keep original signal after operation mutation',async t=>{
 const h=await fixture(t),original=new AbortController(),replacement=new AbortController(),operation={signal:original.signal};
 const result=h.runtime.runTaskForOwner('owner',task('second'),undefined,operation);const rejected=assert.rejects(result,{code:'original_cancel'});
 operation.signal=replacement.signal;original.abort(error('original_cancel'));await rejected;
 assert.equal(h.runtime.status().queued,0);assert.deepEqual(h.environments,['first']);h.release.resolve();await h.firstResult;
});
test('active cancellation uses original reason even when caller replaces its signal',async t=>{
 const root=await mkdtemp(join(tmpdir(),'ynx-task-active-capture-')),entered=deferred(),release=deferred();
 const runtime=createWorkspaceRuntime({root,environmentResolver:async()=>{entered.resolve();await release.promise;return {revision:0,environment:{}};}});
 t.after(async()=>{runtime.cancelAll();runtime.closeAdmission();await rm(root,{recursive:true,force:true});});
 const original=new AbortController(),replacement=new AbortController(),operation={signal:original.signal};
 const result=runtime.runTaskForOwner('owner',task('active'),undefined,operation),rejected=assert.rejects(result,{code:'original_cancel'});
 await entered.promise;operation.signal=replacement.signal;original.abort(error('original_cancel'));release.resolve();await rejected;
 assert.equal(getEventListeners(original.signal,'abort').length,0);assert.equal(getEventListeners(replacement.signal,'abort').length,0);
});
