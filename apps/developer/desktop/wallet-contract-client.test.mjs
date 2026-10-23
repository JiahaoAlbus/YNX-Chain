import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {openProjectContractClient} from './wallet-contract-client.mjs';
import {openContractReferenceJournal,openRelayContractReferenceJournal,contractBroadcastReferenceId} from './wallet-contract-reference-journal.mjs';
const id='11111111-2222-3333-4444-555555555555', account='0x'+'a'.repeat(40), key='b'.repeat(64);
const input=()=>({method:'ynx_preparePQContractAction',params:[{version:1,account,action:{kind:'contract_deploy'}}]});
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
async function fixture(t) {
 const profile=await fs.realpath(await fs.mkdtemp(join(tmpdir(),'ynx-contract-client-')));await fs.chmod(profile,0o700);t.after(()=>fs.rm(profile,{recursive:true}));
 const state={kind:'ide-contract-relay-v1',origin:'https://developer.ynxweb4.com',chainId:'eip155:6423',projectId:'PUBLIC-canonical-project',projectGeneration:1,callerIdentity:'PUBLIC-signed-node-identity',expiresMS:Date.now()+60000,relayURL:'wss://relay.walletconnect.org',methods:['ynx_preparePQContractAction','ynx_preparePQContractBroadcast','ynx_getPQContractOriginal'],dataOnly:true,authorized:false,nativeAdmission:false};
 let calls=0, connects=0, cancels=0, handle, listener;
 const result=deferred();
 const connection={connect:async()=>{connects++;return {request:async({method})=>method==='eth_accounts'?[account]:'0x1917'};},cancel:async()=>{cancels++;},cleanupSnapshot:()=>({scope:'local-only'}),beginContractRequest(request){calls++;let snapshot={scope:'local-only',origin:'https://developer.ynxweb4.com',method:request.method,account,chainId:'eip155:6423',requestPayloadSHA256:createHash('sha256').update(JSON.stringify(request)).digest('hex'),state:'pending',originalRequestKeyHash:null,correlation:'missing',remoteOutcome:'not-proven',replayAllowed:false};handle={snapshot:()=>({...snapshot}),onCorrelation(fn){listener=fn;return()=>{};},outcome:result.promise.then(value=>{snapshot.state='fulfilled';return value;},error=>{snapshot.state='unknown';throw error;})};handle.event=(hash=key,conflict=false)=>{snapshot.originalRequestKeyHash=hash;snapshot.correlation=conflict?'conflict':'observed';return listener({...snapshot});};return handle;}};
 const options={context:{profile,id,workspace:'/PUBLIC/project'},relayAuthority:{assertCurrent:async()=>({...state})},createConnection:()=>connection};
 const client=await openProjectContractClient(options);
 return {profile,state,client,options,result,connection,get calls(){return calls;},get connects(){return connects;},get cancels(){return cancels;},get handle(){return handle;},file:join(profile,'wallet-contract-query-references-v2',id+'.jsonl')};
}
async function started(f) {for(let i=0;i<100&&!f.handle;i++)await new Promise(resolve=>setTimeout(resolve,2));assert.ok(f.handle);}
test('empty legacy directory does not invent unavailable request history',async t=>{const f=await fixture(t);await openContractReferenceJournal({profile:f.profile,projectId:id,owner:'PUBLIC-old-owner',account:'PUBLIC-old-principal'});const history=await f.client.listReferences();assert.equal(history.legacy.state,'none');assert.deepEqual(history.references,[]);await f.client.close();});
test('legacy UNKNOWN history is visibly retained without adopting its principal or returning empty history',async t=>{
 const f=await fixture(t),legacy=await openContractReferenceJournal({profile:f.profile,projectId:id,owner:'PUBLIC-old-owner',account:'PUBLIC-old-account'});
 await legacy.append(id,{account,method:'ynx_preparePQContractAction',requestPayloadSHA256:'d'.repeat(64),originalRequestKeyHash:key,operationId:null,transportHash:null,memberHash:null,state:'unknown'});
 const originalFile=join(f.profile,'wallet-contract-query-references',id+'.jsonl'),before=await fs.readFile(originalFile),history=await f.client.listReferences();
 assert.equal(history.legacy?.state,'retained-scope-unavailable');assert.deepEqual(history.references,[]);assert.equal(history.legacy.queryOnly,true);assert.equal(history.legacy.readable,false);assert.equal(JSON.stringify(history).includes(key),false);assert.deepEqual(await fs.readFile(originalFile),before);assert.equal(f.connects,0);assert.equal(f.calls,0);await f.client.close();
});
test('construction is offline; a single request returns only after actual durable correlation and survives reopen',async t=>{
 const f=await fixture(t);assert.equal(f.connects,0);assert.equal(f.calls,0);await f.client.connect();const pending=f.client.request({referenceId:id,input:input()});await started(f);
 const first=JSON.parse((await fs.readFile(f.file,'utf8')).trim());assert.equal(first.value.state,'pending');assert.equal(first.value.originalRequestKeyHash,null);
 await f.handle.event();f.result.resolve({PUBLIC:'Wallet result'});const result=await pending;assert.equal(result.reference.originalRequestKeyHash,key);assert.equal(result.reference.state,'saved');assert.equal(f.calls,1);
 const reopened=await openProjectContractClient(f.options);assert.equal((await reopened.read(id)).originalRequestKeyHash,key);assert.equal(f.connects,1);assert.equal(f.calls,1);
 await reopened.connect();await assert.rejects(reopened.request({referenceId:id,input:input()}),{code:'IDE_CONTRACT_REFERENCE_EXISTS'});assert.equal(f.calls,1);
});
test('project generation change before action prevents the original send',async t=>{
 const f=await fixture(t);await f.client.connect();f.state.projectGeneration++;await assert.rejects(f.client.request({referenceId:id,input:input()}),{code:'IDE_CONTRACT_RETIRED'});assert.equal(f.calls,0);await assert.rejects(fs.readFile(f.file),{code:'ENOENT'});
});
test('timeout retains original cause and a late original correlation is durable without resend',async t=>{
 const f=await fixture(t);await f.client.connect();const pending=f.client.request({referenceId:id,input:input()});await started(f);const cause=Error('PUBLIC original timeout');f.result.reject(cause);await assert.rejects(pending,error=>error===cause);await f.handle.event();const row=await f.client.read(id);assert.equal(row.state,'unknown');assert.equal(row.originalRequestKeyHash,key);assert.equal(f.calls,1);
});
test('cancellation fences late success while preserving original request coordinates',async t=>{
 const f=await fixture(t);await f.client.connect();const pending=f.client.request({referenceId:id,input:input()});await started(f);await f.handle.event();await f.client.close();f.result.resolve({PUBLIC:'late'});await assert.rejects(pending,{code:'IDE_CONTRACT_RETIRED'});const reopened=await openProjectContractClient(f.options);assert.equal((await reopened.read(id)).state,'unknown');assert.equal(f.calls,1);assert.equal(f.cancels,1);
});
test('a conflicting original callback never overwrites the first hash or returns successful completion',async t=>{
 const f=await fixture(t);await f.client.connect();const pending=f.client.request({referenceId:id,input:input()});await started(f);await f.handle.event();await f.handle.event('c'.repeat(64),true);f.result.resolve({PUBLIC:'not accepted'});await assert.rejects(pending,{code:'IDE_CONTRACT_REFERENCE_NOT_DURABLE'});const row=await f.client.read(id);assert.equal(row.originalRequestKeyHash,key);assert.equal(row.state,'unknown');assert.equal(f.calls,1);
});
test('a failed durable write after send does not become an RPC replay or a success',async t=>{
 const f=await fixture(t);await f.client.connect();const pending=f.client.request({referenceId:id,input:input()});await started(f);await f.handle.event();await fs.writeFile(f.file+'.lock','PUBLIC original writer',{mode:0o600,flag:'wx'});f.result.resolve({PUBLIC:'not durable'});await assert.rejects(pending,{code:'IDE_CONTRACT_REFERENCE_NOT_DURABLE'});assert.equal(await fs.readFile(f.file+'.lock','utf8'),'PUBLIC original writer');assert.equal(f.calls,1);
});

