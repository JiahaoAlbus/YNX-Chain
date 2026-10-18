import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createPQOriginalRecord} from '../../wallet-pq-intent-record.mjs';
import {preparePQTransferTransport} from '@ynx-chain/wallet-auth/pq-wallet-authorization';
import {preparePQTransferOriginal,pqTransferReviewBinding,readPQTransferOriginal} from './transfer-binding.mjs';
const vector=JSON.parse(gunzipSync(readFileSync(new URL('../../../test/fixtures/pq-public-http-af1cbaf.json.gz',import.meta.url))));
const row=vector.originals.find(x=>x.name==='transfer-lost-response'), account=vector.owner, networkId=vector.networkId;
const original=createPQOriginalRecord({account,kind:'pq-transfer',operationId:'QA-feature-original',request:preparePQTransferTransport(Buffer.from(row.wire,'base64'))});
const expected={account,networkId};
// Original public producer fixture; no live account, grant, or network effect.
test('existing SDK exact wire/hash/decimal transfer binds both review and broadcast without replacing signed message',()=>{
 const plan=preparePQTransferOriginal(original,expected), b=plan.binding;
 assert.equal(plan.request.path,'/transactions/pq/broadcast');assert.equal(plan.lookup.path,'/transactions/pq/originals/'+original.hash);
 assert.equal(plan.request.transportHash,original.hash);assert.deepEqual(plan.request.body,Buffer.from(original.wire,'base64url'));
 assert.notEqual(b.abciTransactionHash,b.hash);assert.equal(b.account,b.from);assert.equal(typeof b.nonce,'string');
 const transfer=Object.fromEntries(['chainId','nativeChainId','from','to','amount','fee','nonce'].map(k=>[k,b[k]]));
 const request={id:original.operationId,origin:'ynx-wallet:local-pq',method:'ynx_signPQNativeTransfer',params:[],createdAt:'2026-10-18T10:00:00.000Z',review:{title:'review',account,...transfer,policyRevision:'1',expiresAt:'2026-10-18T10:00:30.000Z',warning:'sign only'}};
 assert.equal(pqTransferReviewBinding(request,expected).intentSha256,b.intentSha256);
 const publicText=JSON.stringify(b);for(const secret of ['wire','pkA','pkB','body'])assert.equal(publicText.includes('"'+secret+'"'),false);
 const changed=plan.request.body;changed[0]^=1;assert.deepEqual(plan.request.body,Buffer.from(original.wire,'base64url'));
});
test('wrong owner/network/operation kind and tampered hash fail before transport',()=>{
 for(const input of [{...original,hash:'0x'+'0'.repeat(64)},{...original,account:'0x'+'2'.repeat(40)},{...original,kind:'pq-migration'}])assert.throws(()=>preparePQTransferOriginal(input,expected));
 assert.throws(()=>preparePQTransferOriginal(original,{...expected,networkId:'00'.repeat(32)}),{code:'PQ_TRANSACTION_NETWORK_BINDING'});
});
test('accessors cannot replace an original or a pending review',()=>{
 let calls=0;const o={...original};Object.defineProperty(o,'wire',{enumerable:true,get(){calls++;return original.wire;}});
 assert.throws(()=>preparePQTransferOriginal(o,expected));assert.equal(calls,0);
 const request={};Object.defineProperty(request,'review',{enumerable:true,get(){calls++;return {};}});
 assert.throws(()=>pqTransferReviewBinding(request,expected));assert.equal(calls,0);
});
test('read only uses retained original hash and rejects account switch after await',async()=>{
 let current=true,reads=0;const guard={account,assert(){if(!current)throw Error('LOCKED');}};
 const store={async readPQOriginals(owner,check){reads++;assert.equal(owner,account);check();return [original];}};
 assert.equal((await readPQTransferOriginal(store,original.hash,{...expected,guard})).binding.hash,original.hash);assert.equal(reads,1);
 await assert.rejects(readPQTransferOriginal(store,'0x'+'0'.repeat(64),{...expected,guard}),{code:'TRANSACTION_INTENT_REQUIRED'});
 await assert.rejects(readPQTransferOriginal({async readPQOriginals(){current=false;return [original];}},original.hash,{...expected,guard}),/LOCKED/);
});
