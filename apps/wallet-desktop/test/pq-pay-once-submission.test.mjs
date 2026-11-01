import test,{before} from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join} from 'node:path';import {createHash} from 'node:crypto';
import {createPQWalletKeyHandle,readPQWalletKeyPublic,destroyPQWalletKeyHandle} from '@ynx-chain/wallet-auth/pq-wallet-key-backup';
import {pqPublicBindingToRegistrationKeys} from '@ynx-chain/wallet-auth/pq-wallet-authorization';
import {parsePQAccountAuthorization} from '@ynx-chain/wallet-auth/pq-wallet-policy';
import {encodePQNativeAction} from '@ynx-chain/wallet-auth/pq-native-action';
import {inspectPQNativePayResponseDATA} from '@ynx-chain/wallet-auth/pq-native-pay-observation';
import {preparePQTypedActionReview,signPQReviewedTypedAction} from '../src/features/pq-transaction/typed-action-caller.mjs';
import {createPQTypedOriginalFromMember} from '../src/wallet-pq-typed-original.mjs';
import {pqTypedBroadcastPermissionRequest} from '../src/wallet-pq-typed-permission.mjs';
import {createPQTransactionSubmission} from '../src/features/pq-transaction/submission.mjs';
import {TransactionPermissionKernel} from '../src/original-policy-supplier/transaction-permission-kernel.mjs';
import {FileTransactionIntentStore} from '../src/transaction-intent-store.mjs';
import vectors from '../src/features/pq-transaction/invoice-review-data.fixture.mjs';
// Actual Main store/controller/Auth kernel and sole SDK 5aa parser. Source
// recognizers, private packet IO and approval borrow are PUBLIC controlled
// boundaries; no real Source, wallet, approval, POST or finality is supplied.
const rows=[],sha=b=>createHash('sha256').update(b).digest('hex'),clone=x=>JSON.parse(JSON.stringify(x));
const freeze=x=>{if(x&&typeof x==='object'){Object.values(x).forEach(freeze);Object.freeze(x);}return x;};
const intentId='npi_'+'ab'.repeat(24);
before(async()=>{
 const merchant=vectors.envelope.owner,payer='0x'+'22'.repeat(20),chainId=vectors.envelope.networkHex,handles=[],contexts=[];
 try{
  for(const owner of [merchant,payer]){
   const handle=await createPQWalletKeyHandle({chainId,owner});handles.push(handle);const pair=pqPublicBindingToRegistrationKeys(readPQWalletKeyPublic(handle));
   const dto={owner,executionHeight:'100',ledgerNonce:'1',algorithmVersion:'YNX-BATCH/v0.1',enabled:true,policyVersion:'YNX-ACCOUNT-POLICY/v1',networkId:chainId,enableAt:'10',activeRevision:'1',records:[{algorithmVersion:'YNX-BATCH/v0.1',owner,pkA:pair.pkA,pkB:pair.pkB,revision:'1',registeredAt:'10',activeFrom:'11',ledgerNonce:'1'}]};
   contexts.push({handle,dto,snapshot:parsePQAccountAuthorization(dto,{owner,chainId,nativeChainId:'6423'})});
  }
  let termsMessage,settlement;const at=Date.now();
  for(const [i,kind] of ['invoice_terms','invoice_settle','invoice_refund'].entries()){
   const {handle,dto,snapshot}=contexts[kind==='invoice_settle'?1:0],owner=dto.owner,payload={...vectors.vectors.find(v=>v.kind===kind).input};
   if(kind==='invoice_terms'){payload.keyEpoch='1';payload.payer=payer;}else payload.termsHashHex=sha(termsMessage);
   if(kind==='invoice_settle'){payload.merchant=merchant;payload.amount=vectors.vectors[0].input.amount;}
   if(kind==='invoice_refund')payload.settlementHashHex=sha(settlement.member);
   const action={chainId,nativeChainId:'6423',owner,nonce:'2',fee:'1',kind,payload},originals=kind==='invoice_terms'?null:{termsMessage,settlement:kind==='invoice_refund'?settlement:null};
   const review=preparePQTypedActionReview(snapshot,action,{account:owner,networkId:chainId,operationId:`PUBLIC-pay-once-${i}`,createdAt:new Date(at).toISOString(),expiresAt:new Date(at+60000).toISOString()},originals);
   const member=signPQReviewedTypedAction(review,snapshot,handle,{account:owner,networkId:chainId},at),original=createPQTypedOriginalFromMember(member,{review,reviewSnapshot:dto,signingSnapshot:dto});
   if(kind==='invoice_terms')termsMessage=encodePQNativeAction(action);
   if(kind==='invoice_settle')settlement={review,member,original:{reviewSnapshot:snapshot,signingSnapshot:snapshot,selectedBinding:{account:owner,networkId:chainId}}};
   rows.push({original,member,snapshot,ref:kind==='invoice_terms'?{hash:original.hash,kind,intentId}:{hash:original.hash,kind,merchant,invoiceId:payload.invoiceID}});
  }
 }finally{for(const h of handles)assert.equal(destroyPQWalletKeyHandle(h),true);}
});
function packet(row,target,options){
 const {original,member}=row,a=original.typed.review.action,p=a.payload;let body;
 if(a.kind==='invoice_terms')body={signingMessageHash:sha(encodePQNativeAction(a)),intentId:target.intentId,originalOperation:target.intentId,request:{productId:'cloud.ide-usage',sourceOrder:'PUBLIC-order',merchant:original.account,recipient:p.recipient,genesis:a.chainId,nativeChainId:a.nativeChainId,assetId:p.assetID,unitVersion:p.unitVersion,amountAtoms:p.amount,domainData:{PUBLIC:true}},state:'PREPARED',phase:'unknown',merchant:original.account,terms:{invoiceId:p.invoiceID,sessionId:p.sessionID,recipient:p.recipient,payer:p.payer,assetId:p.assetID,unitVersion:p.unitVersion,feeRule:p.feeRule,keyEpoch:p.keyEpoch,revision:p.revision,amountAtoms:p.amount,maxFeeAtoms:p.maxFee,expiresAtHeight:p.expiresAt},termsNativeHash:original.typed.memberHash,termsAbciHash:original.hash};
 else body={merchant:target.merchant,invoiceId:target.invoiceId,nativeHash:original.typed.memberHash,abciHash:original.hash,member:Buffer.from(member).toString('base64'),envelope:Buffer.from(original.wire,'base64url').toString('base64'),kind:a.kind,owner:original.account,status:'unknown'};
 return {method:'POST',requestPath:options.badPath?'/transactions/pq/actions/broadcast':target.requestPath,status:options.errorPacket?503:202,contentType:'application/json',cacheControl:'no-store',body:Buffer.from(JSON.stringify(options.errorPacket?{code:'NATIVE_PAY_REQUEST_REJECTED',error:'PUBLIC service refusal'}:body))};
}
async function setup(t,row,options={}){
 const directory=await fs.mkdtemp(join(tmpdir(),'ynx-pay-once-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));const filePath=join(directory,'journal.json');
 let current=true,armed=false,received;const calls={core:0,posts:0,queries:0,parses:0,acquires:0,entries:0,sourceAcquires:0,completed:[],cleanup:[]};
 const io={...fs,rename:async(...args)=>{await fs.rename(...args);if(armed){armed=false;if(options.mutateAfterSave||options.queryMutateAfterSave)received.body.fill(0);if(options.saveACKLost||options.querySaveACKLost)throw false;}}};
 const store=new FileTransactionIntentStore({filePath,io}),{original}=row;await store.reserveOriginal(original.account,original.kind);store.captureOriginal(original.account,original,original.kind);await store.saveOriginal(original.account,original.hash,()=>{});
 const {target}=await store.bindPQPaySubmissionTarget(original.account,original.hash,row.ref,()=>{});
 let releaseQuery,queryEntered;const queryStarted=new Promise(resolve=>{queryEntered=resolve;});
 const recognized=new WeakSet(),sources=new WeakSet(),guard={account:original.account,assert(){if(!current)throw Error('PUBLIC_LOCK');},assertEffectCurrent(){if(!current)throw Error('PUBLIC_LOCK');},async submit(fn){this.assert();const result=await fn();if(options.submitLateFence)this.assertEffectCurrent();return result;}};
 const acquire=async request=>{
  calls.acquires++;const at=Date.now(),peer={async readOriginal(){return {request,issuedAt:new Date(at).toISOString(),expiresAt:new Date(at+20000).toISOString()};},assertCurrent(){},async recheck(){},enterOriginal(){calls.entries++;},completeOriginal(value){calls.completed.push(value);},assertCompletedCurrent(){},retire(){calls.cleanup.push('approval-retire');},async join(){calls.cleanup.push('approval-join');},async close(){calls.cleanup.push('approval-close');}};
  const resource=new TransactionPermissionKernel(request,peer);await resource.initialize();recognized.add(resource);return resource;
 };
 const acquireSource=async input=>{
  calls.sourceAcquires++;assert.equal(input.original.hash,original.hash);assert.deepEqual(input.target,target);
  if(options.absentSource)return null;
  const bound=freeze({networkId:original.typed.networkId,account:original.account,hash:options.wrongSourceHash?'0x'+'00'.repeat(32):original.hash,memberHash:original.typed.memberHash,operationId:original.operationId,target});
  async function send(method,args){
   args.at(-1)();assert.equal(method,original.typed.review.action.kind);assert.deepEqual(Buffer.from(args.at(-2)),Buffer.from(row.member));
   assert.equal((await new FileTransactionIntentStore({filePath}).readPQProgress(original.account,original.hash,()=>{})).status,'submission-unknown');calls.posts++;
   if(options.throwPost)throw false;
   received=packet(row,target,options);armed=!!(options.saveACKLost||options.mutateAfterSave);if(options.lateLock)current=false;return received;
  }
  async function readPacket(kind,args){
   args.at(-1)();assert.equal(kind,original.typed.review.action.kind==='invoice_terms'?'intent':'invoice');assert.equal(input.request,null);calls.queries++;queryEntered();
   if(options.holdQuery)await new Promise(resolve=>{releaseQuery=resolve;});
   received={method:'GET',requestPath:options.queryBadPath?'/transactions/pq/actions/originals/'+original.typed.memberHash:kind==='intent'?'/v5/pay/invoice-intents/'+target.intentId:'/v5/pay/invoices/'+target.merchant+'/'+target.invoiceId,status:503,contentType:'application/json',cacheControl:'no-store',body:Buffer.from('{"code":"NATIVE_PAY_READ_UNAVAILABLE","error":"PUBLIC original query"}')};
   armed=!!(options.querySaveACKLost||options.queryMutateAfterSave);if(options.queryLateLock)current=false;return received;
  }
  const source={readInvoiceIntentPacket:(...a)=>readPacket('intent',a),readInvoicePacket:(...a)=>readPacket('invoice',a),readOriginal:()=>bound,assertCurrent(){},async recheck(){},retire(){calls.cleanup.push('source-retire');},async join(){calls.cleanup.push('source-join');},async close(){calls.cleanup.push('source-close');if(options.closeFails)throw Error('PUBLIC_SOURCE_CLOSE');},submitMerchantMemberPacket:(...a)=>send('invoice_terms',a),submitSettlementPacket:(...a)=>send('invoice_settle',a),submitRefundPacket:(...a)=>send('invoice_refund',a)};
  if(options.sourceJoin)source.join=async()=>{calls.cleanup.push('source-join');await options.sourceJoin();};
  sources.add(source);if(options.partialSource)throw Object.assign(Error('PUBLIC_PARTIAL_SOURCE'),{partial:source});return source;
 };
 const makeController=intentStore=>createPQTransactionSubmission({intentStore,networkId:original.typed.networkId,acquireOriginalWalletTransactionPermission:acquire,isOriginalWalletTransactionPermission:x=>recognized.has(x),transport:{submitTypedAction(){calls.core++;throw Error('CORE_MUST_NOT_RUN');}},acquireOriginalPaySource:acquireSource,isOriginalPaySource:x=>sources.has(x),onOriginalPayOwnerJoined:options.onJoined??null,inspectPayResponse(...args){calls.parses++;if(options.throwParser)throw false;return inspectPQNativePayResponseDATA(...args);}});
 const controller=makeController(store);
 const request=()=>{const at=Date.now();return pqTypedBroadcastPermissionRequest(original,row.snapshot,{at,expiresAt:new Date(at+25000).toISOString()});};
 return {store,controller,target,guard,calls,filePath,request,queryStarted,releaseQuery(){releaseQuery();},coldController:()=>makeController(new FileTransactionIntentStore({filePath})),unlock(){current=true;},cold:()=>new FileTransactionIntentStore({filePath})};
}
for(const [i,kind] of ['invoice_terms','invoice_settle','invoice_refund'].entries())test(`one actual ${kind} pipeline retains UNKNOWN, sole SDK observation and no second dispatch`,async t=>{
 const f=await setup(t,rows[i]);const result=await f.controller.broadcast(rows[i].original.hash,f.guard,f.request(),f.target);
 assert.equal(result.status,'submission-unknown');assert.equal(result.submissionService,'pay');assert.equal(f.calls.posts,1);assert.equal(f.calls.core,0);assert.equal(f.calls.parses,1);
 await assert.rejects(f.controller.broadcast(rows[i].original.hash,f.guard,f.request(),f.target),{code:'PQ_TRANSACTION_ALREADY_ENTERED'});assert.equal(f.calls.posts,1);assert.equal(f.calls.acquires,1);
 assert.deepEqual(f.calls.cleanup,['source-retire','source-join','source-close','approval-retire','approval-join','approval-close']);
 assert.equal((await f.cold().readPQProgress(rows[i].original.account,rows[i].original.hash,()=>{})).status,'submission-unknown');
});
test('focus loss inside packet return is saved before actual submit late-current fence',async t=>{
 const row=rows[0],f=await setup(t,row,{lateLock:true,submitLateFence:true});await assert.rejects(f.controller.broadcast(row.original.hash,f.guard,f.request(),f.target),/PUBLIC_LOCK/);
 const p=await f.cold().readPQProgress(row.original.account,row.original.hash,()=>{});assert.equal(p.storageConfirmed,true);assert.equal(p.status,'submission-unknown');assert.equal(f.calls.posts,1);f.unlock();await assert.rejects(f.controller.broadcast(row.original.hash,f.guard,f.request(),f.target),{code:'PQ_TRANSACTION_ALREADY_ENTERED'});assert.equal(f.calls.posts,1);
});
test('response save ACK loss retains first packet, skips parser and cannot dispatch again',async t=>{
 const row=rows[0],f=await setup(t,row,{saveACKLost:true});await assert.rejects(f.controller.broadcast(row.original.hash,f.guard,f.request(),f.target),e=>e===false||e.cause===false);
 assert.equal(f.calls.posts,1);assert.equal(f.calls.parses,0);assert.ok((await f.cold().readPQPaySubmissionPacket(row.original.account,row.original.hash)).body.length);
 await assert.rejects(f.controller.broadcast(row.original.hash,f.guard,f.request(),f.target),{code:'PQ_TRANSACTION_ALREADY_ENTERED'});assert.equal(f.calls.posts,1);
});
test('parser reads acknowledged original bytes, despite foreign buffer mutation during save',async t=>{
 const row=rows[1],f=await setup(t,row,{mutateAfterSave:true});const result=await f.controller.broadcast(row.original.hash,f.guard,f.request(),f.target);assert.equal(result.status,'submission-unknown');assert.equal(f.calls.parses,1);
});
test('wrong actual path is retained before sole SDK refusal without Core fallback',async t=>{
 const row=rows[0],f=await setup(t,row,{badPath:true});await assert.rejects(f.controller.broadcast(row.original.hash,f.guard,f.request(),f.target));assert.equal(f.calls.posts,1);assert.equal(f.calls.core,0);assert.equal((await f.cold().readPQPaySubmissionPacket(row.original.account,row.original.hash)).requestPath,'/transactions/pq/actions/broadcast');
});
test('real service error-only response remains UNKNOWN and never proves no prior execution',async t=>{
 const row=rows[2],f=await setup(t,row,{errorPacket:true});const result=await f.controller.broadcast(row.original.hash,f.guard,f.request(),f.target);assert.equal(result.status,'submission-unknown');assert.equal(result.canRetry,false);assert.equal((await f.cold().readPQPaySubmissionPacket(row.original.account,row.original.hash)).status,503);
});
test('wrong Source identity and partial acquisition drain before any marker or packet',async t=>{
 for(const options of [{wrongSourceHash:true},{partialSource:true}]){
  const row=rows[0],f=await setup(t,row,options);await assert.rejects(f.controller.broadcast(row.original.hash,f.guard,f.request(),f.target));assert.equal(f.calls.posts,0);assert.equal(f.calls.core,0);assert.equal((await f.cold().readPQProgress(row.original.account,row.original.hash,()=>{})).status,'signed-unsubmitted');assert.equal(f.calls.cleanup.includes('source-close'),true);assert.equal(f.calls.cleanup.includes('approval-close'),true);
 }
});
test('lost packet response keeps falsy first cause through failing Source cleanup',async t=>{
 const row=rows[0],f=await setup(t,row,{throwPost:true,closeFails:true});await assert.rejects(f.controller.broadcast(row.original.hash,f.guard,f.request(),f.target),e=>e.code==='PQ_TRANSACTION_OUTCOME_UNKNOWN'&&e.cause===false);
 const p=await f.cold().readPQProgress(row.original.account,row.original.hash,()=>{});assert.deepEqual(p.firstCause,{kind:'boolean',value:false,code:null});assert.equal(p.status,'submission-unknown');assert.equal(f.calls.posts,1);assert.throws(()=>f.controller.assertSafeToClose(),{code:'PQ_TRANSACTION_CLEANUP_PENDING'});
});
test('absent Pay Source cannot leave a false cleanup owner that poisons ordinary controller shutdown',async t=>{
 const row=rows[0],f=await setup(t,row,{absentSource:true});await assert.rejects(f.controller.broadcast(row.original.hash,f.guard,f.request(),f.target),{code:'PQ_PAY_DISPATCH_SOURCE_NOT_SUPPLIED'});
 assert.equal(f.calls.posts,0);assert.equal(f.calls.core,0);assert.equal((await f.cold().readPQProgress(row.original.account,row.original.hash,()=>{})).status,'signed-unsubmitted');assert.doesNotThrow(()=>f.controller.assertSafeToClose());
});
for(const [i,kind] of ['invoice_terms','invoice_settle','invoice_refund'].entries())test(`Pay query ${kind}: cold same-original fixed GET, no approval/POST/parser replay`,async t=>{
 const row=rows[i],f=await setup(t,row);await f.controller.broadcast(row.original.hash,f.guard,f.request(),f.target);const before=JSON.parse(await fs.readFile(f.filePath,'utf8')).pqProgress[0].result;
 const cold=f.coldController(),p=await cold.reconcile(row.original.hash,f.guard);assert.equal(p.status,'submission-unknown');assert.equal(p.submissionService,'pay');assert.equal(f.calls.posts,1);assert.equal(f.calls.queries,1);assert.equal(f.calls.acquires,1);assert.equal(f.calls.parses,1);
 const state=JSON.parse(await fs.readFile(f.filePath,'utf8'));assert.deepEqual(state.pqProgress[0].result,before);assert.equal(state.pqProgress[0].queryResult.method,'GET');
 await cold.reconcile(row.original.hash,f.guard);assert.equal(f.calls.queries,1);assert.equal(f.calls.posts,1);
});
test('Pay query recovers lost submission response without replacing original cause or sending Member again',async t=>{
 const row=rows[0],f=await setup(t,row,{throwPost:true});await assert.rejects(f.controller.broadcast(row.original.hash,f.guard,f.request(),f.target),e=>e.code==='PQ_TRANSACTION_OUTCOME_UNKNOWN');
 const p=await f.coldController().reconcile(row.original.hash,f.guard);assert.equal(p.status,'submission-unknown');assert.equal(f.calls.posts,1);assert.equal(f.calls.queries,1);assert.equal(f.calls.parses,0);assert.deepEqual((await f.cold().readPQProgress(row.original.account,row.original.hash,()=>{})).firstCause,{kind:'boolean',value:false,code:null});
});
test('Pay query late lock and raw-save lost ACK retain complete original GET response',async t=>{
 for(const options of [{queryLateLock:true},{querySaveACKLost:true}]){
  const row=rows[0],f=await setup(t,row,options);await f.controller.broadcast(row.original.hash,f.guard,f.request(),f.target);
  await assert.rejects(f.controller.reconcile(row.original.hash,f.guard));assert.equal((await f.cold().readPQPayQueryPacket(row.original.account,row.original.hash)).method,'GET');assert.equal(f.calls.queries,1);assert.equal(f.calls.posts,1);
 }
});
test('Pay query wrong actual path stays original DATA and is never cast to POST/Core',async t=>{
 const row=rows[0],f=await setup(t,row,{queryBadPath:true});await f.controller.broadcast(row.original.hash,f.guard,f.request(),f.target);
 await assert.rejects(f.controller.reconcile(row.original.hash,f.guard),{code:'PQ_PAY_QUERY_RESPONSE_BINDING'});assert.match((await f.cold().readPQPayQueryPacket(row.original.account,row.original.hash)).requestPath,/transactions\/pq\/actions\/originals/);
 await assert.rejects(f.controller.reconcile(row.original.hash,f.guard),{code:'PQ_PAY_QUERY_RESPONSE_BINDING'});assert.equal(f.calls.queries,1);assert.equal(f.calls.core,0);
});
test('Pay query in-flight close fences new work while returned bytes still reach protected journal',async t=>{
 const row=rows[0],f=await setup(t,row,{holdQuery:true});await f.controller.broadcast(row.original.hash,f.guard,f.request(),f.target);
 const pending=f.controller.reconcile(row.original.hash,f.guard);await f.queryStarted;
 assert.throws(()=>f.controller.assertSafeToClose(),{code:'PQ_TRANSACTION_CLEANUP_PENDING'});
 await assert.rejects(f.store.assertPQProgressSafeToClose(),e=>e.data?.code==='PQ_PROGRESS_CLOSE_UNCONFIRMED');
 f.releaseQuery();await assert.rejects(pending,{code:'PQ_TRANSACTION_CLOSING'});
 assert.equal((await f.cold().readPQPayQueryPacket(row.original.account,row.original.hash)).method,'GET');assert.equal(f.calls.posts,1);assert.equal((await f.store.assertPQProgressSafeToClose()).safe,true);
});

test('Native join witness occurs only after actual controller join and before Source close',async t=>{
 let enter,release;const entered=new Promise(r=>enter=r),gate=new Promise(r=>release=r);let observed=0,f;
 f=await setup(t,rows[0],{sourceJoin:async()=>{enter();await gate;},onJoined:owner=>{if(typeof owner.submitMerchantMemberPacket==='function'){observed++;assert.equal(f.calls.cleanup.includes('source-close'),false);}}});
 const pending=f.controller.broadcast(rows[0].original.hash,f.guard,f.request(),f.target);await entered;
 assert.equal(observed,0);assert.equal(f.calls.cleanup.includes('source-close'),false);release();await pending;assert.equal(observed,1);assert.equal(f.calls.cleanup.includes('source-close'),true);
});
test('failed Native join preserves cleanup debt and never notifies join witness or closes Source',async t=>{
 let observed=0;const f=await setup(t,rows[0],{sourceJoin:async()=>{throw false;},onJoined:owner=>{if(typeof owner.submitMerchantMemberPacket==='function')observed++;}});
 await assert.rejects(f.controller.broadcast(rows[0].original.hash,f.guard,f.request(),f.target),e=>e===false);assert.equal(observed,0);assert.equal(f.calls.cleanup.includes('source-close'),false);assert.throws(()=>f.controller.assertSafeToClose(),{code:'PQ_TRANSACTION_CLEANUP_PENDING'});
});