for(const namespace of ['legacy','previous-caller'])test('same unresolved action cannot cross '+namespace+' with a new UUID',async t=>{
 const f=await fixture(t),oldId='22222222-2222-3333-4444-555555555555';
 const journal=namespace==='legacy'?await openContractReferenceJournal({profile:f.profile,projectId:id,owner:'PUBLIC-old-owner',account:'PUBLIC-old-principal'}):await openRelayContractReferenceJournal({profile:f.profile,projectId:id,scope:{...f.state,callerIdentity:'PUBLIC-old-signed-caller'}});
 const row={account,method:input().method,requestPayloadSHA256:createHash('sha256').update(JSON.stringify(input())).digest('hex'),originalRequestKeyHash:key,operationId:null,transportHash:null,memberHash:null,state:'unknown'};await journal.append(oldId,row);
 const file=join(f.profile,namespace==='legacy'?'wallet-contract-query-references':'wallet-contract-query-references-v2',oldId+'.jsonl'),before=await fs.readFile(file);
 await f.client.connect();await assert.rejects(f.client.request({referenceId:id,input:input()}),e=>e.code==='IDE_CONTRACT_ORIGINAL_QUERY_REQUIRED'&&e.referenceId===oldId);assert.equal(f.calls,0);assert.deepEqual(await fs.readFile(file),before);await f.client.close();
});
test('an unresolved broadcast fences a new preparation across caller upgrade',async t=>{
 const f=await fixture(t),oldId='22222222-2222-3333-4444-555555555555',journal=await openRelayContractReferenceJournal({profile:f.profile,projectId:id,scope:{...f.state,callerIdentity:'PUBLIC-old-signed-caller'}}),broadcastId=contractBroadcastReferenceId(oldId);
 await journal.append(oldId,{account,method:input().method,requestPayloadSHA256:createHash('sha256').update(JSON.stringify(input())).digest('hex'),originalRequestKeyHash:key,operationId:'PUBLIC-operation',transportHash:'0x'+'1'.repeat(64),memberHash:'0x'+'2'.repeat(64),state:'saved'});
 await journal.append(broadcastId,{account,method:'ynx_preparePQContractBroadcast',requestPayloadSHA256:'d'.repeat(64),originalRequestKeyHash:'e'.repeat(64),operationId:null,transportHash:null,memberHash:null,state:'unknown'});
 await f.client.connect();await assert.rejects(f.client.request({referenceId:id,input:input()}),e=>e.code==='IDE_CONTRACT_ORIGINAL_QUERY_REQUIRED'&&e.referenceId===broadcastId);assert.equal(f.calls,0);await f.client.close();
});
test('damaged legacy data remains visible and blocks sensitive preparation without hiding the original',async t=>{
 const f=await fixture(t),journal=await openContractReferenceJournal({profile:f.profile,projectId:id,owner:'PUBLIC-old-owner',account:'PUBLIC-old-principal'});await journal.append(id,{account,method:input().method,requestPayloadSHA256:'d'.repeat(64),originalRequestKeyHash:key,operationId:null,transportHash:null,memberHash:null,state:'unknown'});const file=join(f.profile,'wallet-contract-query-references',id+'.jsonl');await fs.appendFile(file,'{');const before=await fs.readFile(file);assert.equal((await f.client.listReferences()).legacy.state,'retained-scope-unavailable');await f.client.connect();await assert.rejects(f.client.request({referenceId:id,input:input()}));assert.equal(f.calls,0);assert.deepEqual(await fs.readFile(file),before);await f.client.close();
});
test('another payload is not stopped merely because the profile retains old UNKNOWN data',async t=>{
 const f=await fixture(t),journal=await openContractReferenceJournal({profile:f.profile,projectId:id,owner:'PUBLIC-old-owner',account:'PUBLIC-old-principal'}),oldId='22222222-2222-3333-4444-555555555555';await journal.append(oldId,{account,method:input().method,requestPayloadSHA256:'d'.repeat(64),originalRequestKeyHash:key,operationId:null,transportHash:null,memberHash:null,state:'unknown'});await f.client.connect();const pending=f.client.request({referenceId:id,input:input()});await started(f);await f.handle.event();f.result.resolve({PUBLIC:'different approved operation'});await pending;assert.equal(f.calls,1);await f.client.close();
});

