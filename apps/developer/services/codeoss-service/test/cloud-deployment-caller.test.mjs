import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { createCloudDeploymentCaller, prepareCloudManifest } from '../src/cloud-deployment-caller.mjs';
const selection={projectId:'project-A',version:'1',publishPurpose:'web-preview',targetEnvironment:'qa',content:Buffer.from('actual artifact bytes')};
const approval=Buffer.from('opaque-original-approval');
const hash=v=>createHash('sha256').update(v).digest('hex');
const requestId='original_operation_1';
function setup(t,transport){const db=new DatabaseSync(':memory:');t.after(()=>db.close());const authorize=async()=> 'original-owner';return {db,authorize,caller:createCloudDeploymentCaller({db,authorize,transport})};}
function receipt(){const p=prepareCloudManifest(selection);return {requestId,binding:p.binding,manifestSHA256:hash(p.manifest),approvalSHA256:hash(approval),contentBinding:p.integrity,expectedSlotRevision:'0',slotRevision:'1',rollbackTarget:'',publisherId:'registered-publisher',resourceId:'existing-resource',state:'completed',exitCode:0,deploymentId:'original-deployment',runtimeUrl:'https://qa.example.test/original'};}

test('manifest is the actual Cloud six-field binding and clones caller bytes',()=>{
 const bytes=Buffer.from('hello'),prepared=prepareCloudManifest({...selection,content:bytes});bytes.fill(0);
 assert.equal(prepared.content.toString(),'hello');assert.equal(prepared.binding.contentDigest,hash(Buffer.from('hello')));
 assert.deepEqual(Object.keys(prepared.binding),['projectId','version','contentDigest','publishPurpose','targetEnvironment','byteSize']);
 assert.match(prepared.integrity.sha3_512,/^[a-f0-9]{128}$/);
 assert.notEqual(hash(prepared.manifest),hash(prepareCloudManifest({...selection,targetEnvironment:'production',content:Buffer.from('hello')}).manifest));
});
test('timeout is durable UNKNOWN; retry/restart only GET original operation and URL comes from receipt',async t=>{
 let posts=0,gets=0;
 const transport=async r=>{if(r.method==='POST'){posts++;assert.equal(r.headers['Idempotency-Key'],requestId);assert.deepEqual([...r.body.keys()],['manifest','approval','artifact']);throw Error('timeout after dispatch');}gets++;return {status:200,body:receipt()};};
 const f=setup(t,transport);assert.equal((await f.caller.submit({}, {requestId,selection,approval,expectedSlotRevision:'0'})).state,'unknown');
 const restarted=createCloudDeploymentCaller({db:f.db,authorize:f.authorize,transport});
 const result=await restarted.submit({}, {requestId,selection,approval,expectedSlotRevision:'0'});
 assert.equal(posts,1);assert.equal(gets,1);assert.equal(result.state,'completed');assert.equal(result.observation.runtimeUrl,receipt().runtimeUrl);
});
test('changing content, approval or environment with same operation conflicts before transport',async t=>{
 let requests=0;const f=setup(t,async()=>{requests++;throw Error('unknown');});
 await f.caller.submit({}, {requestId,selection,approval,expectedSlotRevision:'0'});
 for(const change of [{selection:{...selection,targetEnvironment:'production'}},{selection:{...selection,content:Buffer.from('other')}},{approval:Buffer.from('other')}])
  await assert.rejects(f.caller.submit({}, {requestId,selection,approval,expectedSlotRevision:'0',...change}),{code:'deployment_conflict'});
 assert.equal(requests,1);
});
test('404 never releases UNKNOWN or resubmits; mismatched receipt cannot report success',async t=>{
 let calls=0;const f=setup(t,async r=>{calls++;return r.method==='POST'?{status:503}:{status:404};});
 await f.caller.submit({}, {requestId,selection,approval,expectedSlotRevision:'0'});assert.equal((await f.caller.reconcile({},requestId)).state,'unknown');assert.equal(calls,2);
 const mismatch=createCloudDeploymentCaller({db:f.db,authorize:f.authorize,transport:async()=>({status:200,body:{...receipt(),binding:{...receipt().binding,targetEnvironment:'production'}}})});
 await assert.rejects(mismatch.reconcile({},requestId),{code:'deployment_receipt'});
 assert.equal(f.db.prepare('SELECT state FROM codeoss_cloud_operations').get().state,'unknown');
});
test('current authorization failure prevents POST and malformed completed URL/exit cannot pass',async t=>{
 const f=setup(t,async()=>({status:200,body:{...receipt(),exitCode:1}}));
 await assert.rejects(f.caller.submit({}, {requestId,selection,approval,expectedSlotRevision:'0'}),{code:'deployment_receipt'});
 let requests=0;const revoked=createCloudDeploymentCaller({db:f.db,authorize:async()=>{throw Error('revoked');},transport:async()=>{requests++;}});
 await assert.rejects(revoked.reconcile({},requestId),/revoked/);assert.equal(requests,0);
 const invalidURL=createCloudDeploymentCaller({db:f.db,authorize:f.authorize,transport:async()=>({status:200,body:{...receipt(),runtimeUrl:'https://user:secret@qa.example.test/'}})});
 await assert.rejects(invalidURL.reconcile({},requestId),{code:'deployment_receipt'});
});

