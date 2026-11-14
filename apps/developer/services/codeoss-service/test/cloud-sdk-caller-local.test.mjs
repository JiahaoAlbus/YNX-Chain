import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createCloudDeploymentCaller,createOriginalCloudDeploymentTransport,prepareCloudManifest } from '../src/cloud-deployment-caller.mjs';
const hash=(bytes,algorithm='sha256')=>createHash(algorithm).update(bytes).digest('hex');
const selection={projectId:'PUBLIC_PROJECT',version:'1',publishPurpose:'web-preview',targetEnvironment:'PUBLIC_QA',content:Buffer.from('PUBLIC actual artifact bytes')};
const requestId='original_sdk_operation_1',approval=Buffer.from('PUBLIC_NOT_A_SIGNATURE_A');
async function fixture(t){
 assert.ok(process.env.YNX_ORIGINAL_CLOUD_SDK,'Supply original owner SDK; no replacement');assert.ok(process.env.YNX_ORIGINAL_CLOUD_DEPLOYMENT_CLIENT,'Supply original owner CloudDeploymentClient; no replacement');
 const {YNXCloudClient}=await import(pathToFileURL(process.env.YNX_ORIGINAL_CLOUD_SDK).href),{CloudDeploymentClient}=await import(pathToFileURL(process.env.YNX_ORIGINAL_CLOUD_DEPLOYMENT_CLIENT).href);
 const root=await mkdtemp(join(tmpdir(),'ynx-original-cloud-caller-')),filename=join(root,'original.sqlite');let db;const open=()=>{db=new DatabaseSync(filename);db.exec('PRAGMA journal_mode=WAL;PRAGMA synchronous=FULL;');return db;};open();
 t.after(async()=>{db.close();await rm(root,{recursive:true,force:true});});
 const state={slot:0n,operations:new Map(),calls:[],proofs:[],owner:'original-owner',lose:false,fail:false,tamper:null,getStatus:200,usagePaid:false,switchAfterGet:false};
 const raw=new YNXCloudClient({endpoint:'https://cloud.public.invalid/api/v1',product:'cloud',getDeploymentRequestHeaders:async info=>{state.proofs.push(info);return {'X-Public-Protocol-Proof':'PUBLIC_FIXTURE_ONLY'};},fetch:async(url,options)=>{
  const path=new URL(url).pathname,method=options.method||'GET';state.calls.push({method,path,headers:options.headers});assert.equal(options.headers.get('X-Public-Protocol-Proof'),'PUBLIC_FIXTURE_ONLY');
  const respond=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
  if(method==='POST'){
   assert.deepEqual([...options.body.keys()],['manifest','approval','artifact']);
   const id=options.headers.get('Idempotency-Key'),expected=options.headers.get('X-Expected-Deployment-Revision'),rollback=options.headers.get('X-Rollback-To')||'';
   if(expected!==String(state.slot))return respond({error:'Original slot revision is stale',code:'deployment_slot_conflict'},409);
   const manifest=Buffer.from(await options.body.get('manifest').arrayBuffer()),artifact=Buffer.from(await options.body.get('artifact').arrayBuffer()),approved=Buffer.from(await options.body.get('approval').arrayBuffer()),binding=JSON.parse(manifest);
   assert.deepEqual(Object.keys(binding),['projectId','version','contentDigest','publishPurpose','targetEnvironment','byteSize']);assert.equal(hash(artifact),binding.contentDigest);
   if(rollback){const target=state.operations.get(rollback);assert.equal(target?.state,'completed');assert.deepEqual(target.binding,binding);assert.notEqual(target.approvalSHA256,hash(approved));}
   state.slot++;const result={requestId:id,binding,manifestSHA256:hash(manifest),approvalSHA256:hash(approved),contentBinding:{bytes:String(artifact.length),sha3_512:hash(artifact,'sha3-512'),sha512:hash(artifact,'sha512')},expectedSlotRevision:expected,slotRevision:String(state.slot),rollbackTarget:rollback,publisherId:'PUBLIC_PUBLISHER',resourceId:'PUBLIC_RESOURCE',state:state.fail?'failed':'completed',exitCode:state.fail?1:0,deploymentId:'PUBLIC_INSTANCE_'+state.slot,runtimeUrl:'https://runtime.public.invalid/'+state.slot};
   state.operations.set(id,result);if(state.lose){state.lose=false;throw Error('PUBLIC POST response lost after dispatch');}return respond(result);
  }
  const match=path.match(/\/ide\/deployments\/([A-Za-z0-9_-]+)(?:\/(logs|usage))?$/);assert.ok(match);const operation=state.operations.get(match[1]);
  if(state.getStatus!==200)return respond({error:'PUBLIC read unavailable'},state.getStatus);if(!operation)return respond({error:'not found'},404);
  if(match[2]==='logs')return respond({requestId:match[1],runtimeLogSource:'original-resource',runtimeLogs:'PUBLIC protocol fixture, not actual runtime logs',operationLogs:[]});
  if(match[2]==='usage'){const sample={instanceId:operation.deploymentId,period:'2026-10-31',sampleSeq:'1',cpuNanos:'1000000',cpuMs:'1',memoryBytes:'4096',storedBytes:operation.contentBinding.bytes,egressBytes:'0'};return respond({requestId:match[1],instanceId:operation.deploymentId,billingState:state.usagePaid?'PAID':'UNPRICED',samples:{[`${sample.period}/${sample.sampleSeq}`]:sample},latest:sample});}
  const result=structuredClone(operation);if(state.tamper)state.tamper(result);if(state.switchAfterGet)state.owner='another-owner';return respond(result);
 }});
 const transport=createOriginalCloudDeploymentTransport(raw,{DeploymentClient:CloudDeploymentClient}),authorize=async()=>state.owner;
 const caller=()=>createCloudDeploymentCaller({db,authorize,transport});
 return {state,raw,DeploymentClient:CloudDeploymentClient,database:()=>db,caller:caller(),reopen(){db.close();open();return caller();},current:caller};
}
test('real original SDK+deployment client: rev0 success1, failure2, explicit new rollback3, logs and UNPRICED usage',async t=>{
 const f=await fixture(t),a=await f.caller.submit({}, {requestId,selection,approval,expectedSlotRevision:'0'});assert.equal(a.state,'completed');assert.equal(a.observation.slotRevision,'1');
 f.state.fail=true;const failed=await f.caller.submit({}, {requestId:'original_sdk_failed_2',selection:{...selection,version:'2',content:Buffer.from('PUBLIC broken deployment')},approval:Buffer.from('PUBLIC_NEW_APPROVAL_B'),expectedSlotRevision:'1'});assert.equal(failed.state,'failed');assert.equal(failed.observation.slotRevision,'2');
 f.state.fail=false;const rollback=await f.caller.submit({}, {requestId:'original_sdk_rollback_3',selection,approval:Buffer.from('PUBLIC_NEW_ROLLBACK_APPROVAL_C'),expectedSlotRevision:'2',rollbackTo:requestId});assert.equal(rollback.state,'completed');assert.equal(rollback.observation.slotRevision,'3');assert.equal(rollback.observation.rollbackTarget,requestId);
 assert.equal((await f.caller.logs({},'original_sdk_rollback_3')).runtimeLogSource,'original-resource');assert.equal((await f.caller.usage({},'original_sdk_rollback_3')).billingState,'UNPRICED');
 assert.equal(f.state.calls.filter(c=>c.method==='POST').length,3);assert.equal(f.state.proofs.length,f.state.calls.length);assert.ok(f.state.proofs.some(p=>p.path.endsWith('/usage')));assert.ok(f.state.proofs.every(p=>p.operationRequestId));
 f.state.usagePaid=true;await assert.rejects(f.caller.usage({},'original_sdk_rollback_3'));assert.equal(f.state.slot,3n);
});
test('lost POST response and real SQLite reopen only GET original ID; 404/403/503 never resubmit',async t=>{
 const f=await fixture(t);f.state.lose=true;assert.equal((await f.caller.submit({}, {requestId,selection,approval,expectedSlotRevision:'0'})).state,'unknown');
 const caller=f.reopen();for(const status of [404,403,503]){f.state.getStatus=status;assert.equal((await caller.reconcile({},requestId)).state,'unknown');}
 f.state.getStatus=200;assert.equal((await caller.submit({}, {requestId,selection,approval,expectedSlotRevision:'0'})).state,'completed');assert.equal(f.state.calls.filter(c=>c.method==='POST').length,1);assert.ok(f.state.calls.slice(1).every(c=>c.method==='GET'&&c.path.endsWith(requestId)));
});
test('actual SDK rejects tampered dual/slot/rollback and account changes; no receipt success leaks',async t=>{
 for(const tamper of [op=>op.contentBinding.sha512='0'.repeat(128),op=>op.contentBinding.sha3_512='0'.repeat(128),op=>op.slotRevision='2',op=>op.expectedSlotRevision='1',op=>op.rollbackTarget='another_original_target']){
  const f=await fixture(t);f.state.lose=true;await f.caller.submit({}, {requestId,selection,approval,expectedSlotRevision:'0'});f.state.tamper=tamper;assert.equal((await f.caller.reconcile({},requestId)).state,'unknown');assert.equal(f.state.calls.filter(c=>c.method==='POST').length,1);
 }
 const f=await fixture(t);f.state.lose=true;await f.caller.submit({}, {requestId,selection,approval,expectedSlotRevision:'0'});f.state.switchAfterGet=true;await assert.rejects(f.caller.reconcile({},requestId),{code:'deployment_authority'});
});
test('stale slot is rejected without automatic rollback or another submission; rollback requires exact old bytes and new approval',async t=>{
 const f=await fixture(t);await f.caller.submit({}, {requestId,selection,approval,expectedSlotRevision:'0'});
 const stale=await f.caller.submit({}, {requestId:'original_sdk_stale_2',selection,approval:Buffer.from('PUBLIC_NEW'),expectedSlotRevision:'0'});assert.equal(stale.state,'unknown');assert.equal(f.state.slot,1n);
 const before=f.state.calls.filter(c=>c.method==='POST').length;assert.equal((await f.caller.submit({}, {requestId:'original_sdk_stale_2',selection,approval:Buffer.from('PUBLIC_NEW'),expectedSlotRevision:'0'})).state,'unknown');assert.equal(f.state.calls.filter(c=>c.method==='POST').length,before);
 for(const change of [{approval},{selection:{...selection,content:Buffer.from('wrong bytes')}},{selection:{...selection,version:'changed'}}])await assert.rejects(f.caller.submit({}, {requestId:'original_sdk_bad_rollback',selection,approval:Buffer.from('PUBLIC_NEW_ROLLBACK'),expectedSlotRevision:'1',rollbackTo:requestId,...change}),{code:'deployment_rollback'});
 for(const expectedSlotRevision of ['01','-1','1.0','18446744073709551615',0])await assert.rejects(f.caller.submit({}, {requestId:'original_sdk_bad_revision',selection,approval,expectedSlotRevision}),{code:'deployment_operation'});
 assert.equal(f.state.calls.filter(c=>c.method==='POST').length,before);
});
test('legacy journal reconciles through real raw SDK without inventing a branded slot selection',async t=>{
 const f=await fixture(t),prepared=prepareCloudManifest(selection),receipt={requestId,binding:prepared.binding,manifestSHA256:hash(prepared.manifest),approvalSHA256:hash(approval),publisherId:'PUBLIC_PUBLISHER',resourceId:'PUBLIC_RESOURCE',state:'completed',exitCode:0,deploymentId:'PUBLIC_LEGACY_INSTANCE',runtimeUrl:'https://runtime.public.invalid/legacy'};
 f.database().prepare('INSERT INTO codeoss_cloud_operations(principal,request_id,fingerprint,manifest,approval,artifact,state,observation) VALUES(?,?,?,?,?,?,?,NULL)').run('original-owner',requestId,'original-legacy-fingerprint',prepared.manifest,approval,prepared.content,'unknown');f.state.operations.set(requestId,receipt);
 assert.equal((await f.caller.reconcile({},requestId)).state,'completed');assert.equal(f.state.calls.length,1);assert.equal(f.state.calls[0].method,'GET');assert.equal(f.database().prepare('SELECT selection FROM codeoss_cloud_operations').get().selection,null);
 assert.throws(()=>createOriginalCloudDeploymentTransport({product:'cloud',getDeploymentRequestHeaders:async()=>({}),submitIDEDeployment:async()=>{},getIDEDeploymentStatus:async()=>{}},{DeploymentClient:f.DeploymentClient}),/Original Cloud SDK/);
 assert.throws(()=>createOriginalCloudDeploymentTransport({product:'cloud',getAccessToken:async()=> 'not-a-deployment-proof'}));
});
