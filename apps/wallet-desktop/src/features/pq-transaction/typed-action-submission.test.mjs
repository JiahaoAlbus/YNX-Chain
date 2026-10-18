import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {parsePQAccountAuthorization} from '@ynx-chain/wallet-auth/pq-wallet-policy';
import {createPQWalletKeyHandle,readPQWalletKeyPublic,destroyPQWalletKeyHandle} from '@ynx-chain/wallet-auth/pq-wallet-key-backup';
import {pqPublicBindingToRegistrationKeys} from '@ynx-chain/wallet-auth/pq-wallet-authorization';
import {encodePQActionTransportData} from '@ynx-chain/wallet-auth/pq-action-transport';
import {preparePQTypedActionReview,signPQReviewedTypedAction} from './typed-action-caller.mjs';
import {createPQTransactionSubmission} from './submission.mjs';
import {FileTransactionIntentStore} from '../../transaction-intent-store.mjs';
import {pqTypedBroadcastPermissionRequest} from '../../wallet-pq-typed-permission.mjs';
import {capturePQProgressResult,parsePQProgressResult} from '../../wallet-pq-progress.mjs';
import {TransactionPermissionKernel} from '../../original-policy-supplier/transaction-permission-kernel.mjs';
const hash=b=>'0x'+createHash('sha256').update(b).digest('hex'),copy=x=>JSON.parse(JSON.stringify(x));
const freeze=x=>{if(x&&typeof x==='object'){for(const v of Object.values(x))freeze(v);Object.freeze(x)}return x};
let handle,record,member,currentSnapshot;
before(async()=>{
 const input=JSON.parse(readFileSync(new URL('./fixtures/typed-action-public-inputs.json',import.meta.url))).rows.find(x=>x.kind==='resource_delegation_create');
 handle=await createPQWalletKeyHandle({chainId:input.chainId,owner:input.owner});const pair=pqPublicBindingToRegistrationKeys(readPQWalletKeyPublic(handle));
 const dto={owner:input.owner,executionHeight:'9007199254740994',ledgerNonce:'9007199254740993',algorithmVersion:'YNX-BATCH/v0.1',enabled:true,policyVersion:'YNX-ACCOUNT-POLICY/v1',networkId:input.chainId,enableAt:'10',activeRevision:'1',records:[{algorithmVersion:'YNX-BATCH/v0.1',owner:input.owner,pkA:pair.pkA,pkB:pair.pkB,revision:'1',registeredAt:'10',activeFrom:'11',ledgerNonce:'1'}]};
 const network={owner:input.owner,chainId:input.chainId,nativeChainId:'6423'},snapshot=parsePQAccountAuthorization(dto,network),selected={account:input.owner,networkId:input.chainId},at=Date.now();
 const review=preparePQTypedActionReview(snapshot,input,{...selected,operationId:'controlled-typed-submission',createdAt:new Date(at).toISOString(),expiresAt:new Date(at+60000).toISOString()});
 member=signPQReviewedTypedAction(review,snapshot,handle,selected,at);const raw=encodePQActionTransportData({member,originals:[]});
 record={version:2,account:input.owner,kind:'pq-typed-action',operationId:review.operationId,hash:hash(raw),wire:Buffer.from(raw).toString('base64url'),status:'signed-unsubmitted',typed:{networkId:input.chainId,memberHash:hash(member),review:copy(review),reviewSnapshot:copy(dto),signingSnapshot:copy(dto)}};
 currentSnapshot=parsePQAccountAuthorization({...dto,executionHeight:'9007199254740995'},network);
});
after(()=>assert.equal(destroyPQWalletKeyHandle(handle),true));
const permission=()=>{const at=Date.now();return pqTypedBroadcastPermissionRequest(record,currentSnapshot,{at,expiresAt:new Date(at+25000).toISOString()})};
function response(status='unknown',method='POST'){
 const a=record.typed.review.action,body={type:a.kind,status,committed:status==='committed',source:'comet-rpc',nativeTransactionHash:record.typed.memberHash,abciTransactionHash:record.hash,executionHeight:status==='unknown'?'0':'9007199254740996',amount:'0',fee:a.fee,nonce:a.nonce,from:record.account,wire:Buffer.from(member).toString('base64'),transport:Buffer.from(record.wire,'base64url').toString('base64'),readbackUrl:'/transactions/pq/actions/originals/'+record.typed.memberHash,abciReadbackUrl:'/transactions/pq/actions/'+record.hash};
 if(status==='unknown')body.error='controlled unknown';else body.cometIndex=7;
 if(status==='committed')Object.assign(body,{effects:{controlled:true},amount:a.payload.amountYNXT,to:a.payload.beneficiary});
 return{method,requestPath:method==='POST'?'/transactions/pq/actions/broadcast':'/transactions/pq/actions/'+record.hash,status:status==='unknown'?202:method==='POST'&&status==='rejected'?422:200,contentType:'application/json',cacheControl:'no-store',body:Buffer.from(JSON.stringify(body))};
}
// Actual original SDK, Main builder/journal and Auth kernel; private borrow,
// recognizer and network are controlled seams, never a genuine approval/POST.
async function setup(t,options={}){
 const dir=await fs.mkdtemp(join(tmpdir(),'ynx-typed-controller-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));const filePath=join(dir,'journal.json');
 let armed=false,current=true,effect=false,posts=0,reads=0,acquires=0,entries=0,closes=0;const completed=[],recognized=new WeakSet();
 const io={...fs,rename:async(...args)=>{await fs.rename(...args);if(armed)throw false;}};
 const store=new FileTransactionIntentStore({filePath,io});await store.reserveOriginal(record.account,record.kind);store.captureOriginal(record.account,record,record.kind);await store.saveOriginal(record.account,record.hash,()=>{});
 const guard={account:record.account,assert(){if(!current||effect)throw Error('CONTROLLED_LOCK')},assertEffectCurrent(){if(!current)throw Error('CONTROLLED_LOCK')},async submit(fn){this.assert();effect=true;return fn()}};
 const acquire=async request=>{
  acquires++;const at=Date.now(),peer={async readOriginal(){return{request,issuedAt:new Date(at).toISOString(),expiresAt:new Date(at+15000).toISOString()}},assertCurrent(){},async recheck(){},enterOriginal(action){assert.equal(action,'broadcast');entries++;},completeOriginal(value){completed.push(value)},assertCompletedCurrent(){},retire(){},async join(){},async close(){closes++;if(options.closeFails)throw Error('CONTROLLED_CLOSE')}};
  const kernel=new TransactionPermissionKernel(request,peer);await kernel.initialize();
  const resource=options.boundPatch?{...Object.fromEntries(['assertCurrent','recheck','enterBroadcast','complete','retire','join','close'].map(k=>[k,kernel[k].bind(kernel)])),readOriginal:()=>freeze({...kernel.readOriginal(),...options.boundPatch})}:kernel;
  recognized.add(resource);return resource;
 };
 const transport={async submitTypedAction(review,raw,original,assertCurrent){
  assertCurrent();posts++;assert.deepEqual(raw,Buffer.from(record.wire,'base64url'));assert.equal(original.memberHash,record.typed.memberHash);assert.equal(review.operationId,record.operationId);
  assert.equal((await new FileTransactionIntentStore({filePath}).readPQProgress(record.account,record.hash,()=>{})).status,'submission-unknown');
  if(options.throwPost)throw false;if(options.lateLock)current=false;if(options.resultACKLost)armed=true;return options.packet??response();
 }};
 const readTypedOriginal=async(_review,_raw,_original,assertCurrent,capture)=>{assertCurrent();reads++;const packet=options.readPacket??response('unknown','GET');if(!options.omitCapture)await capture(packet);if(options.readLateLock){current=false;throw Error('CONTROLLED_LOCK')}assertCurrent();return packet};
 const create=(s=store,extra={})=>createPQTransactionSubmission({intentStore:s,networkId:record.typed.networkId,transport,readTypedOriginal,acquireOriginalWalletTransactionPermission:acquire,isOriginalWalletTransactionPermission:x=>recognized.has(x),...extra});
 return{store,filePath,guard,create,arm:()=>armed=true,counts:()=>({posts,reads,acquires,entries,closes,completed}),cold:()=>new FileTransactionIntentStore({filePath}),fresh:()=>({account:record.account,assert(){},assertEffectCurrent(){},submit:fn=>fn()})};
}
test('typed controller uses actual Main18/Auth19 and complete3 with durable UNKNOWN before one POST',async t=>{
 const f=await setup(t),c=f.create(),out=await c.broadcast(record.hash,f.guard,permission());
 assert.equal(out.kind,record.kind);assert.equal(out.hash,record.hash);assert.equal(out.status,'submission-unknown');assert.equal(out.canRetry,false);
 assert.deepEqual(f.counts().completed,[{outcome:'returned',transportHash:record.hash,memberHash:record.typed.memberHash}]);
 await assert.rejects(f.create(f.cold()).broadcast(record.hash,f.fresh(),permission()),{code:'PQ_TRANSACTION_ALREADY_ENTERED'});assert.equal(f.counts().posts,1);assert.equal(f.counts().acquires,1);
});
test('complete typed POST survives late lock in actual cold Main journal before cleanup',async t=>{
 const f=await setup(t,{packet:response('committed'),lateLock:true});await assert.rejects(f.create().broadcast(record.hash,f.guard,permission()),/CONTROLLED_LOCK/);
 const p=await f.cold().readPQProgress(record.account,record.hash,()=>{});assert.equal(p.status,'inclusion-observed');assert.equal(p.consensusFinality,false);assert.equal(f.counts().posts,1);assert.equal(f.counts().closes,1);
 assert.deepEqual((await f.cold().readPQOriginals(record.account,()=>{}))[0],record);
});
test('typed transport falsy first cause and both hashes persist through actual Auth unknown completion',async t=>{
 const f=await setup(t,{throwPost:true});await assert.rejects(f.create().broadcast(record.hash,f.guard,permission()),e=>e.code==='PQ_TRANSACTION_OUTCOME_UNKNOWN'&&e.cause===false);
 const p=await f.cold().readPQProgress(record.account,record.hash,()=>{});assert.equal(p.status,'submission-unknown');assert.deepEqual(p.firstCause,{kind:'boolean',value:false,code:null});
 assert.deepEqual(f.counts().completed,[{outcome:'unknown',transportHash:record.hash,memberHash:record.typed.memberHash}]);assert.equal(f.counts().closes,1);
});
test('typed marker ACK loss never enters permission or POST and remains UNKNOWN',async t=>{
 const f=await setup(t);f.arm();await assert.rejects(f.create().broadcast(record.hash,f.guard,permission()),e=>e.cause===false);
 assert.equal(f.counts().posts,0);assert.equal(f.counts().entries,0);assert.equal((await f.cold().readPQProgress(record.account,record.hash,()=>{})).status,'submission-unknown');
});
test('typed request omission, retarget, old sign shape and extra fields refuse before acquisition or marker',async t=>{
 const f=await setup(t);for(const patch of [null,{action:'sign'},{memberHash:record.hash},{transportHash:record.typed.memberHash},{account:'0x'+'44'.repeat(20)},{executionHeight:'1'},{approved:true},{typedAction:{...record.typed.review.action,nonce:'1'}}]){
  const request=patch===null?null:freeze({...permission(),...patch});await assert.rejects(f.create().broadcast(record.hash,f.guard,request));
 }
 let reads=0;const request={...permission()};Object.defineProperty(request,'pair',{enumerable:true,get(){reads++;throw Error('must not read')}});Object.freeze(request);await assert.rejects(f.create().broadcast(record.hash,f.guard,request));
 assert.equal(reads,0);assert.equal(f.counts().acquires,0);assert.equal(f.counts().posts,0);assert.equal((await f.store.readPQProgress(record.account,record.hash,()=>{})).status,'signed-unsubmitted');
});
test('wrong Auth memberHash or extended capsule expiry cannot create a typed marker',async t=>{
 for(const boundPatch of [{memberHash:record.hash},{expiresAt:new Date(Date.now()+60000).toISOString()}]){
  const f=await setup(t,{boundPatch});await assert.rejects(f.create().broadcast(record.hash,f.guard,permission()),{code:'PQ_TRANSACTION_PERMISSION_BINDING'});assert.equal(f.counts().posts,0);assert.equal(f.counts().entries,0);assert.equal(f.counts().closes,1);
 }
});
test('typed read UNKNOWN before submission stays signed-only and requires no Auth acquisition',async t=>{
 const f=await setup(t),out=await f.create().reconcile(record.hash,f.guard);assert.equal(out.status,'signed-unsubmitted');assert.equal(out.submitted,false);assert.equal(f.counts().acquires,0);assert.equal(f.counts().posts,0);assert.equal(f.counts().reads,1);
});
test('typed read capture retains known original across late lock without a submission marker or resend',async t=>{
 const f=await setup(t,{readPacket:response('committed','GET'),readLateLock:true});await assert.rejects(f.create().reconcile(record.hash,f.guard),/CONTROLLED_LOCK/);
 assert.equal((await f.cold().readPQProgress(record.account,record.hash,()=>{})).status,'inclusion-observed');assert.equal(f.counts().acquires,0);assert.equal(f.counts().posts,0);
});
test('typed reconcile refuses a reader that returns data without invoking original capture',async t=>{
 const f=await setup(t,{omitCapture:true});await assert.rejects(f.create().reconcile(record.hash,f.guard),{code:'PQ_TRANSACTION_CAPTURE_REQUIRED'});assert.equal((await f.store.readPQProgress(record.account,record.hash,()=>{})).status,'signed-unsubmitted');assert.equal(f.counts().posts,0);
});
test('typed reconciliation keeps the falsy read failure in existing UNKNOWN without inventing an unsubmitted marker',async t=>{
 for(const entered of [true,false]){
  const f=await setup(t);if(entered)await f.store.beginPQSubmission(record.account,record.hash,()=>{});
  await assert.rejects(f.create(f.store,{readTypedOriginal:async()=>{throw false}}).reconcile(record.hash,f.guard),e=>e===false);
  const p=await f.cold().readPQProgress(record.account,record.hash,()=>{});assert.equal(p.status,entered?'submission-unknown':'signed-unsubmitted');
  if(entered)assert.deepEqual(p.firstCause,{kind:'boolean',value:false,code:null});
  else assert.equal((JSON.parse(await fs.readFile(f.filePath,'utf8')).pqProgress??[]).length,0);
  assert.equal(f.counts().posts,0);assert.equal(f.counts().acquires,0);
 }
});
test('typed result ACK loss holds original response and cannot trigger another POST',async t=>{
 const f=await setup(t,{packet:response('committed'),resultACKLost:true});await assert.rejects(f.create().broadcast(record.hash,f.guard,permission()),e=>e.cause===false);
 const p=await f.store.readPQProgress(record.account,record.hash,()=>{});assert.equal(p.status,'inclusion-observed');assert.equal(p.localResultHeld,true);
 await assert.rejects(f.create(f.cold()).broadcast(record.hash,f.fresh(),permission()),{code:'PQ_TRANSACTION_ALREADY_ENTERED'});assert.equal(f.counts().posts,1);
});
test('Main POST progress uses original POST decoder for error-only and rejected responses, never a GET cast',()=>{
 for(const status of [400,413,415]){
  const packet={...response(),status,body:Buffer.from('{"error":"controlled refusal"}')};
  const saved=capturePQProgressResult({phase:'submission',response:packet}),parsed=parsePQProgressResult(saved,record);
  assert.equal(parsed.status,'submission-unknown');assert.equal(parsed.observed.observedStatus,null);assert.equal(parsed.observed.bodyIdentityObserved,false);
  assert.equal(saved.method,'POST');assert.deepEqual(Buffer.from(saved.text),packet.body);assert.equal(parsed.observed.canRetry,false);
 }
 const packet=response('rejected'),saved=capturePQProgressResult({phase:'submission',response:packet}),parsed=parsePQProgressResult(saved,record);
 assert.equal(parsed.status,'rejection-observed');assert.equal(parsed.observed.httpStatus,422);assert.equal(parsed.observed.consensusFinality,false);
 assert.throws(()=>parsePQProgressResult({...saved,phase:'read'},record),{code:'PQ_TYPED_PROGRESS_INVALID'});
 assert.throws(()=>parsePQProgressResult({...saved,method:'GET'},record),{code:'PQ_TYPED_PROGRESS_INVALID'});
});
