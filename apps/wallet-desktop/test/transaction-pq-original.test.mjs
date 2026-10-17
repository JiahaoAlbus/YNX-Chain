import test,{before} from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {FileTransactionIntentStore} from '../src/transaction-intent-store.mjs';
import {createPQOriginalRecord,parsePQOriginalRecord} from '../src/wallet-pq-intent-record.mjs';
import {createPQWalletKeyHandle,readPQWalletKeyPublic,destroyPQWalletKeyHandle,createPQWalletMigrationPossession,signPQWalletCurrentMigration,signPQWalletNativeTransfer} from '@ynx-chain/wallet-auth/pq-wallet-key-backup';
import {pqPublicBindingToRegistrationKeys,encodePQMigrationRequest,preparePQMigrationTransport,decodePQTransferRequest} from '@ynx-chain/wallet-auth/pq-wallet-authorization';
import {parsePQAccountAuthorization} from '@ynx-chain/wallet-auth/pq-wallet-policy';
const account='0x'+'1'.repeat(40),network={chainId:'71'.repeat(32),owner:account},guard=()=>{};
let original,transferOriginal;
// Actual SDK signatures, fresh QA keys and synthetic policy only. No network,
// real account approval, registration, user profile or chain finality.
before(async()=>{
 const old=await createPQWalletKeyHandle(network),fresh=await createPQWalletKeyHandle(network);
 try{
  const keys=pqPublicBindingToRegistrationKeys(readPQWalletKeyPublic(old)),next=pqPublicBindingToRegistrationKeys(readPQWalletKeyPublic(fresh));
  const snapshot=parsePQAccountAuthorization({owner:account,executionHeight:'30',ledgerNonce:'9007199254740993',algorithmVersion:'YNX-BATCH/v0.1',enabled:true,policyVersion:'YNX-ACCOUNT-POLICY/v1',networkId:network.chainId,enableAt:'10',activeRevision:'1',records:[{algorithmVersion:keys.algorithmVersion,owner:account,pkA:keys.pkA,pkB:keys.pkB,revision:'1',registeredAt:'10',activeFrom:'20',ledgerNonce:'1'}]},{...network,nativeChainId:'6423'});
  const intent={...next,priorRevision:'1',newRevision:'2',ledgerNonce:'9007199254740994',activateAt:'60'};
  const wire=encodePQMigrationRequest({intent,classicPublicKey:Buffer.alloc(0),classicSignature:Buffer.alloc(0),currentPQMember:signPQWalletCurrentMigration(old,intent,snapshot),newKeyWholeProof:createPQWalletMigrationPossession(fresh,intent)});
  original=createPQOriginalRecord({account,kind:'pq-migration',operationId:'QA-migration-original',request:preparePQMigrationTransport(wire)});
  transferOriginal=createPQOriginalRecord({account,kind:'pq-transfer',operationId:'QA-transfer-original',request:signPQWalletNativeTransfer(old,{chainId:network.chainId,nativeChainId:'6423',from:account,to:'0x'+'2'.repeat(40),amount:'3',fee:'1',nonce:'9007199254740994'},snapshot)});
 }finally{destroyPQWalletKeyHandle(old);destroyPQWalletKeyHandle(fresh);}
});
async function fixture(t,io){const directory=await fs.mkdtemp(path.join(tmpdir(),'ynx-pq-original-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));const filePath=path.join(directory,'journal.json');return {filePath,store:new FileTransactionIntentStore({filePath,...(io?{io}:{} )})};}
test('PQ migration uses the same journal owner/save/cold-read engine without effects',async t=>{
 const {store,filePath}=await fixture(t);await store.reserveOriginal(account,'pq-migration');store.captureOriginal(account,original,'pq-migration');
 const result=await store.saveOriginal(account,original.hash,guard);assert.deepEqual(result,{account,hash:original.hash,savedLocally:true,submitted:false,confirmed:false});
 assert.equal(store.localOriginal(account),null);assert.equal(JSON.parse(await fs.readFile(filePath,'utf8')).schemaVersion,6);
 const cold=new FileTransactionIntentStore({filePath});assert.deepEqual(await cold.readPQOriginals(account,guard),[original]);
 const before=await fs.readFile(filePath,'utf8');await cold.saveOriginal(account,original.hash,guard);assert.equal(await fs.readFile(filePath,'utf8'),before);
 await assert.rejects(cold.assertNoPreparation(account));await assert.rejects(cold.reserveOriginal(account,'native'));await assert.rejects(cold.reserveOriginal(account,'pq-migration'));
 await cold.reserveOriginal('0x'+'3'.repeat(40),'native');assert.deepEqual(await cold.readPQOriginals(account,guard),[original]);
});
test('PQ save lost acknowledgement reconciles the same committed file without a second write',async t=>{
 let armed=false,writes=0;const io={...fs,rename:async(...args)=>{await fs.rename(...args);if(armed){writes++;throw Error('QA_AFTER_ACTUAL_RENAME');}}};
 const {store,filePath}=await fixture(t,io);await store.reserveOriginal(account,'pq-migration');store.captureOriginal(account,original,'pq-migration');armed=true;
 await assert.rejects(store.saveOriginal(account,original.hash,guard));assert.equal(writes,1);assert.equal(store.localOriginal(account).pq.hash,original.hash);
 const before=await fs.readFile(filePath,'utf8');await assert.rejects(store.saveOriginal(account,original.hash,guard),{data:{code:'PQ_ORIGINAL_RECONCILE_REQUIRED'}});
 await store.reconcilePQOriginal(account,original.hash,guard);assert.equal(writes,1);assert.equal(await fs.readFile(filePath,'utf8'),before);assert.equal(store.localOriginal(account),null);
});
test('PQ lock before save preserves the original and cold unsigned reservation',async t=>{
 const {store,filePath}=await fixture(t);await store.reserveOriginal(account,'pq-migration');store.captureOriginal(account,original,'pq-migration');
 const before=await fs.readFile(filePath,'utf8');await assert.rejects(store.saveOriginal(account,original.hash,()=>{throw Error('QA_LOCKED');}));
 assert.equal(await fs.readFile(filePath,'utf8'),before);assert.equal(store.localOriginal(account).pq.wire,original.wire);
 const cold=new FileTransactionIntentStore({filePath});assert.equal((await cold.unresolvedPreparation(account)).kind,'pq-migration');await assert.rejects(cold.assertNoPreparation(account));await assert.rejects(cold.reconcilePQOriginal(account,original.hash,guard));
});
test('PQ parser refuses tampered owner/hash/wire/status and extra fields',()=>{
 for(const value of [{...original,account:'0x'+'2'.repeat(40)},{...original,hash:'0x'+'0'.repeat(64)},{...original,wire:original.wire+'='},{...original,status:'submitted'},{...original,raw:'0x00'}])assert.throws(()=>parsePQOriginalRecord(value),{code:'PQ_ORIGINAL_RECORD_INVALID'});
});
test('PQ capture rejects accessors before serialization and retains original account reservation',async t=>{
 const {store}=await fixture(t);await store.reserveOriginal(account,'pq-migration');let reads=0;
 const accessor={...original};Object.defineProperty(accessor,'wire',{get(){reads++;return original.wire;},enumerable:true});
 assert.throws(()=>store.captureOriginal(account,accessor,'pq-migration'),{code:'PQ_ORIGINAL_RECORD_INVALID'});assert.equal(reads,0);assert.equal(store.localOriginal(account).pq,null);
 store.captureOriginal(account,original,'pq-migration');assert.throws(()=>store.captureOriginal(account,{...original,operationId:'different'},'pq-migration'));assert.equal(store.localOriginal(account).pq.operationId,original.operationId);
});
test('PQ reserves worst-case signed-wire capacity before another producer can start',async t=>{
 const {store,filePath}=await fixture(t);await store.reserveOriginal(account,'pq-migration');await store.reserveOriginal('0x'+'2'.repeat(40),'pq-migration');
 const before=await fs.readFile(filePath,'utf8');await assert.rejects(store.reserveOriginal('0x'+'3'.repeat(40),'pq-migration'));
 assert.equal(store.localOriginal('0x'+'3'.repeat(40)),null);assert.equal(await fs.readFile(filePath,'utf8'),before);assert.equal((await store.unresolvedPreparation(account)).kind,'pq-migration');
});
test('PQ transfer cold read binds actual signed owner and preserves nonce above 2^53 without EVM raw',async t=>{
 const {store,filePath}=await fixture(t);await store.reserveOriginal(account,'pq-transfer');store.captureOriginal(account,transferOriginal,'pq-transfer');
 await store.saveOriginal(account,transferOriginal.hash,guard);const cold=new FileTransactionIntentStore({filePath}),[saved]=await cold.readPQOriginals(account,guard);
 assert.deepEqual(saved,transferOriginal);assert.equal('raw' in saved,false);assert.equal(decodePQTransferRequest(Buffer.from(saved.wire,'base64url')).transfer.nonce,'9007199254740994');
 assert.throws(()=>parsePQOriginalRecord({...saved,account:'0x'+'3'.repeat(40)}));await assert.rejects(cold.reserveOriginal(account,'native'));await assert.rejects(cold.reserveOriginal(account,'pq-migration'));
});
test('PQ transfer cannot masquerade as migration and getters cannot supply the original',async t=>{
 const {store}=await fixture(t);await store.reserveOriginal(account,'pq-transfer');
 assert.throws(()=>store.captureOriginal(account,transferOriginal,'pq-migration'));assert.throws(()=>parsePQOriginalRecord({...transferOriginal,kind:'pq-migration'}));
 assert.throws(()=>store.captureOriginal(account,original,'pq-transfer'));assert.equal(store.localOriginal(account).pq,null);
 store.captureOriginal(account,transferOriginal,'pq-transfer');assert.equal(store.localOriginal(account).pq.hash,transferOriginal.hash);
});
