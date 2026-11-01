import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createPQWalletKeyHandle,readPQWalletKeyPublic,destroyPQWalletKeyHandle} from '@ynx-chain/wallet-auth/pq-wallet-key-backup';
import {pqPublicBindingToRegistrationKeys} from '@ynx-chain/wallet-auth/pq-wallet-authorization';
import {encodePQNativeAction} from '@ynx-chain/wallet-auth/pq-native-action';
import {parsePQAccountAuthorization} from '@ynx-chain/wallet-auth/pq-wallet-policy';
import {preparePQTypedActionReview,signPQReviewedTypedAction} from '../src/features/pq-transaction/typed-action-caller.mjs';
import {createPQTypedOriginalFromMember} from '../src/wallet-pq-typed-original.mjs';
import vectors from '../src/features/pq-transaction/invoice-review-data.fixture.mjs';
import * as pay from '../src/wallet-pq-pay-progress.mjs';

const clone=x=>JSON.parse(JSON.stringify(x));
const raw=(body=new Uint8Array([0,255,123,0]),extra={})=>({method:'POST',requestPath:'/v5/actually-returned',status:503,contentType:undefined,cacheControl:'no-store',body,...extra});
const captured=pay.capturePQPayPacket(raw());
const intentId='npi_'+'ab'.repeat(24);
// Ephemeral PUBLIC synthetic signer supplies only three new DATA fixtures.
// This invokes the actual original parser/full AND checks, never real custody,
// approval, Source, HTTP, funds or deployment. No legacy math matrix is run.
const originals=[];
test('PUBLIC composed Pay DATA: three actual typed originals, exact targets and immutable UNKNOWN response custody',async()=>{
 const merchant=vectors.envelope.owner,payer='0x'+'22'.repeat(20),chainId=vectors.envelope.networkHex;
 const handles=[],contexts=[];
 for(const owner of [merchant,payer]){
  const handle=await createPQWalletKeyHandle({chainId,owner});handles.push(handle);
  const pair=pqPublicBindingToRegistrationKeys(readPQWalletKeyPublic(handle));
  const dto={owner,executionHeight:'100',ledgerNonce:'1',algorithmVersion:'YNX-BATCH/v0.1',enabled:true,policyVersion:'YNX-ACCOUNT-POLICY/v1',networkId:chainId,enableAt:'10',activeRevision:'1',records:[{algorithmVersion:'YNX-BATCH/v0.1',owner,pkA:pair.pkA,pkB:pair.pkB,revision:'1',registeredAt:'10',activeFrom:'11',ledgerNonce:'1'}]};
  contexts.push({handle,dto,snapshot:parsePQAccountAuthorization(dto,{owner,chainId,nativeChainId:'6423'})});
 }
 const at=Date.parse('2026-11-01T00:00:00Z');let termsMessage,settlement;
 try{
  for(const [i,kind] of ['invoice_terms','invoice_settle','invoice_refund'].entries()){
   const {handle,dto,snapshot}=contexts[kind==='invoice_settle'?1:0],owner=dto.owner;
   const payload={...vectors.vectors.find(v=>v.kind===kind).input};
   if(kind==='invoice_terms'){payload.keyEpoch='1';payload.payer=payer;}
   else {payload.termsHashHex=createHash('sha256').update(termsMessage).digest('hex');}
   if(kind==='invoice_settle'){payload.merchant=merchant;payload.amount=vectors.vectors[0].input.amount;}
   if(kind==='invoice_refund')payload.settlementHashHex=createHash('sha256').update(settlement.member).digest('hex');
   const action={chainId,nativeChainId:'6423',owner,nonce:'2',fee:'1',kind,payload};
   const refs=kind==='invoice_terms'?null:{termsMessage,settlement:kind==='invoice_refund'?settlement:null};
   const review=preparePQTypedActionReview(snapshot,action,{account:owner,networkId:chainId,operationId:`PUBLIC-pay-data-${i}`,createdAt:new Date(at).toISOString(),expiresAt:new Date(at+60000).toISOString()},refs);
   const member=signPQReviewedTypedAction(review,snapshot,handle,{account:owner,networkId:chainId},at);
   const original=createPQTypedOriginalFromMember(member,{review,reviewSnapshot:dto,signingSnapshot:dto});
   if(kind==='invoice_terms')termsMessage=encodePQNativeAction(action);
   if(kind==='invoice_settle')settlement={review,member,original:{reviewSnapshot:snapshot,signingSnapshot:snapshot,selectedBinding:{account:owner,networkId:chainId}}};
   originals.push(original);
   const ref=kind==='invoice_terms'?{hash:original.hash,kind,intentId}:{hash:original.hash,kind,merchant:kind==='invoice_settle'?action.payload.merchant:original.account,invoiceId:action.payload.invoiceID};
   const target=pay.normalizePQPayTargetDATA(original,ref);
   assert.deepEqual(Object.keys(target),['version','service','kind','intentId','merchant','invoiceId','requestPath']);
   assert.equal(target.merchant,kind==='invoice_settle'?action.payload.merchant:original.account);
   assert.equal(target.requestPath,kind==='invoice_terms'?`/v5/pay/invoice-intents/${intentId}/merchant-member`:`/v5/pay/invoices/${target.merchant}/${target.invoiceId}/${kind==='invoice_settle'?'settlements':'refunds'}`);
   assert.equal(target.intentId,kind==='invoice_terms'?intentId:null);
   const initial=pay.initialPQPayProgress(original,target);
   assert.equal(initial.status,'signed-unsubmitted');
   assert.throws(()=>pay.mergePQPayPacket(initial,captured,original),{code:'PQ_PAY_SUBMISSION_NOT_ENTERED'});
   const began=pay.enterPQPaySubmission(initial,original);
   const saved=pay.mergePQPayPacket(began,captured,original);
   assert.equal(saved.status,'submission-unknown');assert.equal(saved.version,2);
   assert.equal(saved.nativeTransactionHash,original.typed.memberHash);assert.equal(saved.abciTransactionHash,original.hash);
   assert.notEqual(saved.nativeTransactionHash,saved.abciTransactionHash);
   assert.deepEqual(pay.parsePQPayProgress(clone(saved),clone(original)),saved);
   assert.deepEqual(pay.mergePQPayPacket(saved,clone(captured),original),saved);
   assert.throws(()=>pay.mergePQPayPacket(saved,pay.capturePQPayPacket(raw(new Uint8Array([7]))),original),{code:'PQ_PAY_RESPONSE_CONFLICT'});
   assert.deepEqual(saved.result,captured);assert.equal(Object.isFrozen(saved.result.undefinedFields),true);
   for(const change of [x=>{x.hash='0x'+'00'.repeat(32);},x=>{x.extra=true;},x=>{kind==='invoice_terms'?x.intentId='npi_fake':x.invoiceId='other';}]){const bad={...ref};change(bad);assert.throws(()=>pay.normalizePQPayTargetDATA(original,bad));}
   for(const change of [x=>{x.version=1;},x=>{x.target.requestPath='/transactions/pq/actions/broadcast';},x=>{x.target.intentId=kind==='invoice_terms'?null:intentId;},x=>{x.operationId='other';},x=>{x.nativeTransactionHash=x.abciTransactionHash;},x=>{x.result.bodySha256='00'.repeat(32);},x=>{x.status='inclusion-observed';}]){const bad=clone(saved);change(bad);assert.throws(()=>pay.parsePQPayProgress(bad,original));}
   for(const value of [false,0,'',undefined,null,Error('private secret')]){
    const firstCause=pay.pqPayProgressCause(value),storageCause=pay.pqPayProgressCause(value);
    const out=pay.parsePQPayProgress({...saved,firstCause,storageCause},original);
    assert.deepEqual(out.firstCause,firstCause);assert.deepEqual(out.storageCause,storageCause);
   }
   for(const change of [x=>{x.typed.memberHash=x.hash;},x=>{x.operationId='different';},x=>{x.typed.networkId='00'.repeat(32);},x=>{x.account='0x'+'00'.repeat(20);},x=>{x.typed.review.action.payload.invoiceID='changed';},x=>{x.wire=x.wire.slice(0,-3);}]){const bad=clone(original);change(bad);assert.throws(()=>pay.normalizePQPayTargetDATA(bad,ref));}
  }
 }finally{for(const handle of handles)assert.equal(destroyPQWalletKeyHandle(handle),true);}
});