for(const orphan of [false,true])test('uncertain retained writer cannot grant a new preparation: '+(orphan?'orphan lock':'saved row with lock'),async t=>{
 const f=await fixture(t),journal=await openContractReferenceJournal({profile:f.profile,projectId:id,owner:'PUBLIC-old-owner',account:'PUBLIC-old-principal'}),oldId='22222222-2222-3333-4444-555555555555';
 if(!orphan)await journal.append(oldId,{account,method:input().method,requestPayloadSHA256:createHash('sha256').update(JSON.stringify(input())).digest('hex'),originalRequestKeyHash:key,operationId:'PUBLIC-operation',transportHash:'0x'+'1'.repeat(64),memberHash:'0x'+'2'.repeat(64),state:'saved'});
 const lock=join(f.profile,'wallet-contract-query-references',oldId+'.jsonl.lock');await fs.writeFile(lock,'PUBLIC uncertain writer',{mode:0o600,flag:'wx'});const begin=f.connection.beginContractRequest.bind(f.connection);f.connection.beginContractRequest=request=>{const handle=begin(request);queueMicrotask(()=>{void handle.event();f.result.resolve({PUBLIC:'unexpected duplicate accepted'});});return handle;};await f.client.connect();await assert.rejects(f.client.request({referenceId:id,input:input()}),{code:orphan?'IDE_CONTRACT_REFERENCE_NOT_DURABLE':'IDE_CONTRACT_ORIGINAL_QUERY_REQUIRED'});assert.equal(f.calls,0);assert.equal((await f.client.listReferences()).uncertainWriter,true);assert.equal(await fs.readFile(lock,'utf8'),'PUBLIC uncertain writer');await f.client.close();
});
