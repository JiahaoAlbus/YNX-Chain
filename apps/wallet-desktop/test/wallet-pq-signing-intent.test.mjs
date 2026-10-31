import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {FileTransactionIntentStore} from '../src/transaction-intent-store.mjs';
import {createPQTransferPreview} from '../src/wallet-pq-transfer-preview.mjs';
const account='0x'+'11'.repeat(20),networkId='a'.repeat(64);
function preview(){return createPQTransferPreview({id:'original-operation',origin:'ynx-wallet:local-pq',method:'ynx_signPQNativeTransfer',params:[],createdAt:'2026-10-31T00:00:00.000Z',review:{title:'Review',account,chainId:networkId,nativeChainId:'6423',from:account,to:'0x'+'22'.repeat(20),amount:'3',fee:'1',nonce:'7',policyRevision:'1',expiresAt:'2026-10-31T00:01:00.000Z',warning:'Not approved'}},{account,networkId});}
async function fixture(t){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'wallet-pq-intent-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));const filePath=path.join(dir,'journal.json');return{filePath,store:new FileTransactionIntentStore({filePath})};}
test('T-P01-03 exact immutable intent is durable before signing and survives cold reopen without a new reservation',async t=>{
 const f=await fixture(t),intent=preview();await f.store.reserveOriginal(account,'pq-transfer',{intent});
 const raw=JSON.parse(await fs.readFile(f.filePath,'utf8'));assert.equal(raw.schemaVersion,12);assert.deepEqual(raw.preparations[0].intent,intent);
 const reopened=new FileTransactionIntentStore({filePath:f.filePath}),marker=await reopened.unresolvedPreparation(account);assert.deepEqual(marker.intent,intent);assert(Object.isFrozen(marker.intent));
 await assert.rejects(reopened.reserveOriginal(account,'pq-transfer',{intent}));assert.equal((await reopened.unresolvedPreparation(account)).intent.id,'original-operation');
});
test('T-P01-03 account/amount/nonce or digest substitution cannot be persisted as the approved intent',async t=>{
 for(const patch of [{principal:'0x'+'33'.repeat(20)},{amount:'4'},{nonce:'8'},{binding:{...preview().binding,sha512:'0'.repeat(128)}}]){
  const f=await fixture(t);await assert.rejects(f.store.reserveOriginal(account,'pq-transfer',{intent:{...preview(),...patch}}));await assert.rejects(fs.access(f.filePath));
 }
 const f=await fixture(t);await assert.rejects(f.store.reserveOriginal(account,'native',{intent:preview()}));await assert.rejects(fs.access(f.filePath));
});
test('T-P01-03 altered cold intent is rejected without rewriting or clearing UNKNOWN',async t=>{
 const f=await fixture(t);await f.store.reserveOriginal(account,'pq-transfer',{intent:preview()});const state=JSON.parse(await fs.readFile(f.filePath,'utf8'));state.preparations[0].intent.recipient='0x'+'44'.repeat(20);const changed=JSON.stringify(state);await fs.writeFile(f.filePath,changed,{mode:0o600});
 const reopened=new FileTransactionIntentStore({filePath:f.filePath});await assert.rejects(reopened.unresolvedPreparation(account));assert.equal(await fs.readFile(f.filePath,'utf8'),changed);
});
test('T-P01-03 legacy UNKNOWN stays unbound and blocked instead of inventing a recoverable signing intent',async t=>{
 const f=await fixture(t);await f.store.reserveOriginal(account,'pq-transfer');const before=await fs.readFile(f.filePath,'utf8'),reopened=new FileTransactionIntentStore({filePath:f.filePath});
 const marker=await reopened.unresolvedPreparation(account);assert.deepEqual(marker,{account,kind:'pq-transfer'});await assert.rejects(reopened.reserveOriginal(account,'pq-transfer',{intent:preview()}));assert.equal(await fs.readFile(f.filePath,'utf8'),before);
});
