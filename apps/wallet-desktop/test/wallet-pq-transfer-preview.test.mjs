import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {encodePQNativeTransfer} from '@ynx-chain/wallet-auth/pq-wallet-authorization';
import {createPQTransferPreview} from '../src/wallet-pq-transfer-preview.mjs';
const account='0x'+'11'.repeat(20),networkId='a'.repeat(64),to='0x'+'22'.repeat(20);
const request=patch=>({id:'original-review',origin:'ynx-wallet:local-pq',method:'ynx_signPQNativeTransfer',params:[],createdAt:'2026-10-31T00:00:00.000Z',review:{title:'Sign PQ transfer locally',account,chainId:networkId,nativeChainId:'6423',from:account,to,amount:'3',fee:'1',nonce:'7',policyRevision:'1',expiresAt:'2026-10-31T00:01:00.000Z',warning:'Local signature only',...patch}});
test('T-P01-02 original preview binds exact native bytes and immutable public review without approval',()=>{
 const r=request(),p=createPQTransferPreview(r,{account,networkId}),t=Object.fromEntries(['chainId','nativeChainId','from','to','amount','fee','nonce'].map(k=>[k,r.review[k]])),bytes=Buffer.from(encodePQNativeTransfer(t));
 assert.equal(p.transactionBinding.bytes,String(bytes.length));
 for(const[name,algorithm]of [['sha3_512','sha3-512'],['sha512','sha512']])assert.equal(p.transactionBinding[name],createHash(algorithm).update(bytes).digest('hex'));
 assert(Object.isFrozen(p));assert(Object.isFrozen(p.binding));assert(Object.isFrozen(p.transactionBinding));
 assert.throws(()=>p.amount='9',TypeError);r.review.amount='9';assert.equal(p.amount,'3');
 assert.deepEqual([p.approved,p.signed,p.submitted],[false,false,false]);
});
test('T-P01-02 amount, recipient, nonce and policy/expiry changes require a different review binding',()=>{
 const original=createPQTransferPreview(request(),{account,networkId});
 for(const patch of [{amount:'4'},{to:'0x'+'33'.repeat(20)},{nonce:'8'},{policyRevision:'2'},{expiresAt:'2026-10-31T00:00:59.000Z'}]){
  const next=createPQTransferPreview(request(patch),{account,networkId});assert.notEqual(next.binding.sha3_512,original.binding.sha3_512);assert.notEqual(next.binding.sha512,original.binding.sha512);
 }
});
test('T-P01-02 malformed or substituted source review cannot acquire a trusted preview',()=>{
 for(const patch of [{amount:'3.01'},{fee:'2'},{from:to},{chainId:'b'.repeat(64)},{nativeChainId:'1'},{nonce:'07'}])assert.throws(()=>createPQTransferPreview(request(patch),{account,networkId}));
 const accessor=request();Object.defineProperty(accessor.review,'amount',{enumerable:true,get(){assert.fail('Getter must never run')}});assert.throws(()=>createPQTransferPreview(accessor,{account,networkId}));
});
