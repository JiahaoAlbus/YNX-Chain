import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {encodePQNativeAction} from '@ynx-chain/wallet-auth/pq-native-action';
import {parsePQAccountAuthorization} from '@ynx-chain/wallet-auth/pq-wallet-policy';
import {createPQWalletKeyHandle,readPQWalletKeyPublic,destroyPQWalletKeyHandle} from '@ynx-chain/wallet-auth/pq-wallet-key-backup';
import {pqPublicBindingToRegistrationKeys} from '@ynx-chain/wallet-auth/pq-wallet-authorization';
import {preparePQTypedActionReview,recheckPQTypedActionReview,signPQReviewedTypedAction,pqTypedActionInvocationData,inspectPQTypedActionMember} from './typed-action-caller.mjs';

// Public synthetic policies and one ephemeral SDK key pair. No original Wallet
// account, Source/Native permission, network, persistent custody or RPC effect.
const rows=JSON.parse(readFileSync(new URL('./fixtures/typed-action-public-inputs.json',import.meta.url))).rows;
const network={chainId:rows[0].chainId,nativeChainId:'6423',owner:rows[0].owner};
const selected={account:network.owner,networkId:network.chainId},at=Date.parse('2026-10-19T00:00:00.000Z');
const metadata=(id='controlled-typed-1')=>({...selected,operationId:id,createdAt:new Date(at).toISOString(),expiresAt:new Date(at+60_000).toISOString()});
const record=(pair,revision='1',registeredAt='10',activeFrom='11',ledgerNonce='1')=>({algorithmVersion:'YNX-BATCH/v0.1',owner:network.owner,pkA:pair.pkA,pkB:pair.pkB,revision,registeredAt,activeFrom,ledgerNonce});
const policy=(pair={pkA:'11'.repeat(2592),pkB:'22'.repeat(64)})=>({owner:network.owner,executionHeight:'9007199254740993',ledgerNonce:'9007199254740993',algorithmVersion:'YNX-BATCH/v0.1',enabled:true,policyVersion:'YNX-ACCOUNT-POLICY/v1',networkId:network.chainId,enableAt:'10',activeRevision:'1',records:[record(pair)]});
const snapshot=(dto=policy())=>parsePQAccountAuthorization(dto,network);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');

