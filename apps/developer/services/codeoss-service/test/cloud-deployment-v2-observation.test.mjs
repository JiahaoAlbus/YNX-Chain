import {createRequire} from 'node:module';
import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createCloudDeploymentV2Caller} from '../src/cloud-deployment-v2-caller.mjs';

async function fixture(t){
 const root=process.env.YNX_ORIGINAL_CLOUD_ROOT;assert.ok(root,'Matching original Cloud client and published protocol required');
 const {YNXCloudClient}=await import(pathToFileURL(join(root,'sdk/index.js')));
 const {CloudDeploymentV2Client}=await import(pathToFileURL(join(root,'client/deployment-v2-client.mjs')));
 const vector=JSON.parse(await readFile(new URL('../test/fixtures/deployment-v2-manifest.json',pathToFileURL(createRequire(pathToFileURL(join(root,'client/deployment-v2-client.mjs'))).resolve('@ynx-chain/open-protocol/deployment-v2')))));
 const dir=await mkdtemp(join(tmpdir(),'ynx-original-observation-')),file=join(dir,'original.sqlite'),dbs=[];
 t.after(async()=>{for(const d of dbs)try{d.close();}catch{}await rm(dir,{recursive:true,force:true});});
 const id='req_PUBLIC_original_observation_1',calls=[],state={jsPostProofs:0,owner:'PUBLIC_test_owner',hold:null,mutate:null,status:200};
 state.headerRequests=[];state.httpSignals=[];
 let selection;
 const client=new CloudDeploymentV2Client(new YNXCloudClient({product:'cloud',endpoint:'https://public-fixture.invalid/api/v1',getDeploymentRequestHeaders:async(request,context)=>{state.headerRequests.push({request,context});if(request.method==='POST')state.jsPostProofs++;return {'x-ynx-product-session-proof-v5':'PUBLIC_NOT_AUTHORITY'};},fetch:async(url,options)=>{
  state.httpSignals.push(options.signal);const path=new URL(url).pathname;calls.push({path,method:options.method??'GET'});assert.equal(options.method??'GET','GET');
  if(state.hold){const h=state.hold;state.hold=null;h.enter();await h.wait;}
  if(state.status!==200)return Response.json({error:'PUBLIC revoked'},{status:state.status});
  if(path.endsWith('/logs'))return Response.json({requestId:id,deploymentId:'PUBLIC_RUNTIME',resourceId:'PUBLIC_RESOURCE',slotRevision:'1',contentBinding:selection.contentBinding,runtimeLogSource:'original-resource',runtimeLogs:'PUBLIC actual client log',operationLogs:[]});
  if(path.endsWith('/usage/records'))return Response.json({requestId:'CHANGED',samples:{}});
  const op={requestId:id,manifestVersion:'2',manifestV2:structuredClone(selection.manifest),manifestBinding:selection.manifestBinding,contentBinding:selection.contentBinding,expectedSlotRevision:'0',slotRevision:'1',rollbackTarget:'',state:'completed',exitCode:0,deploymentId:'PUBLIC_RUNTIME',resourceId:'PUBLIC_RESOURCE',catalogProjectId:'PUBLIC_PROJECT',runtimeUrl:'https://public-runtime.invalid/app'};
  state.mutate?.(op);return Response.json(op);
 }}));
 const open=()=>{const db=new DatabaseSync(file);dbs.push(db);db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL');return {db,caller:createCloudDeploymentV2Caller({db,authorize:async()=>state.owner,client})};};
 const first=open();const prepared=await first.caller.prepare({},{requestId:id,manifest:vector.manifest,artifact:Buffer.from(vector.actualHex,'hex'),expectedSlotRevision:'0'});selection=prepared.selection;
 // PUBLIC controlled persisted UNKNOWN, not an actual signed/submitted effect.
 first.db.prepare("UPDATE codeoss_cloud_operations SET state='unknown'").run();
 return {id,state,calls,client,selection,open,...first,read:()=>first.db.prepare('SELECT * FROM codeoss_cloud_operations').get()};
}
test('cold same-journal original logs use only GET and never promote persisted UNKNOWN',async t=>{
 const h=await fixture(t),before=h.read();h.db.close();const cold=h.open();
 const logs=await cold.caller.observe({},{requestId:h.id,view:'logs'});
 assert.equal(logs.runtimeLogs,'PUBLIC actual client log');assert.equal(h.calls.length,2);
 assert.ok(h.calls.every(c=>c.method==='GET'));assert.equal(h.calls.at(-1).path,`/api/v1/ide/deployments/${h.id}/logs`);
 assert.deepEqual(cold.db.prepare('SELECT * FROM codeoss_cloud_operations').get(),before);
});
test('full project Ref mismatch and malformed recorded usage refuse without journal changes',async t=>{
 const h=await fixture(t),before=h.read();
 h.state.mutate=op=>{op.manifestV2.project.rev='999';};
 await assert.rejects(h.caller.observe({},{requestId:h.id,view:'logs'}));assert.equal(h.calls.length,1);
 h.state.mutate=null;await assert.rejects(h.caller.observe({},{requestId:h.id,view:'usage'}));
 assert.ok(h.calls.at(-1).path.endsWith('/usage/records'));assert.deepEqual(h.read(),before);
});
test('late observation after cancel or owner switch is never returned to caller',async t=>{
 const h=await fixture(t);
 for(const change of ['cancel','owner']){
  let enter,release;const entered=new Promise(r=>enter=r),wait=new Promise(r=>release=r);h.state.hold={enter,wait};
  const controller=new AbortController(),pending=h.caller.observe({},{requestId:h.id,view:'logs'},{signal:controller.signal});
  await entered;if(change==='cancel')controller.abort();else h.state.owner='PUBLIC_other_owner';release();await assert.rejects(pending);
  h.state.owner='PUBLIC_test_owner';assert.equal(h.read().state,'unknown');
 }
 assert.ok(h.calls.every(c=>c.method==='GET'));
});
test('stored artifact changed during read rejects the late original result',async t=>{
 const h=await fixture(t);let enter,release;const entered=new Promise(r=>enter=r),wait=new Promise(r=>release=r);h.state.hold={enter,wait};
 const pending=h.caller.observe({},{requestId:h.id,view:'logs'});await entered;
 h.db.prepare('UPDATE codeoss_cloud_operations SET artifact=?').run(Buffer.from('PUBLIC tamper'));release();
 await assert.rejects(pending,{code:'deployment_integrity'});assert.equal(h.read().state,'unknown');
});
test('invalid invoice/day and unentered or absent original operation cannot enter effect',async t=>{
 const h=await fixture(t),before=h.read();
 await assert.rejects(h.caller.observe({},{requestId:h.id,view:'native-invoice-intent',period:'2026-02-30',productId:'cloud.ide-usage',sourceOrder:'new_order'}));
 await assert.rejects(h.caller.observe({},{requestId:h.id,view:'bill',period:'2026-02-30'}));assert.equal(h.calls.length,0);assert.deepEqual(h.read(),before);
 h.db.prepare("UPDATE codeoss_cloud_operations SET state='awaiting-approval'").run();await assert.rejects(h.caller.observe({},{requestId:h.id,view:'logs'}),{code:'deployment_observation'});
 await assert.rejects(h.caller.observe({},{requestId:'req_PUBLIC_missing_operation',view:'logs'}),{code:'deployment_not_found'});assert.equal(h.calls.length,0);
});
test('original read refusal propagates and never retries submission',async t=>{
 const h=await fixture(t),before=h.read();h.state.status=403;
 await assert.rejects(h.caller.observe({},{requestId:h.id,view:'logs'}));assert.deepEqual(h.read(),before);assert.ok(h.calls.every(c=>c.method==='GET'));
});
test('current original Native transport without Source stays UNKNOWN with zero fetch POST',async t=>{
 const h=await fixture(t);h.db.prepare("UPDATE codeoss_cloud_operations SET state='awaiting-approval'").run();
 const outcome=await h.caller.submit({},{requestId:h.id,approval:Buffer.from('PUBLIC_NOT_AN_APPROVAL')});
 assert.equal(outcome.state,'unknown');assert.equal(outcome.unavailable.status,503);assert.equal(h.calls.length,0);
 const status=h.client.originalNativeTransportStatus();assert.equal(h.state.jsPostProofs,0);assert.equal(status.acquisitionFailureCode,'AUTH_RUNTIME_IMAGE_ADMISSION_NOT_SUPPLIED');assert.equal(status.acquisitionEntered,true);assert.equal(status.ownerAcquired,false);assert.equal(status.SourceAdmission,false);assert.equal(status.NativeAdmission,false);
 await h.client.closeOriginalNativeTransport();
 assert.equal(h.read().state,'unknown');
});

test('runtime view is original-resource GET only, keeps UNKNOWN and never fetches runtimeUrl',async t=>{
 const h=await fixture(t),before=h.read();
 const runtime=await h.caller.observe({},{requestId:h.id,view:'runtime'});
 assert.equal(runtime.requestId,h.id);assert.equal(runtime.deploymentId,'PUBLIC_RUNTIME');
 assert.deepEqual(h.calls,[{path:`/api/v1/ide/deployments/${h.id}/runtime`,method:'GET'}]);
 assert.deepEqual(h.read(),before);
});
test('same outbox terminal refuses late running or conflicting terminal without rewriting receipt',async t=>{
 const h=await fixture(t);
 assert.equal((await h.caller.reconcile({},h.id)).state,'completed');const terminal=h.read();
 for(const change of [op=>{op.state='running';delete op.exitCode;},op=>{op.resourceId='OTHER_RESOURCE';}]){
  h.state.mutate=change;
  await assert.rejects(h.caller.reconcile({},h.id),{code:'deployment_terminal_conflict'});
  assert.deepEqual(h.read(),terminal);
 }
 h.state.mutate=op=>{op.updatedAt='2099-01-01T00:00:00Z';};
 assert.equal((await h.caller.reconcile({},h.id)).state,'completed');assert.deepEqual(h.read(),terminal);
 assert.ok(h.calls.every(call=>call.method==='GET'));
});
test('reconciliation refuses artifact tamper while original GET was in flight',async t=>{
 const h=await fixture(t);let enter,release;const entered=new Promise(r=>enter=r),wait=new Promise(r=>release=r);h.state.hold={enter,wait};
 const pending=h.caller.reconcile({},h.id);await entered;
 h.db.prepare('UPDATE codeoss_cloud_operations SET artifact=?').run(Buffer.from('PUBLIC tamper'));release();
 await assert.rejects(pending,{code:'deployment_integrity'});assert.equal(h.read().state,'unknown');
 assert.ok(h.calls.every(call=>call.method==='GET'));
});

test('fresh runtime read rejects a conflicting stored terminal without returning cached authority',async t=>{
 const h=await fixture(t);await h.caller.reconcile({},h.id);const terminal=h.read();
 h.state.mutate=op=>{op.state='running';delete op.exitCode;};
 await assert.rejects(h.caller.observe({},{requestId:h.id,view:'runtime'}),{code:'deployment_terminal_conflict'});
 assert.deepEqual(h.read(),terminal);
 h.state.mutate=null;h.state.status=403;
 await assert.rejects(h.caller.observe({},{requestId:h.id,view:'runtime'}));
 assert.deepEqual(h.read(),terminal);assert.ok(h.calls.every(call=>call.method==='GET'));
});

test('every observation forwards the same Host context without changing original selection or usage semantics',async t=>{
 const h=await fixture(t),before=h.read(),controller=new AbortController(),originalRequestContext=Object.freeze({signal:controller.signal});
 for(const [view,method] of [['runtime','runtime'],['logs','logs'],['usage','usage'],['bill','billOriginal'],['native-invoice-intent','nativeInvoiceIntentOriginal']]){
  let entered=0;
  h.client[method]=async(selection,...args)=>{
   entered++;const options=args.at(-1);
   assert.deepEqual(selection,h.selection);assert.equal(options.signal,controller.signal);
   assert.equal(options.originalRequestContext,originalRequestContext);
   await Promise.resolve();assert.equal(options.originalRequestContext,originalRequestContext);
   if(view==='usage')assert.equal(options.observe,false);
   if(view==='bill'||view==='native-invoice-intent')assert.equal(args[0],'2026-11-07');
   if(view==='native-invoice-intent'){assert.equal(options.productId,'cloud.ide-usage');assert.equal(options.sourceOrder,'PUBLIC_original_source');}
   return {requestId:h.id,state:'unknown'};
  };
  await h.caller.observe({},{requestId:h.id,view,period:'2026-11-07',productId:'cloud.ide-usage',sourceOrder:'PUBLIC_original_source'},{signal:controller.signal,originalRequestContext});
  assert.equal(entered,1);assert.deepEqual(h.read(),before);
 }
 assert.equal(h.calls.length,0); // PUBLIC client seam, not real HTTP or Native proof.
});

test('invalid supplied read context is rejected without reading accessor or entering client',async t=>{
 const h=await fixture(t),before=h.read(),signal=new AbortController().signal,other=new AbortController().signal;
 let accessorReads=0;
 const accessor=Object.freeze(Object.defineProperty({},'signal',{get(){accessorReads++;return signal;},enumerable:true}));
 for(const originalRequestContext of [null,1,{},Object.freeze({signal:other}),Object.freeze({signal,authority:true}),accessor]){
  await assert.rejects(h.caller.observe({},{requestId:h.id,view:'logs'},{signal,originalRequestContext}),{code:'deployment_read_context'});
 }
 assert.equal(accessorReads,0);assert.equal(h.calls.length,0);assert.deepEqual(h.read(),before);
});


test('original client carries the caller Host context through status and logs to the exact-four-key hook',async t=>{
 const h=await fixture(t),before=h.read(),signal=new AbortController().signal,originalRequestContext=Object.freeze({signal});
 const logs=await h.caller.observe({},{requestId:h.id,view:'logs'},{signal,originalRequestContext});
 assert.equal(logs.runtimeLogs,'PUBLIC actual client log');assert.equal(h.state.headerRequests.length,2);
 for(const {request,context} of h.state.headerRequests){
  assert.deepEqual(Object.keys(request).sort(),['method','operationRequestId','path','url']);
  assert.equal(request.method,'GET');assert.equal(request.operationRequestId,h.id);
  assert.equal(context,originalRequestContext);assert.equal(context.signal,signal);
 }
 assert.equal(h.state.httpSignals.length,2);assert.ok(h.state.httpSignals.every(value=>value===signal));
 assert.deepEqual(h.read(),before);assert.equal(h.state.jsPostProofs,0);
});