test('late authorization failure or account switch cannot disclose a successful response',async t=>{
 const f=setup(t,async()=>{throw Error('timeout');});
 await f.caller.submit({}, {requestId,selection,approval,expectedSlotRevision:'0'});
 for(const switched of [false,true]) {
  let reads=0;
  const caller=createCloudDeploymentCaller({db:f.db,authorize:async()=>{if(++reads>1){if(switched)return 'another-owner';throw Error('revoked during response');}return 'original-owner';},transport:async()=>({status:200,body:receipt()})});
  await assert.rejects(caller.reconcile({},requestId),switched?{code:'deployment_authority'}:/revoked during response/);
 }
 assert.equal(f.db.prepare('SELECT state FROM codeoss_cloud_operations').get().state,'unknown');
});
test('a forged operation in an unauthorized HTTP response is never accepted',async t=>{
 const f=setup(t,async()=>({status:403,body:receipt()}));
 assert.equal((await f.caller.submit({}, {requestId,selection,approval,expectedSlotRevision:'0'})).state,'unknown');
});

test('old eight-column journal migration leaves selection NULL and permits only original reconciliation',async t=>{
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());
 db.exec('CREATE TABLE codeoss_cloud_operations(principal TEXT NOT NULL,request_id TEXT NOT NULL,fingerprint TEXT NOT NULL,manifest BLOB NOT NULL,approval BLOB NOT NULL,artifact BLOB NOT NULL,state TEXT NOT NULL,observation TEXT,PRIMARY KEY(principal,request_id))');
 const prepared=prepareCloudManifest(selection);db.prepare('INSERT INTO codeoss_cloud_operations VALUES(?,?,?,?,?,?,?,NULL)').run('original-owner',requestId,'legacy-original-fingerprint',prepared.manifest,approval,prepared.content,'unknown');
 const {contentBinding,expectedSlotRevision,slotRevision,rollbackTarget,...legacy}=receipt();let posts=0;
 const caller=createCloudDeploymentCaller({db,authorize:async()=> 'original-owner',transport:async request=>{if(request.method==='POST')posts++;assert.equal(request.selection,null);return {status:200,body:legacy};}});
 assert.equal(db.prepare('SELECT selection FROM codeoss_cloud_operations').get().selection,null);assert.equal((await caller.reconcile({},requestId)).state,'completed');assert.equal(db.prepare('SELECT selection FROM codeoss_cloud_operations').get().selection,null);
 await assert.rejects(caller.submit({}, {requestId,selection,approval,expectedSlotRevision:'0'}),{code:'deployment_legacy_reconcile_only'});await assert.rejects(caller.usage({},requestId),{code:'deployment_selection_unavailable'});assert.equal(posts,0);
});
test('late same-state or failed callbacks cannot rewrite a completed terminal receipt',async t=>{
 let resolveLate;const late=new Promise(resolve=>resolveLate=resolve),f=setup(t,async()=>({status:503}));await f.caller.submit({}, {requestId,selection,approval,expectedSlotRevision:'0'});
 let started;const entered=new Promise(resolve=>started=resolve);
 const slow=createCloudDeploymentCaller({db:f.db,authorize:f.authorize,transport:async()=>{started();await late;return {status:200,body:{...receipt(),runtimeUrl:'https://different.public.invalid/late'}};}});
 const waiting=slow.reconcile({},requestId);await entered;
 const fast=createCloudDeploymentCaller({db:f.db,authorize:f.authorize,transport:async()=>({status:200,body:receipt()})});const original=await fast.reconcile({},requestId);resolveLate();assert.deepEqual(await waiting,original);
 const failed=createCloudDeploymentCaller({db:f.db,authorize:f.authorize,transport:async()=>({status:200,body:{...receipt(),state:'failed',exitCode:2}})});assert.deepEqual(await failed.reconcile({},requestId),original);
});
test('new receipts require both DATA digests, exact expected slot and rollback identity',async t=>{
 for(const tamper of [op=>delete op.contentBinding,op=>op.contentBinding={...op.contentBinding,bytes:'999'},op=>op.expectedSlotRevision='01',op=>delete op.slotRevision,op=>op.slotRevision='2',op=>op.rollbackTarget='different_original_target']){
  const f=setup(t,async()=>({status:503}));await f.caller.submit({}, {requestId,selection,approval,expectedSlotRevision:'0'});
  const value=receipt();tamper(value);const invalid=createCloudDeploymentCaller({db:f.db,authorize:f.authorize,transport:async()=>({status:200,body:value})});await assert.rejects(invalid.reconcile({},requestId),{code:'deployment_receipt'});assert.equal(f.db.prepare('SELECT state FROM codeoss_cloud_operations').get().state,'unknown');
 }
});