test('new caller binds all 16 SDK kinds / 18 request shapes with executor fees and exact payload digest',()=>{
 const s=snapshot();assert.equal(new Set(rows.map(r=>r.kind)).size,16);assert.equal(rows.length,18);
 rows.forEach((input,i)=>{const r=preparePQTypedActionReview(s,input,metadata('controlled-'+i));assert.deepEqual(r.action,input);assert.equal(r.requestDigest,sha(encodePQNativeAction(input)));assert.equal(r.executionHeight,'9007199254740993');assert.equal(r.action.nonce,'9007199254740994');assert.equal(r.action.nativeChainId,'6423');assert.equal(r.dataOnly,true);assert.equal(r.permissionGranted,false);assert.ok(Object.isFrozen(r.action.payload));assert.ok(Object.isFrozen(r.pair));assert.deepEqual(recheckPQTypedActionReview(r,s,selected,at).action,input);});
 for(const input of rows)assert.throws(()=>preparePQTypedActionReview(s,{...input,fee:'7'},metadata()),{code:input.kind.startsWith('stake_')||input.kind.startsWith('contract_')?'PQ_NATIVE_ACTION_INVALID':'PQ_ACTION_REVIEW_MISMATCH'});
});
test('metadata rejects proxy/accessors/extras and copied reviews never become a caller grant',()=>{
 const s=snapshot();let calls=0;const bad={...metadata()};Object.defineProperty(bad,'account',{get(){calls++;return selected.account;}});
 assert.throws(()=>preparePQTypedActionReview(s,rows[0],bad));assert.equal(calls,0);
 assert.throws(()=>preparePQTypedActionReview(s,rows[0],new Proxy(metadata(),{ownKeys(){calls++;return[];}})));assert.equal(calls,0);
 assert.throws(()=>preparePQTypedActionReview(s,rows[0],{...metadata(),approved:true}));
 const r=preparePQTypedActionReview(s,rows[0],metadata());assert.throws(()=>recheckPQTypedActionReview({...r},s,selected,at),{code:'PQ_TYPED_ACTION_ORIGINAL_REVIEW_REQUIRED'});assert.throws(()=>signPQReviewedTypedAction({...r},s,{},selected,at),{code:'PQ_TYPED_ACTION_ORIGINAL_REVIEW_REQUIRED'});
});
test('foreign review invocation lookup does not execute attacker getters',()=>{
 let reads=0;const value={get operationId(){reads++;return 'foreign';}};
 assert.throws(()=>pqTypedActionInvocationData(value),{code:'PQ_TYPED_ACTION_ORIGINAL_REVIEW_REQUIRED'});assert.equal(reads,0);
});
test('account/network/nonce/full pair and revision changes refuse before signer entry',()=>{
 const s=snapshot(),r=preparePQTypedActionReview(s,rows[0],metadata());
 for(const b of [{...selected,account:'0x'+'88'.repeat(20)},{...selected,networkId:'88'.repeat(32)}])assert.throws(()=>signPQReviewedTypedAction(r,s,{},b,at),{code:'PQ_TYPED_ACTION_BINDING_MISMATCH'});
 const pair={pkA:'33'.repeat(2592),pkB:'44'.repeat(64)};
 for(const p of [{...policy(),ledgerNonce:'9007199254740994'},policy(pair),{...policy(),activeRevision:'2',records:[policy().records[0],record(pair,'2','20','21','2')]}])assert.throws(()=>signPQReviewedTypedAction(r,snapshot(p),{},selected,at),{code:'PQ_POLICY_CHANGED_REVIEW_REQUIRED'});
 assert.equal(pqTypedActionInvocationData(r).signerEntered,false);
});
test('review expiry and early clock refuse, while a forward observed height alone remains DATA',()=>{
 const s=snapshot(),r=preparePQTypedActionReview(s,rows[0],metadata());
 for(const when of [at-1,at+60_000,NaN])assert.throws(()=>signPQReviewedTypedAction(r,s,{},selected,when),{code:'PQ_TYPED_ACTION_REVIEW_EXPIRED'});
 const updated=snapshot({...policy(),executionHeight:'9007199254740994'});assert.equal(recheckPQTypedActionReview(r,updated,selected,at).policy.executionHeight,'9007199254740994');assert.equal(pqTypedActionInvocationData(r).signerEntered,false);
});
test('actual SDK custody refusal is single entry and never opens automatic replay',()=>{
 const s=snapshot(),r=preparePQTypedActionReview(s,rows[0],metadata());assert.throws(()=>signPQReviewedTypedAction(r,s,{},selected,at),{code:'PQ_KEY_HANDLE_UNAVAILABLE'});
 assert.deepEqual(pqTypedActionInvocationData(r),{operationId:r.operationId,signerEntered:true,dataOnly:true,canRetry:false});assert.throws(()=>signPQReviewedTypedAction(r,s,{},selected,at),{code:'PQ_TYPED_ACTION_SIGNER_ALREADY_ENTERED'});
});
test('real new caller returns one full signed Member; captured bytes survive a later guard failure',async()=>{
 const handle=await createPQWalletKeyHandle({chainId:network.chainId,owner:network.owner});
 try{
  const pair=pqPublicBindingToRegistrationKeys(readPQWalletKeyPublic(handle)),s=snapshot(policy(pair)),r=preparePQTypedActionReview(s,rows[0],metadata());
  const wire=signPQReviewedTypedAction(r,s,handle,selected,at);
  // Controlled original-custody ordering; no Main journal or Native approval is
  // simulated. Retain bytes before a later view/guard error can interrupt flow.
  const captured=Buffer.from(wire),before=sha(captured);assert.throws(()=>{throw Error('CONTROLLED_LATE_VIEW_LOSS');});
  const out=inspectPQTypedActionMember(r,captured);assert.equal(sha(captured),before);assert.equal(out.memberHash,'0x'+before);assert.deepEqual(out.action,rows[0]);assert.deepEqual(out.pair,{pkA:pair.pkA,pkB:pair.pkB});assert.equal(out.requestDigest,r.requestDigest);assert.equal(out.executionHeight,'9007199254740993');assert.equal(out.signatureVerified,true);assert.equal(out.memberCount,1);assert.equal(out.memberIndex,0);
  for(const name of ['nativeAdmission','submitted','canRetry','clearsOriginal','consensusFinality'])assert.equal(out[name],false);
  assert.throws(()=>signPQReviewedTypedAction(r,s,handle,selected,at),{code:'PQ_TYPED_ACTION_SIGNER_ALREADY_ENTERED'});
  const wrong=preparePQTypedActionReview(s,{...rows[0],payload:{amount:'2'}},metadata('other-original'));assert.throws(()=>inspectPQTypedActionMember(wrong,captured));
  const corrupt=Buffer.from(captured);corrupt[corrupt.length-1]^=1;assert.throws(()=>inspectPQTypedActionMember(r,corrupt));
 }finally{assert.equal(destroyPQWalletKeyHandle(handle),true);}
});