test('raw response is exact detached binary DATA even when HTTP framing disagrees; no body interpretation',()=>{
 const body=new Uint8Array([0,255,254,123,0]),packet=raw(body,{method:'GET',status:415,requestPath:'/wrong-path',contentType:'text/plain'});
 const out=pay.capturePQPayPacket(packet);body.fill(8);
 assert.deepEqual(Buffer.from(out.bodyBase64url,'base64url'),Buffer.from([0,255,254,123,0]));
 assert.equal(out.bodySha256,createHash('sha256').update(Buffer.from([0,255,254,123,0])).digest('hex'));
 assert.equal(out.bodyBytes,5);assert.equal(out.requestPath,'/wrong-path');assert.equal(out.status,415);assert.equal(out.method,'GET');
 assert.deepEqual(captured.undefinedFields,['contentType']);assert.equal(captured.contentType,null);
 assert.deepEqual(pay.capturePQPayPacket(raw(undefined,{contentType:null})).undefinedFields,[]);
 assert.equal(pay.capturePQPayPacket(raw(new Uint8Array())).bodyBytes,0);
});

test('2MiB boundary, declared JSON reserve and unsafe input rejection without executing hooks',()=>{
 const body=new Uint8Array(pay.PQ_PAY_PACKET_BODY_MAX_BYTES);body.fill(255);
 const out=pay.capturePQPayPacket(raw(body,{method:'\0'.repeat(1024),requestPath:'\0'.repeat(8192),contentType:'\0'.repeat(8192),cacheControl:'\0'.repeat(8192)}));
 assert.ok(out.bodyBase64url.length<=pay.PQ_PAY_PACKET_BASE64_MAX_BYTES);
 assert.ok(Buffer.byteLength(JSON.stringify(out))<pay.PQ_PAY_PROGRESS_RESERVE_BYTES-65536);
 assert.throws(()=>pay.capturePQPayPacket(raw(new Uint8Array(body.length+1))),{code:'PQ_PAY_PACKET_TOO_LARGE'});
 let calls=0;
 const getter=raw();Object.defineProperty(getter,'status',{get(){calls++;throw Error('getter');}});
 assert.throws(()=>pay.capturePQPayPacket(getter));
 assert.throws(()=>pay.capturePQPayPacket(new Proxy(raw(),{getPrototypeOf(){calls++;throw Error('proxy');}})));
 assert.throws(()=>pay.capturePQPayPacket(raw(new Proxy(new Uint8Array(1),{get(){calls++;throw Error('proxy');}}))));
 assert.equal(calls,0);
 assert.throws(()=>pay.capturePQPayPacket(raw(new Uint8Array(new SharedArrayBuffer(1)))));
 assert.throws(()=>pay.capturePQPayPacket(raw(new Uint8Array(new ArrayBuffer(1,{maxByteLength:2})))));
 const detached=new Uint8Array(1);structuredClone(detached,{transfer:[detached.buffer]});assert.throws(()=>pay.capturePQPayPacket(raw(detached)));
 assert.throws(()=>pay.capturePQPayPacket(raw(undefined,{requestPath:'x'.repeat(8193)})));
 assert.throws(()=>pay.capturePQPayPacket({...raw(),extra:true}));
 assert.throws(()=>pay.normalizePQPayTargetDATA({kind:'invoice_terms',account:'0x'+'11'.repeat(20)},{intentId}));
});
