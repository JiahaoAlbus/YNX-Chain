import {createRequire} from 'node:module';
// PUBLIC transport stand-in controls only; not Native/Source or real durable HTTP acceptance.
import {selectPublicTransportControl} from './fixtures/cloud-native-v5-transport-control.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join} from 'node:path';import {pathToFileURL} from 'node:url';
import {createCloudDeploymentV2Caller} from '../src/cloud-deployment-v2-caller.mjs';
import {createCloudDeploymentCaller} from '../src/cloud-deployment-caller.mjs';
import {createOriginalDeploymentV2Signer} from '../src/original-deployment-v2-signer.mjs';
const approval=Buffer.from('PUBLIC_V2_TEST_BYTES_NOT_A_SIGNATURE'),requestId='req_PUBLIC_v2_original_operation_1';
async function fixture(t){
 const cloud=process.env.YNX_ORIGINAL_CLOUD_ROOT;assert.ok(cloud,'Original Cloud source and installed published codec required');
 const {YNXCloudClient}=await import(pathToFileURL(join(cloud,'sdk/index.js'))),{CloudDeploymentV2Client}=await import(pathToFileURL(join(cloud,'client/deployment-v2-client.mjs')));
 const vector=JSON.parse(await readFile(new URL('../test/fixtures/deployment-v2-manifest.json',pathToFileURL(createRequire(pathToFileURL(join(cloud,'client/deployment-v2-client.mjs'))).resolve('@ynx-chain/open-protocol/deployment-v2'))),'utf8'));
 const directory=await mkdtemp(join(tmpdir(),'ynx-v2-outbox-')),filename=join(directory,'original.sqlite'),dbs=[];
 t.after(async()=>{for(const db of dbs)try{db.close();}catch{}await rm(directory,{recursive:true,force:true});});
 const state={owner:'original-owner',operations:new Map(),calls:[],proofSnapshots:[],slot:0n,lose:false,status:200,unavailable:false,authorize:null};
 const authorize=async(ctx,op,selection)=>{if(state.authorize)await state.authorize(op,selection);return state.owner;};
 const headers=async request=>{
  if(request.method==='POST'){assert.ok(request.bodyOriginal instanceof Uint8Array);assert.match(request.contentType,/^multipart\/form-data; boundary=/);state.proofSnapshots.push({requestId:request.operationRequestId,body:Buffer.from(request.bodyOriginal),contentType:request.contentType});}
  return {'X-Public-Test-Proof':'NOT_A_REAL_PROOF','x-ynx-product-session-proof-v5':'PUBLIC_CONTROL_NOT_AUTHORITY'};
 };
 const fetch=async(url,options)=>{
  const path=new URL(url).pathname,method=options.method||'GET';state.calls.push({path,method,headers:options.headers});assert.equal(options.headers.get('X-Public-Test-Proof'),'NOT_A_REAL_PROOF');
  if(method==='POST'){
   assert.equal(path,'/api/v1/ide/deployments');assert.equal(options.headers.get('X-Deployment-Manifest-Version'),'2');
   const snapshot=state.proofSnapshots.findLast(s=>s.requestId===options.headers.get('Idempotency-Key'));assert.ok(snapshot);assert.equal(options.headers.get('Content-Type'),snapshot.contentType);assert.deepEqual(Buffer.from(options.body),snapshot.body);
   const form=await new Request(url,{method:'POST',headers:{'Content-Type':snapshot.contentType},body:options.body}).formData();assert.deepEqual([...form.keys()],['manifest','approval','artifact']);
   assert.equal(options.headers.get('X-Expected-Deployment-Revision'),String(state.slot));
   const payload=Buffer.from(await form.get('manifest').arrayBuffer());assert.equal(payload.toString('hex'),vector.payloadHex);assert.equal(Buffer.from(await form.get('artifact').arrayBuffer()).toString('hex'),vector.actualHex);
   if(state.expectedMember)assert.deepEqual(Buffer.from(await form.get('approval').arrayBuffer()),state.expectedMember);
   if(state.unavailable)return Response.json({error:'IDE_DEPLOYMENT_V2_AUTHORITY_UNAVAILABLE'},{status:503});
   const id=options.headers.get('Idempotency-Key');state.slot++;
   const operation={requestId:id,manifestVersion:'2',manifestV2:structuredClone(vector.manifest),manifestBinding:vector.binding,contentBinding:vector.manifest.artifact.content,expectedSlotRevision:String(state.slot-1n),slotRevision:String(state.slot),rollbackTarget:options.headers.get('X-Rollback-To')||'',state:state.initialState||'completed',exitCode:0,deploymentId:'PUBLIC_RUNTIME',resourceId:'PUBLIC_RESOURCE',catalogProjectId:'PUBLIC_PROJECT',runtimeUrl:'https://public-runtime.invalid/app'};
   state.operations.set(id,operation);if(state.holdPost){const hold=state.holdPost;state.holdPost=null;hold.entered();await hold.release;}if(state.lose){state.lose=false;throw Error('PUBLIC lost response after entered POST');}return Response.json(operation);
  }
  const id=path.split('/').at(-1);if(state.status!==200)return Response.json({error:'PUBLIC read unavailable'},{status:state.status});const value=state.operations.get(id);if(state.holdNextGet){const hold=state.holdNextGet;state.holdNextGet=null;const captured=structuredClone(value);hold.entered();await hold.release;return captured?Response.json(captured):Response.json({error:'not found'},{status:404});}return value?Response.json(value):Response.json({error:'not found'},{status:404});
 };
 selectPublicTransportControl(cloud,{headers,fetch});
 const client=()=>new CloudDeploymentV2Client(new YNXCloudClient({product:'cloud',endpoint:'https://public-protocol.invalid/api/v1',getDeploymentRequestHeaders:headers,fetch}));
 const open=(options={})=>{const db=new DatabaseSync(filename);db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');dbs.push(db);return {db,caller:createCloudDeploymentV2Caller({db,authorize,client:client(),...options})};};
 return {vector,state,open,client,authorize,input:(overrides={})=>({requestId,manifest:structuredClone(vector.manifest),artifact:Buffer.from(vector.actualHex,'hex'),expectedSlotRevision:'0',...overrides})};
}
test('PUBLIC transport control: actual original V2 codec captures exact payload in original journal, separate approval enters unchanged POST and bindings',async t=>{
 const h=await fixture(t),{caller,db}=h.open(),input=h.input(),prepared=await caller.prepare({},input);assert.equal(prepared.state,'awaiting-approval');assert.equal(prepared.payloadOriginal.toString('hex'),h.vector.payloadHex);assert.equal(h.state.calls.length,0);
 assert.equal(prepared.selection.manifest.publisherEpoch,'3');assert.equal(prepared.selection.manifest.publisher.rev,'7');assert.equal(prepared.selection.manifest.issuerEpoch,'11');assert.equal(prepared.selection.manifest.issuer.rev,'29');
 input.manifest.env='changed';input.artifact.fill(0);prepared.payloadOriginal.fill(0);assert.equal(Buffer.from(db.prepare('SELECT manifest FROM codeoss_cloud_operations').get().manifest).toString('hex'),h.vector.payloadHex);
 const op=await caller.submit({},{requestId,approval});assert.equal(op.state,'completed');assert.equal(h.state.calls.filter(c=>c.method==='POST').length,1);
 await caller.submit({},{requestId,approval});assert.equal(h.state.calls.filter(c=>c.method==='POST').length,1);
});
test('PUBLIC transport control: lost entered response and SQLite reopen only query the exact original operation, never replay POST',async t=>{
 const h=await fixture(t),first=h.open();await first.caller.prepare({},h.input());h.state.lose=true;assert.equal((await first.caller.submit({},{requestId,approval})).state,'unknown');first.db.close();const second=h.open();assert.equal((await second.caller.submit({},{requestId,approval})).state,'completed');assert.equal(h.state.calls.filter(c=>c.method==='POST').length,1);assert.equal(h.state.calls.at(-1).path,'/api/v1/ide/deployments/'+requestId);
});
test('PUBLIC transport control: real caller preserves explicit 503 authority gate and 404/403/503 read failures without another submission',async t=>{
 const h=await fixture(t),{caller}=h.open();await caller.prepare({},h.input());h.state.unavailable=true;const outcome=await caller.submit({},{requestId,approval});assert.equal(outcome.state,'unknown');assert.equal(outcome.unavailable.status,503);
 for(const status of [404,403,503]){h.state.status=status;assert.equal((await caller.submit({},{requestId,approval})).state,'unknown');}assert.equal(h.state.calls.filter(c=>c.method==='POST').length,1);assert.equal((await caller.prepare({},h.input())).state,'unknown');await assert.rejects(caller.submit({},{requestId,approval:Buffer.from('DIFFERENT_PUBLIC_APPROVAL')}),{code:'deployment_conflict'});
});
test('PUBLIC transport control: revocation between durable claim and effect leaves original UNKNOWN and cannot submit with a restored caller',async t=>{
 const h=await fixture(t),{caller}=h.open();await caller.prepare({},h.input());let checks=0;h.state.authorize=async op=>{if(op==='submit-deployment-v2'&&++checks===2)throw Object.assign(Error('revoked'),{code:'original_revoked'});};await assert.rejects(caller.submit({},{requestId,approval}),{code:'original_revoked'});assert.equal(h.state.calls.length,0);h.state.authorize=null;assert.equal((await h.open().caller.submit({},{requestId,approval})).state,'unknown');assert.equal(h.state.calls.some(c=>c.method==='POST'),false);
});
test('PUBLIC transport control: two actual SQLite callers race one approval claim and enter only one POST',async t=>{
 const h=await fixture(t),a=h.open(),b=h.open();await a.caller.prepare({},h.input());const results=await Promise.all([a.caller.submit({},{requestId,approval}),b.caller.submit({},{requestId,approval})]);assert.ok(results.some(x=>x.state==='completed'));assert.equal(h.state.calls.filter(c=>c.method==='POST').length,1);
});
test('PUBLIC transport control: changed selection, stored payload, or artifact rejects before signing/submission',async t=>{
 const h=await fixture(t),{caller,db}=h.open();await caller.prepare({},h.input());await assert.rejects(caller.prepare({},h.input({expectedSlotRevision:'1'})),{code:'deployment_conflict'});db.prepare('UPDATE codeoss_cloud_operations SET artifact=?').run(Buffer.from('PUBLIC TAMPER'));await assert.rejects(caller.submit({},{requestId,approval}));assert.equal(h.state.calls.length,0);
});
test('PUBLIC transport control: legacy rows stay legacy and legacy caller cannot reinterpret V2 binary payload',async t=>{
 const h=await fixture(t),{caller,db}=h.open();await caller.prepare({},h.input());const legacy=createCloudDeploymentCaller({db,authorize:h.authorize,transport:async()=>{throw Error('must not dispatch');}});await assert.rejects(legacy.reconcile({},requestId),{code:'deployment_version'});
 db.prepare('UPDATE codeoss_cloud_operations SET selection=NULL').run();await assert.rejects(caller.reconcile({},requestId),{code:'deployment_version'});assert.equal(h.state.calls.length,0);
});
test('PUBLIC transport control: rollback requires a new request, new approval and exact original successful bytes with explicit slot',async t=>{
 const h=await fixture(t),{caller}=h.open();await caller.prepare({},h.input());await caller.submit({},{requestId,approval});const rollback='req_PUBLIC_v2_original_rollback_2';await caller.prepare({},h.input({requestId:rollback,rollbackTo:requestId,expectedSlotRevision:'1'}));await assert.rejects(caller.submit({},{requestId:rollback,approval}),{code:'deployment_rollback'});const done=await caller.submit({},{requestId:rollback,approval:Buffer.from('PUBLIC_V2_NEW_APPROVAL_NOT_A_SIGNATURE')});assert.equal(done.state,'completed');assert.equal(h.state.calls.filter(c=>c.method==='POST').at(-1).headers.get('X-Rollback-To'),requestId);
});

test('PUBLIC transport control: late original running observation cannot replace a completed outbox result',{timeout:5000},async t=>{
 const h=await fixture(t),first=h.open(),second=h.open();h.state.initialState='running';await first.caller.prepare({},h.input());assert.equal((await first.caller.submit({},{requestId,approval})).state,'running');
 let entered,release;const arrived=new Promise(r=>entered=r),resume=new Promise(r=>release=r);h.state.holdNextGet={entered,release:resume};const late=first.caller.reconcile({},requestId);await arrived;h.state.operations.get(requestId).state='completed';assert.equal((await second.caller.reconcile({},requestId)).state,'completed');release();await assert.rejects(late,{code:'deployment_terminal_conflict'});assert.equal(first.db.prepare('SELECT state FROM codeoss_cloud_operations').get().state,'completed');
});
test('PUBLIC transport control: persisted selection cannot be rewritten even alongside matching codec bytes',async t=>{
 const h=await fixture(t),{caller,db}=h.open();await caller.prepare({},h.input());const row=db.prepare('SELECT selection FROM codeoss_cloud_operations').get(),changed=JSON.parse(row.selection);changed.expectedSlotRevision='1';db.prepare('UPDATE codeoss_cloud_operations SET selection=?').run(JSON.stringify(changed));await assert.rejects(caller.submit({},{requestId,approval}),{code:'deployment_integrity'});assert.equal(h.state.calls.length,0);
});

test('PUBLIC transport control: cancelled preparation and pre-entry submit never create a task or send requests',async t=>{
 const h=await fixture(t),{caller,db}=h.open(),cancel=new AbortController();cancel.abort();await assert.rejects(caller.prepare({},h.input(),{signal:cancel.signal}),{name:'AbortError'});assert.equal(db.prepare('SELECT count(*) AS n FROM codeoss_cloud_operations').get().n,0);
 await caller.prepare({},h.input());await assert.rejects(caller.submit({},{requestId,approval},{signal:cancel.signal}),{name:'AbortError'});assert.equal(db.prepare('SELECT state FROM codeoss_cloud_operations').get().state,'awaiting-approval');assert.equal(h.state.calls.length,0);
});
test('PUBLIC transport control: late entered result after cancellation is retained as observation but never returned to cancelled caller',{timeout:5000},async t=>{
 const h=await fixture(t),{caller,db}=h.open();await caller.prepare({},h.input());let entered,release;const arrived=new Promise(r=>entered=r),resume=new Promise(r=>release=r);h.state.holdPost={entered,release:resume};const cancel=new AbortController(),pending=caller.submit({},{requestId,approval},{signal:cancel.signal});await arrived;cancel.abort();release();await assert.rejects(pending,{name:'AbortError'});
 assert.equal(db.prepare('SELECT state FROM codeoss_cloud_operations').get().state,'completed');assert.equal((await h.open().caller.reconcile({},requestId)).state,'completed');assert.equal(h.state.calls.filter(x=>x.method==='POST').length,1);
});

function publicSigner(h,{pendingJoin=false,signError}={}) {
 const state={acquires:0,signs:0,closes:0,pendingJoin};
 const partial={phase:'RETURNED',payloadOriginal:Buffer.from(h.vector.payloadHex,'hex').toString('base64url'),payloadBinding:structuredClone(h.vector.binding),artifactBinding:structuredClone(h.vector.manifest.artifact.content),sourceCurrentOriginal:'PUBLIC_SOURCE_CURRENT_NOT_AUTHORITY',reservationOriginal:'PUBLIC_ONCE_NOT_AUTHORITY',memberOriginal:approval.toString('base64url'),coreStatus:0,cleanupStatus:2,reportedStatus:0,signed:true,sourceGranted:false,nativeAdmission:false,deployed:false};
 const signer=createOriginalDeploymentV2Signer({originalSDK:{acquireOriginalIDEDeploymentV2Signer(){state.acquires++;return {error:null,owner:{
  async signOriginalE11(payload,artifact){state.signs++;assert.equal(payload.toString('hex'),h.vector.payloadHex);assert.equal(artifact.toString('hex'),h.vector.actualHex);if(signError)throw signError;return partial;},
  status(){return {partial};},retire(){},join(){if(state.pendingJoin)throw Error('PUBLIC pending join');},close(){state.closes++;},
 }};}}});return {state,signer,partial};
}
test('PUBLIC transport control: signed member survives reopen and original SDK sends the identical proven whole multipart without client execution grant',async t=>{
 const h=await fixture(t),s=publicSigner(h),first=h.open({signer:s.signer});await first.caller.prepare({},h.input());
 assert.equal((await first.caller.signPrepared({},{requestId})).signing.state,'signed');assert.equal(h.state.calls.length,0);assert.equal(s.state.signs,1);assert.equal(s.state.closes,1);
 const second=h.open({signer:s.signer});assert.equal((await second.caller.signPrepared({},{requestId})).signing.state,'signed');assert.equal(s.state.signs,1);
 h.state.expectedMember=approval;assert.equal((await second.caller.submitSigned({},{requestId})).state,'completed');
 const row=second.db.prepare('SELECT * FROM codeoss_cloud_operations').get();assert.deepEqual(Buffer.from(row.approval),approval);assert.equal(row.upload_content_type,h.state.proofSnapshots[0].contentType);assert.match(row.upload_body_sha256,/^[0-9a-f]{64}$/);
 await second.caller.submitSigned({},{requestId});assert.equal(h.state.calls.filter(x=>x.method==='POST').length,1);assert.equal(s.state.signs,1);
});
test('PUBLIC transport control: pending original cleanup prevents POST; cleanup completion cannot promote UNKNOWN or re-sign after reopen',async t=>{
 const h=await fixture(t),s=publicSigner(h,{pendingJoin:true}),first=h.open({signer:s.signer});await first.caller.prepare({},h.input());
 await assert.rejects(first.caller.signPrepared({},{requestId}),e=>e.cleanupPending===true);
 assert.equal(first.db.prepare('SELECT signing_state FROM codeoss_cloud_operations').get().signing_state,'unknown');assert.equal(s.state.closes,0);
 await assert.rejects(first.caller.submitSigned({},{requestId}),{code:'IDE_DEPLOYMENT_V2_SIGNING_RECONCILE_REQUIRED'});
 s.state.pendingJoin=false;const cleaned=await first.caller.finishSigningCleanup({},{requestId});assert.equal(cleaned.signing.cleanupPending,false);assert.equal(cleaned.signing.state,'unknown');assert.equal(s.state.closes,1);
 await h.open({signer:s.signer}).caller.signPrepared({},{requestId});assert.equal(s.state.signs,1);assert.equal(h.state.calls.length,0);
});
test('PUBLIC transport control: unavailable dedicated original Source leaves prepared operation unentered and exact data preserved',async t=>{
 const h=await fixture(t),signer=createOriginalDeploymentV2Signer({originalSDK:{acquireOriginalIDEDeploymentV2Signer(){throw Object.assign(Error('Source absent'),{code:'IDE_DEPLOYMENT_V2_ROOT_PROFILE_NOT_SUPPLIED'});}}}),{caller,db}=h.open({signer});
 await caller.prepare({},h.input());await assert.rejects(caller.signPrepared({},{requestId}),{code:'IDE_DEPLOYMENT_V2_ROOT_PROFILE_NOT_SUPPLIED'});
 const row=db.prepare('SELECT * FROM codeoss_cloud_operations').get();assert.equal(row.signing_state,null);assert.equal(row.state,'awaiting-approval');assert.equal(Buffer.from(row.manifest).toString('hex'),h.vector.payloadHex);assert.equal(h.state.calls.length,0);
});
test('PUBLIC transport control: lost signed whole-body POST reopens as original GET only, even if new upload support is unavailable',async t=>{
 const h=await fixture(t),s=publicSigner(h),first=h.open({signer:s.signer});await first.caller.prepare({},h.input());await first.caller.signPrepared({},{requestId});
 h.state.lose=true;assert.equal((await first.caller.submitSigned({},{requestId})).state,'unknown');
 const readOnlyClient=h.client();readOnlyClient.captureOriginalE11Result=undefined;readOnlyClient.captureMultipartOriginal=undefined;readOnlyClient.submitOriginalE11=undefined;
 const reopened=h.open({signer:s.signer,client:readOnlyClient});assert.equal((await reopened.caller.submitSigned({},{requestId})).state,'completed');assert.equal(s.state.signs,1);assert.equal(h.state.calls.filter(x=>x.method==='POST').length,1);assert.equal(h.state.calls.at(-1).method,'GET');
});
test('PUBLIC transport control: unconfirmed native cleanup in persisted public partial is rejected by original SDK before proof or POST',async t=>{
 const h=await fixture(t),s=publicSigner(h),{caller,db}=h.open({signer:s.signer});await caller.prepare({},h.input());await caller.signPrepared({},{requestId});
 const row=db.prepare('SELECT signing_partial FROM codeoss_cloud_operations').get(),partial=JSON.parse(row.signing_partial);partial.cleanupStatus=0;db.prepare('UPDATE codeoss_cloud_operations SET signing_partial=?').run(JSON.stringify(partial));
 await assert.rejects(caller.submitSigned({},{requestId}),/reconciliation/);assert.equal(h.state.proofSnapshots.length,0);assert.equal(h.state.calls.length,0);assert.equal(db.prepare('SELECT state FROM codeoss_cloud_operations').get().state,'awaiting-approval');
});
test('PUBLIC transport control: new request IDs reject before prepare, authority, journal, signing or transport',async()=>{
 const db=new DatabaseSync(':memory:');let calls=0;const forbidden=()=>{calls++;throw Error('must not enter');};
 try{const caller=createCloudDeploymentV2Caller({db,authorize:forbidden,client:{prepare:forbidden,payloadOriginal:forbidden,verifyReadback:forbidden,submitPrepared:forbidden,lookupOriginal:forbidden},signer:{sign:forbidden}});
  for(const id of ['PUBLIC_legacy_operation_1','req_'+'a'.repeat(11),'req_'+'a'.repeat(81),'req_abcdefghijkl\n','req_abc defghijkl'])await assert.rejects(caller.prepare({},{requestId:id,manifest:{},artifact:Buffer.from('PUBLIC'),expectedSlotRevision:'0'}),{code:'deployment_request_id'});
  assert.equal(calls,0);assert.equal(db.prepare('SELECT count(*) AS n FROM codeoss_cloud_operations').get().n,0);
 }finally{db.close();}
});
test('PUBLIC transport control: new request ID boundary lengths are captured unchanged by original prepare',async t=>{
 const h=await fixture(t),{caller,db}=h.open();for(const n of [12,80]){const id='req_'+'a'.repeat(n);assert.equal((await caller.prepare({},h.input({requestId:id}))).requestId,id);}
 assert.equal(db.prepare('SELECT count(*) AS n FROM codeoss_cloud_operations').get().n,2);assert.equal(h.state.calls.length,0);
});
test('PUBLIC transport control: historical signed UNKNOWN ID reopens as GET-only without renaming, resigning or replacing original bytes',async t=>{
 const h=await fixture(t),s=publicSigner(h),{caller,db}=h.open({signer:s.signer}),legacy='PUBLIC_old_signed_operation_1';
 // PUBLIC historical-journal fixture only; no production row is migrated.
 const prepared=h.client().prepare(h.vector.manifest,Buffer.from(h.vector.actualHex,'hex'),{requestId,expectedSlotRevision:'0'}),selection={...prepared.selection,requestId:legacy},encoded=JSON.stringify(selection);
 db.prepare('INSERT INTO codeoss_cloud_operations(principal,request_id,fingerprint,manifest,approval,artifact,state,selection,signing_state,signing_partial,signing_cleanup) VALUES(?,?,?,?,?,?,?,?,?,?,0)').run(h.state.owner,legacy,createHash('sha256').update(encoded).digest('hex'),Buffer.from(h.vector.payloadHex,'hex'),approval,Buffer.from(h.vector.actualHex,'hex'),'unknown',encoded,'signed',JSON.stringify(s.partial));
 h.state.operations.set(legacy,{requestId:legacy,manifestVersion:'2',manifestV2:structuredClone(h.vector.manifest),manifestBinding:h.vector.binding,contentBinding:h.vector.manifest.artifact.content,expectedSlotRevision:'0',slotRevision:'1',rollbackTarget:'',state:'completed',exitCode:0,deploymentId:'PUBLIC_RUNTIME',resourceId:'PUBLIC_RESOURCE',catalogProjectId:'PUBLIC_PROJECT',runtimeUrl:'https://public-runtime.invalid/app'});
 assert.equal((await caller.reconcile({},legacy)).state,'completed');assert.equal((await caller.submitSigned({},{requestId:legacy})).state,'completed');assert.equal((await caller.signPrepared({},{requestId:legacy})).state,'completed');
 const row=db.prepare('SELECT * FROM codeoss_cloud_operations').get();assert.equal(row.request_id,legacy);assert.deepEqual(Buffer.from(row.approval),approval);assert.equal(row.signing_partial,JSON.stringify(s.partial));assert.equal(s.state.signs,0);assert.ok(h.state.calls.every(c=>c.method==='GET'));
});
test('PUBLIC transport control: historical unsigned prepared ID cannot consume a new signature or enter a POST claim',async t=>{
 const h=await fixture(t),s=publicSigner(h),{caller,db}=h.open({signer:s.signer}),legacy='PUBLIC_old_prepared_operation_1';
 const prepared=h.client().prepare(h.vector.manifest,Buffer.from(h.vector.actualHex,'hex'),{requestId,expectedSlotRevision:'0'}),selection={...prepared.selection,requestId:legacy},encoded=JSON.stringify(selection);
 db.prepare('INSERT INTO codeoss_cloud_operations(principal,request_id,fingerprint,manifest,approval,artifact,state,selection) VALUES(?,?,?,?,?,?,?,?)').run(h.state.owner,legacy,createHash('sha256').update(encoded).digest('hex'),Buffer.from(h.vector.payloadHex,'hex'),Buffer.alloc(0),Buffer.from(h.vector.actualHex,'hex'),'awaiting-approval',encoded);
 await assert.rejects(caller.signPrepared({},{requestId:legacy}),{code:'deployment_request_id'});await assert.rejects(caller.submit({},{requestId:legacy,approval}),{code:'deployment_request_id_reconcile_only'});
 const row=db.prepare('SELECT * FROM codeoss_cloud_operations').get();assert.equal(row.request_id,legacy);assert.equal(row.state,'awaiting-approval');assert.equal(row.signing_state,null);assert.equal(row.approval.length,0);assert.equal(s.state.signs,0);assert.equal(h.state.calls.length,0);
});
