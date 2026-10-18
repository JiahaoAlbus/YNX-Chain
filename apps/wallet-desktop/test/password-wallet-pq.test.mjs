import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {webcrypto,createECDH} from 'node:crypto';
import {canonicalJSON} from '../../../packages/wallet-auth/src/canonical.js';
import {DesktopKeyLifecycle} from '../src/key-lifecycle.mjs';
import {PasswordWalletVault} from '../src/password-wallet-vault.mjs';
import {createDualPQKeyPreparation} from '../src/wallet-pq-key-preparation.mjs';
import {createPQKeyPreparationSource} from '../src/wallet-pq-key-source.mjs';
import {parsePasswordVault,unlockPasswordVault,closePasswordVaultSession,decryptPasswordVaultRecord,rewritePasswordVault,decryptPasswordVaultPQRecord} from '../src/password-vault-crypto.mjs';
import * as keySDK from '../../../packages/wallet-auth/src/pq-wallet-key-backup.js';
import * as backupSDK from '../../../packages/wallet-auth/src/pq-wallet-backup.js';
import * as contractSDK from '../../../packages/wallet-auth/src/pq-wallet-contract.js';
import {pqPublicBindingToRegistrationKeys,decodePQTransferRequest,decodePQMigrationRequest} from '@ynx-chain/wallet-auth/pq-wallet-authorization';
import {parsePQAccountAuthorization} from '@ynx-chain/wallet-auth/pq-wallet-policy';
import {DesktopWalletAuthority,MemoryPermissionStore} from '../src/desktop-wallet-authority.mjs';
import {FileTransactionIntentStore} from '../src/transaction-intent-store.mjs';
import {createPQOriginalRecord} from '../src/wallet-pq-intent-record.mjs';
import {sessionOriginalCause} from '../src/wallet-session-original.mjs';
import {createPQTransferReviewUI} from '../src/wallet-pq-transfer-ui.mjs';
import {createPQMigrationReviewUI} from '../src/wallet-pq-migration-ui.mjs';
import {runInNewContext} from 'node:vm';
import {createProductSessionRequest,encodeProductSessionWalletURL,ynxAddressFromEVM,productSessionRequestDigest} from '@ynx-chain/wallet-auth';
import {DesktopAuthorizationController} from '../src/callback-policy.mjs';
import {PRODUCT_SESSION_REGISTRY} from '../src/wallet-auth-contract.mjs';
import {captureProductSessionAccountPolicy} from '@ynx-chain/wallet-auth/product-session-account-policy';
import {verifyPQProductSessionApproval} from '@ynx-chain/wallet-auth/product-session-pq-approval';
const SDK=Object.freeze({...keySDK,...backupSDK,...contractSDK}),PASSWORD='isolated-PQ-app-fixture-password',SECRET='1'.padStart(64,'0'),CHAIN='a'.repeat(64);
async function fixture(t,pqSDK=SDK){
 const directory=await fs.mkdtemp(path.join(tmpdir(),'ynx-app-pq-vault-')),filePath=path.join(directory,'wallet-vault-v3.json');
 const lifecycle=new DesktopKeyLifecycle();lifecycle.setFocused(true);
 const vault=new PasswordWalletVault({filePath,authorization:lifecycle,pqSDK,randomSecret:()=>SECRET});lifecycle.authorizer=vault.authorizer();
 t.after(async()=>{lifecycle.lock();await fs.rm(directory,{recursive:true,force:true});});
 await lifecycle.custody(g=>vault.setup({password:PASSWORD,confirmation:PASSWORD},g));await lifecycle.unlock({password:PASSWORD});
 const status=await lifecycle.run(()=>vault.createAccount());lifecycle.setAccount(status.account);await lifecycle.unlock({password:PASSWORD});
 const original=await fs.readFile(filePath,'utf8'),handle=await SDK.createPQWalletKeyHandle({chainId:CHAIN,owner:status.account}),binding=SDK.readPQWalletKeyPublic(handle);
 t.after(()=>SDK.destroyPQWalletKeyHandle(handle));return {directory,filePath,lifecycle,vault,handle,binding,original,account:status.account};
}
test('App SAME Vault actually stores and reads a real SDK dual-key backup without changing classic records',async t=>{
 const f=await fixture(t),before=parsePasswordVault(f.original);
 const receipt=await f.lifecycle.run(()=>f.vault.savePQKeys({handle:f.handle,publicBinding:f.binding,operationId:'TEST-operation'}));
 const text=await fs.readFile(f.filePath,'utf8'),after=parsePasswordVault(text);
 assert.deepEqual(after.records,before.records);assert.deepEqual(after.accounts,before.accounts);assert.deepEqual(after.passwordWrap,before.passwordWrap);assert.equal(after.activeAccount,before.activeAccount);
 assert.equal(after.revision,before.revision+1);assert.equal(after.pqKeyRecords.length,1);assert.equal(text.includes('credential'),false);
 assert.equal(receipt.chainRegistrationVerified,false);assert.equal(receipt.publicBinding.pkA,f.binding.pkA);assert.equal(receipt.publicBinding.pkB,f.binding.pkB);
 assert.equal(await f.lifecycle.run(()=>f.vault.verifySavedPQKeys({receipt,operationId:'TEST-operation',publicBinding:f.binding})),true);
 f.lifecycle.lock();await assert.rejects(f.vault.readPQKeys({operationId:'TEST-operation',publicBinding:f.binding}));await f.lifecycle.unlock({password:PASSWORD});
 const reread=await f.lifecycle.run(()=>f.vault.readPQKeys({operationId:'TEST-operation',publicBinding:f.binding}));assert.equal(reread.recordDigest,receipt.recordDigest);
 const session=await unlockPasswordVault(text,PASSWORD);try{assert.equal(await decryptPasswordVaultRecord(text,f.account,session),SECRET);}finally{closePasswordVaultSession(session);}
});
test('App SAME Vault preserves PQ ciphertext on ordinary rewrites and refuses replacement KeyGen records',async t=>{
 const f=await fixture(t);await f.lifecycle.run(()=>f.vault.savePQKeys({handle:f.handle,publicBinding:f.binding,operationId:'TEST-operation'}));
 const text=await fs.readFile(f.filePath,'utf8'),old=parsePasswordVault(text),session=await unlockPasswordVault(old,PASSWORD);let next;
 try{next=await rewritePasswordVault(old,{accounts:old.accounts.map(a=>({...a,label:'Updated public label'}))},session);assert.deepEqual(next.vault.pqKeyRecords,old.pqKeyRecords);}finally{closePasswordVaultSession(session);closePasswordVaultSession(next?.session);}
 await assert.rejects(f.lifecycle.run(()=>f.vault.assertPQPreparationAvailable()),e=>e?.data?.code==='PASSWORD_VAULT_PQ_ORIGINAL_EXISTS');
 await assert.rejects(f.lifecycle.run(()=>f.vault.savePQKeys({handle:f.handle,publicBinding:f.binding,operationId:'TEST-replacement'})),e=>e?.data?.code==='PASSWORD_VAULT_PQ_ORIGINAL_EXISTS');assert.equal(await fs.readFile(f.filePath,'utf8'),text);
});
test('App SAME Vault authenticates PQ account/network/public key and ciphertext metadata',async t=>{
 const f=await fixture(t);await f.lifecycle.run(()=>f.vault.savePQKeys({handle:f.handle,publicBinding:f.binding,operationId:'TEST-operation'}));const original=parsePasswordVault(await fs.readFile(f.filePath,'utf8'));
 for(const mutate of [v=>v.pqKeyRecords[0].binding.chainId='b'.repeat(64),v=>v.pqKeyRecords[0].binding.pkA=Buffer.alloc(2592,3).toString('base64url'),v=>v.pqKeyRecords[0].operationId='OTHER-operation',v=>{const r=v.pqKeyRecords[0];const b=Buffer.from(r.cipher.ciphertext,'base64url');b[0]^=1;r.cipher.ciphertext=b.toString('base64url');}]){
  const changed=structuredClone(original);mutate(changed);await assert.rejects(unlockPasswordVault(changed,PASSWORD));
 }
});
test('App independent process-style Vault session restores both actual SDK keys from device-encrypted material',async t=>{
 const f=await fixture(t);await f.lifecycle.run(()=>f.vault.savePQKeys({handle:f.handle,publicBinding:f.binding,operationId:'TEST-operation'}));
 const text=await fs.readFile(f.filePath,'utf8');f.lifecycle.lock();SDK.destroyPQWalletKeyHandle(f.handle);
 const freshSession=await unlockPasswordVault(text,PASSWORD);let payload,restored;
 try{payload=await decryptPasswordVaultPQRecord(text,f.account,freshSession);restored=await SDK.restorePQWalletKeyHandle(payload.wire,payload.credential,f.binding);SDK.assertPQPublicBindingMatches(SDK.readPQWalletKeyPublic(restored),f.binding);}
 finally{payload?.wire.fill(0);if(payload)payload.credential=null;if(restored)SDK.destroyPQWalletKeyHandle(restored);closePasswordVaultSession(freshSession);}
 assert.equal(SDK.pqWalletKeyCleanupUnresolved(),false);
});
function realCaller(f){
 const source=createPQKeyPreparationSource({sdk:SDK,repository:{assertCanPrepare:()=>f.vault.assertPQPreparationAvailable(),saveKeys:v=>f.vault.savePQKeys(v),readKeys:v=>f.vault.readPQKeys(v),verifySavedKeys:v=>f.vault.verifySavedPQKeys(v)},getOriginalNetwork:async()=>({chainId:CHAIN,owner:f.account}),getRegisteredBinding:async()=>{throw Error('No chain registration in this isolated test');},readRestoreInput:async()=>{throw Error('No user recovery prompt in this test');}});
 const controller=createDualPQKeyPreparation({lifecycle:f.lifecycle,source,getBinding:()=>({account:f.account,network:CHAIN}),id:()=> 'TEST-normal-caller'});return {source,controller};
}
test('App real normal caller saves SDK keys through SAME Vault and retires original custody on lock',async t=>{
 const f=await fixture(t),{source,controller}=realCaller(f);t.after(()=>controller.dispose());
 const result=await controller.generate();assert.equal(result.persisted,true);
 const material=controller.selectRetainedOutcome(x=>x.record.material),original=source.selectOriginal(material,x=>x.handle);
 const stored=parsePasswordVault(await fs.readFile(f.filePath,'utf8'));assert.equal(stored.pqKeyRecords[0].operationId,'TEST-normal-caller');
 f.lifecycle.lock();assert.equal(controller.status().phase,'saved');assert.equal(SDK.readPQWalletKeyCleanupOutcome(original).cleanupComplete,true);
 assert.throws(()=>SDK.readPQWalletKeyPublic(original),{code:'PQ_KEY_HANDLE_UNAVAILABLE'});
 await f.lifecycle.unlock({password:PASSWORD});const fresh=realCaller(f);t.after(()=>fresh.controller.dispose());
 await assert.rejects(fresh.controller.generate());assert.equal(parsePasswordVault(await fs.readFile(f.filePath,'utf8')).pqKeyRecords.length,1);
});
test('App actual committed Vault save with lost acknowledgement recovers read-only without another key generation or save',async t=>{
 const f=await fixture(t),{controller}=realCaller(f);t.after(()=>controller.dispose());let saves=0;
 const originalPublish=f.vault.files.publish.bind(f.vault.files);f.vault.files.publish=async(...args)=>{saves++;await originalPublish(...args);throw Error('TEST-only lost acknowledgement after committed file');};
 await assert.rejects(controller.generate());assert.equal(saves,1);assert.equal(controller.status().phase,'save-unknown');assert.equal(controller.status().keyRetired,true);
 assert.equal(parsePasswordVault(await fs.readFile(f.filePath,'utf8')).pqKeyRecords.length,1);
 f.vault.files.publish=originalPublish;await f.lifecycle.unlock({password:PASSWORD});
 const recovered=await controller.reconcile();assert.equal(recovered.phase,'saved');assert.equal(recovered.persisted,true);assert.equal(saves,1);
 await assert.rejects(controller.generate());assert.equal(saves,1);
});
test('App PQ record prevents an old private recovery key from silently discarding new keys during password reset',async t=>{
 const f=await fixture(t);await f.lifecycle.run(()=>f.vault.savePQKeys({handle:f.handle,publicBinding:f.binding,operationId:'TEST-operation'}));const before=await fs.readFile(f.filePath,'utf8');f.lifecycle.lock();
 await assert.rejects(f.lifecycle.custody(guard=>f.vault.prepareRecovery({account:f.account,kind:'private-key',value:SECRET,resetPassword:true,newPassword:'new isolated PQ password',confirmation:'new isolated PQ password'},guard)),e=>e?.data?.code==='PQ_INDEPENDENT_BACKUP_REQUIRED');
 assert.equal(await fs.readFile(f.filePath,'utf8'),before);
});

// Test-only corruption with the isolated fixture password: authenticate both
// envelopes so the test reaches private payload parsing, not just GCM rejection.
async function authenticatedMalformedPQ(vault,plaintext){
 const output=structuredClone(vault),encode=v=>Buffer.from(canonicalJSON(v));
 const base=await webcrypto.subtle.importKey('raw',Buffer.from(PASSWORD),'PBKDF2',false,['deriveKey']);
 const wrapper=await webcrypto.subtle.deriveKey({name:'PBKDF2',hash:'SHA-256',salt:Buffer.from(vault.passwordWrap.kdf.salt,'base64url'),iterations:600000},base,{name:'AES-GCM',length:256},false,['decrypt']);
 const wrapAAD={domain:'YNX_DESKTOP_PASSWORD_WRAP_V3',schemaVersion:3,cryptoSuite:vault.cryptoSuite,vaultId:vault.vaultId,kdf:vault.passwordWrap.kdf};
 const decrypt=(key,cipher,aad)=>webcrypto.subtle.decrypt({name:'AES-GCM',iv:Buffer.from(cipher.iv,'base64url'),additionalData:encode(aad),tagLength:128},key,Buffer.from(cipher.ciphertext,'base64url'));
 const raw=await decrypt(wrapper,vault.passwordWrap.cipher,wrapAAD);let key;
 try{key=await webcrypto.subtle.importKey('raw',raw,'AES-GCM',false,['encrypt','decrypt']);}finally{new Uint8Array(raw).fill(0);}
 const {catalogCipher,...header}=vault;
 const catalog=new Uint8Array(await decrypt(key,catalogCipher,{domain:'YNX_DESKTOP_ACCOUNT_CATALOG_V3',...header}));
 async function encrypted(bytes,aad){const iv=webcrypto.getRandomValues(new Uint8Array(12));return {name:'AES-GCM',iv:Buffer.from(iv).toString('base64url'),ciphertext:Buffer.from(await webcrypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:encode(aad),tagLength:128},key,bytes)).toString('base64url')};}
 try{
  const record=output.pqKeyRecords[0];record.bytes=plaintext.length;
  const {cipher,...metadata}=record;record.cipher=await encrypted(plaintext,{domain:'YNX_DESKTOP_DUAL_PQ_KEYS_V1',vaultId:output.vaultId,...metadata});
  const {catalogCipher:oldCatalog,...nextHeader}=output;
  output.catalogCipher=await encrypted(catalog,{domain:'YNX_DESKTOP_ACCOUNT_CATALOG_V3',...nextHeader});return output;
 }finally{catalog.fill(0);}
}
test('App authenticated malformed private payload never exposes parser plaintext in an error',async t=>{
 const f=await fixture(t);await f.lifecycle.run(()=>f.vault.savePQKeys({handle:f.handle,publicBinding:f.binding,operationId:'TEST-operation'}));
 const vault=parsePasswordVault(await fs.readFile(f.filePath,'utf8'));
 for(const bytes of [Buffer.from('{"TEST_PRIVATE_PAYLOAD_DO_NOT_LOG":'),Buffer.from([0xff,0xfe,0xfd])]){
  const malformed=await authenticatedMalformedPQ(vault,bytes),session=await unlockPasswordVault(malformed,PASSWORD);
  try{await assert.rejects(decryptPasswordVaultPQRecord(malformed,f.account,session),e=>e.code==='PASSWORD_VAULT_INVALID'&&e.data.code===e.code&&!e.message.includes('TEST_PRIVATE_PAYLOAD_DO_NOT_LOG')&&!(e instanceof SyntaxError));}
  finally{closePasswordVaultSession(session);bytes.fill(0);}
 }
});
function syntheticTransfer(f){
 const keys=pqPublicBindingToRegistrationKeys(f.binding),snapshot=parsePQAccountAuthorization({owner:f.account,executionHeight:'30',ledgerNonce:'9007199254740993',algorithmVersion:'YNX-BATCH/v0.1',enabled:true,policyVersion:'YNX-ACCOUNT-POLICY/v1',networkId:CHAIN,enableAt:'10',activeRevision:'1',records:[{algorithmVersion:keys.algorithmVersion,owner:f.account,pkA:keys.pkA,pkB:keys.pkB,revision:'1',registeredAt:'10',activeFrom:'20',ledgerNonce:'1'}]},{chainId:CHAIN,nativeChainId:'6423',owner:f.account});
 return {snapshot,transfer:{chainId:CHAIN,nativeChainId:'6423',from:f.account,to:'0x'+'2'.repeat(40),amount:'3',fee:'1',nonce:'9007199254740994'}};
}
test('normal migration proposal reads only same protected public pair without claiming registration',async t=>{
 const f=await fixture(t);await f.lifecycle.run(()=>f.vault.savePQKeys({handle:f.handle,publicBinding:f.binding,operationId:'QA-proposed-key-source'}));
 const proposal=await f.lifecycle.run(()=>f.vault.readPQProposalBinding(CHAIN));assert.deepEqual(proposal,f.binding);assert.equal(Object.isFrozen(proposal),true);assert.equal('credential' in proposal,false);assert.equal('handle' in proposal,false);
 await assert.rejects(f.lifecycle.run(()=>f.vault.readPQProposalBinding('b'.repeat(64))),e=>e.data?.code==='PQ_KEY_BINDING_CHANGED');
 const intent={...pqPublicBindingToRegistrationKeys(proposal),priorRevision:'0',newRevision:'1',ledgerNonce:'1',activateAt:'60'};
 const possession=await f.lifecycle.run(()=>f.vault.withPQKeys(proposal,handle=>SDK.createPQWalletMigrationPossession(handle,intent)));assert.ok(possession instanceof Uint8Array);assert.ok(possession.length>1000);
 f.lifecycle.lock();await assert.rejects(f.vault.readPQProposalBinding(CHAIN));
});
test('original Vault typed-sign caller restores only the matching pair and retires its temporary handle',async t=>{
 const f=await fixture(t),{snapshot,transfer}=syntheticTransfer(f);await f.lifecycle.run(()=>f.vault.savePQKeys({handle:f.handle,publicBinding:f.binding,operationId:'QA-sign-source'}));let selected;
 const result=await f.lifecycle.run(()=>f.vault.withPQKeys(f.binding,(handle,binding,guard)=>{guard.assert();selected=handle;assert.deepEqual(binding,f.binding);return SDK.signPQWalletNativeTransfer(handle,transfer,snapshot);}));
 assert.equal(decodePQTransferRequest(result.body).transfer.nonce,transfer.nonce);assert.equal(SDK.readPQWalletKeyCleanupOutcome(selected).cleanupComplete,true);assert.throws(()=>SDK.readPQWalletKeyPublic(selected),{code:'PQ_KEY_HANDLE_UNAVAILABLE'});
});
test('original Vault lock after typed signing retains producer result but refuses unlocked success',async t=>{
 const f=await fixture(t),{snapshot,transfer}=syntheticTransfer(f);await f.lifecycle.run(()=>f.vault.savePQKeys({handle:f.handle,publicBinding:f.binding,operationId:'QA-sign-source'}));let retained,selected;
 await assert.rejects(f.lifecycle.run(()=>f.vault.withPQKeys(f.binding,handle=>{selected=handle;retained=SDK.signPQWalletNativeTransfer(handle,transfer,snapshot);f.lifecycle.lock();assert.equal(SDK.readPQWalletKeyCleanupOutcome(handle).cleanupComplete,true);return retained;})));
 assert.equal(decodePQTransferRequest(retained.body).transfer.from,f.account);assert.equal(SDK.readPQWalletKeyCleanupOutcome(selected).cleanupComplete,true);
});
test('original Vault captures and retires a restored handle returned after a lock before callback',async t=>{
 let armed=false,lock=()=>{},late,actions=0;const sdk={...SDK,restorePQWalletKeyHandle:async(...args)=>{const handle=await SDK.restorePQWalletKeyHandle(...args);if(armed){late=handle;lock();}return handle;}};
 const f=await fixture(t,sdk);await f.lifecycle.run(()=>f.vault.savePQKeys({handle:f.handle,publicBinding:f.binding,operationId:'QA-sign-source'}));lock=()=>f.lifecycle.lock();armed=true;
 await assert.rejects(f.lifecycle.run(()=>f.vault.withPQKeys(f.binding,()=>{actions++;})));assert.equal(actions,0);assert.equal(SDK.readPQWalletKeyCleanupOutcome(late).cleanupComplete,true);
});
async function approvalFixture(t,{onRecheck,acquire,migration=false,activeMigration=false}={}){
 const f=await fixture(t),snapshot=migration&&!activeMigration?parsePQAccountAuthorization({owner:f.account,executionHeight:'30',ledgerNonce:'9007199254740993',algorithmVersion:'legacy',enabled:true,policyVersion:'YNX-ACCOUNT-POLICY/v1',networkId:CHAIN,enableAt:'10',records:[]},{chainId:CHAIN,nativeChainId:'6423',owner:f.account}):syntheticTransfer(f).snapshot;await f.lifecycle.run(()=>f.vault.savePQKeys({handle:f.handle,publicBinding:f.binding,operationId:'QA-sign-source'}));
 const counts={acquire:0,recheck:0,retire:0,join:0,close:0},at=Date.now(),view=Object.freeze({version:'YNX-WALLET-TRANSACTION-POLICY/v1',networkId:CHAIN,nativeChainId:'6423',canonicalOwner:f.account,authorization:snapshot,observedAt:new Date(at-1000).toISOString(),expiresAt:new Date(at+60000).toISOString()});let retired=false;
 const resource={assertCurrent(){if(retired)throw Error('QA_RETIRED');},readOriginal(){return view;},async recheck(){counts.recheck++;await onRecheck?.();},retire(){counts.retire++;retired=true;},async join(){counts.join++;},async close(){counts.close++;}};
 const source=async input=>{counts.acquire++;assert.equal(input.owner,f.account);assert.equal(input.networkId,CHAIN);assert.equal(input.nativeChainId,'6423');assert.equal(input.operation,migration?'migration':'transfer');if(acquire)await acquire();return resource;};
 const store=new FileTransactionIntentStore({filePath:path.join(f.directory,'journal.json')}),authority=new DesktopWalletAuthority({vault:f.vault,permissions:new MemoryPermissionStore(),transactionSender:{submissions:{intentStore:store}},pqPolicySource:source,pqPolicyRecognized:value=>value===resource,pqNetworkId:CHAIN});
 return {...f,authority,store,counts,resource};
}
test('normal original pending approval performs actual protected typed signing and local save only',async t=>{
 const f=await approvalFixture(t),response=await f.lifecycle.run(()=>f.authority.requestPQTransfer({to:'0x'+'2'.repeat(40),amount:'3'}));
 assert.equal(response.request.method,'ynx_signPQNativeTransfer');assert.equal('snapshot' in response.request,false);assert.equal('resource' in response.request,false);assert.equal((await f.store.readPQOriginals(f.account,()=>{})).length,0);
 const result=await f.lifecycle.run(()=>f.authority.approve(response.request.id));assert.equal(result.status,'success');assert.equal(result.result.submitted,false);assert.equal(result.result.confirmed,false);
 const [record]=await f.store.readPQOriginals(f.account,()=>{});assert.equal(record.hash,result.result.hash);assert.equal(decodePQTransferRequest(Buffer.from(record.wire,'base64url')).transfer.nonce,'9007199254740994');
 assert.deepEqual(f.counts,{acquire:1,recheck:1,retire:1,join:1,close:1});await assert.rejects(f.lifecycle.run(()=>f.authority.approve(response.request.id)));
});
test('normal initial migration separately signs original classic digest and real new-pair PoP, then retains full wire only',async t=>{
 const f=await approvalFixture(t,{migration:true}),request=await f.lifecycle.run(()=>f.authority.requestPQMigration({activateAt:'60'}));
 assert.equal(request.request.method,'ynx_signPQMigration');assert.equal(request.request.review.activationHeight,'60');assert.equal(request.request.review.newRevision,'1');
 assert.equal((await f.store.readPQOriginals(f.account,()=>{})).length,0);
 const result=await f.lifecycle.run(()=>f.authority.approve(request.request.id));assert.equal(result.result.submitted,false);assert.equal(result.result.confirmed,false);
 const [record]=await f.store.readPQOriginals(f.account,()=>{}),decoded=decodePQMigrationRequest(Buffer.from(record.wire,'base64url'));
 assert.equal(record.hash,result.result.hash);assert.equal(record.kind,'pq-migration');assert.equal(decoded.currentAuthorization,'legacy');assert.equal(decoded.intent.ledgerNonce,'9007199254740994');assert.equal(decoded.intent.activateAt,'60');assert.equal(decoded.classicPublicKey.length,33);assert.ok(decoded.newKeyWholeProof.length>1000);assert.equal(decoded.currentPQMember.length,0);
 assert.deepEqual(f.counts,{acquire:1,recheck:1,retire:1,join:1,close:1});await assert.rejects(f.lifecycle.run(()=>f.authority.approve(request.request.id)));
});
test('initial migration cancellation creates no journal reservation or signature',async t=>{
 const f=await approvalFixture(t,{migration:true}),request=await f.lifecycle.run(()=>f.authority.requestPQMigration({activateAt:'60'}));
 f.authority.cancelAll();await f.authority.shutdownPQReviews();assert.equal((await f.store.readPQOriginals(f.account,()=>{})).length,0);assert.equal(await f.store.unresolvedPreparation(f.account),null);await assert.rejects(f.lifecycle.run(()=>f.authority.approve(request.request.id)));assert.equal(f.counts.close,1);
});
test('active PQ rotation never falls back to the classic key or overwrites the protected pair',async t=>{
 const f=await approvalFixture(t,{migration:true,activeMigration:true}),before=await fs.readFile(f.filePath,'utf8');
 await assert.rejects(f.lifecycle.run(()=>f.authority.requestPQMigration({activateAt:'60'})),error=>error.data?.code==='PQ_ROTATION_PROPOSAL_SLOT_REQUIRED');
 assert.equal(await fs.readFile(f.filePath,'utf8'),before);assert.equal(await f.store.unresolvedPreparation(f.account),null);assert.equal(f.counts.close,1);
});
test('migration lock immediately after full signed output captures it before save and never loses or re-signs it',async t=>{
 const f=await approvalFixture(t,{migration:true}),request=await f.lifecycle.run(()=>f.authority.requestPQMigration({activateAt:'60'})),capture=f.store.captureOriginal.bind(f.store);let captures=0;
 f.store.captureOriginal=(...args)=>{captures++;capture(...args);f.lifecycle.lock();};await assert.rejects(f.lifecycle.run(()=>f.authority.approve(request.request.id)));
 assert.equal(captures,1);const original=f.store.localOriginal(f.account);assert.equal(original.kind,'pq-migration');assert.equal(decodePQMigrationRequest(Buffer.from(original.pq.wire,'base64url')).currentAuthorization,'legacy');assert.equal((await f.store.readPQOriginals(f.account,()=>{})).length,0);
 await f.lifecycle.unlock({password:PASSWORD});await assert.rejects(f.lifecycle.run(()=>f.authority.approve(request.request.id)));assert.equal(captures,1);
});
test('normal original review refuses missing source before any policy acquisition or signature',async t=>{
 const f=await fixture(t),authority=new DesktopWalletAuthority({vault:f.vault,permissions:new MemoryPermissionStore(),transactionSender:{}});
 await assert.rejects(f.lifecycle.run(()=>authority.requestPQTransfer({to:'0x'+'2'.repeat(40),amount:'3'})),e=>e.data?.code==='PQ_AUTHORIZATION_SOURCE_NOT_SUPPLIED');assert.equal(authority.pendingRequests().length,0);
});
test('normal policy recheck refusal precedes journal reservation and retires the original once',async t=>{
 const failure=Error('QA_POLICY_CHANGED'),f=await approvalFixture(t,{onRecheck:()=>{throw failure;}}),request=await f.lifecycle.run(()=>f.authority.requestPQTransfer({to:'0x'+'2'.repeat(40),amount:'3'}));
 await assert.rejects(f.lifecycle.run(()=>f.authority.approve(request.request.id)),e=>e===failure);assert.equal(await f.store.unresolvedPreparation(f.account),null);assert.equal(f.counts.retire,1);assert.equal(f.counts.close,1);
});
test('normal failed factory retains nonenumerable partial before qualification or live checks',async t=>{
 let failure;const f=await approvalFixture(t,{acquire:()=>{throw failure;}});failure=Object.assign(Error('AUTH_WALLET_TRANSACTION_POLICY_NOT_SUPPLIED'),{code:'AUTH_WALLET_TRANSACTION_POLICY_NOT_SUPPLIED'});Object.defineProperty(failure,'partial',{value:f.resource});f.resource.readOriginal=()=>{throw Error('PARTIAL_MUST_NOT_BE_READ');};
 await assert.rejects(f.lifecycle.run(()=>f.authority.requestPQTransfer({to:'0x'+'2'.repeat(40),amount:'3'})),e=>e===failure);assert.equal(f.authority.pendingRequests().length,0);assert.equal(await f.store.unresolvedPreparation(f.account),null);assert.deepEqual(f.counts,{acquire:1,recheck:0,retire:1,join:1,close:1});
});
test('normal unrecognized factory result cannot enter policy parsing or key custody',async t=>{
 const f=await approvalFixture(t);f.resource.readOriginal=()=>{throw Error('UNRECOGNIZED_MUST_NOT_BE_READ');};const authority=new DesktopWalletAuthority({vault:f.vault,permissions:new MemoryPermissionStore(),transactionSender:{submissions:{intentStore:f.store}},pqPolicySource:async()=>f.resource,pqPolicyRecognized:()=>false,pqNetworkId:CHAIN});
 await assert.rejects(f.lifecycle.run(()=>authority.requestPQTransfer({to:'0x'+'2'.repeat(40),amount:'3'})),e=>e.data?.code==='PQ_AUTHORIZATION_SOURCE_NOT_SUPPLIED');assert.equal(f.counts.retire,1);assert.equal(f.counts.close,1);assert.equal(await f.store.unresolvedPreparation(f.account),null);
});
test('normal approval retains signed original when lock occurs immediately after capture',async t=>{
 const f=await approvalFixture(t),request=await f.lifecycle.run(()=>f.authority.requestPQTransfer({to:'0x'+'2'.repeat(40),amount:'3'})),capture=f.store.captureOriginal.bind(f.store);
 f.store.captureOriginal=(...args)=>{const saved=capture(...args);f.lifecycle.lock();return saved;};
 await assert.rejects(f.lifecycle.run(()=>f.authority.approve(request.request.id)));assert.ok(f.store.localOriginal(f.account).pq.wire);assert.equal((await f.store.unresolvedPreparation(f.account)).kind,'pq-transfer');assert.equal(f.counts.close,1);
});
test('normal request captures and closes a policy resource returned after the original lifecycle locks',{timeout:5000},async t=>{
 let release,entered;const pause=new Promise(r=>{release=r;}),entry=new Promise(r=>{entered=r;}),f=await approvalFixture(t,{acquire:()=>{entered();return pause;}});
 const pending=f.lifecycle.run(()=>f.authority.requestPQTransfer({to:'0x'+'2'.repeat(40),amount:'3'}));
 await entry;f.lifecycle.lock();release();await assert.rejects(pending);
 assert.equal(f.authority.pendingRequests().length,0);assert.equal(await f.store.unresolvedPreparation(f.account),null);assert.equal(f.counts.retire,1);assert.equal(f.counts.close,1);
});
test('normal cancellation drains original resource once without reserving or signing',async t=>{
 const f=await approvalFixture(t),request=await f.lifecycle.run(()=>f.authority.requestPQTransfer({to:'0x'+'2'.repeat(40),amount:'3'}));
 assert.throws(()=>f.authority.reject(request.request.id));await f.authority.shutdownPQReviews();assert.equal(await f.store.unresolvedPreparation(f.account),null);assert.equal(f.counts.recheck,0);assert.equal(f.counts.retire,1);assert.equal(f.counts.join,1);assert.equal(f.counts.close,1);
});
test('normal policy join failure is retained and never hidden by close or replacement acquisition',async t=>{
 const f=await approvalFixture(t),request=await f.lifecycle.run(()=>f.authority.requestPQTransfer({to:'0x'+'2'.repeat(40),amount:'3'}));f.resource.join=async()=>{f.counts.join++;throw false;};
 assert.throws(()=>f.authority.reject(request.request.id));await assert.rejects(f.authority.shutdownPQReviews());assert.equal(f.counts.close,0);assert.equal(f.counts.join,1);
 const same=f.authority.shutdownPQReviews();await assert.rejects(same);assert.equal(f.counts.join,1);await assert.rejects(f.lifecycle.run(()=>f.authority.requestPQTransfer({to:'0x'+'2'.repeat(40),amount:'3'})));assert.equal(f.counts.acquire,1);
});
test('normal shutdown waits for late original acquisition and selects one cleanup promise',{timeout:5000},async t=>{
 let release,entered;const pause=new Promise(r=>{release=r;}),entry=new Promise(r=>{entered=r;}),f=await approvalFixture(t,{acquire:()=>{entered();return pause;}});
 const request=f.lifecycle.run(()=>f.authority.requestPQTransfer({to:'0x'+'2'.repeat(40),amount:'3'}));await entry;f.lifecycle.lock();const shutdown=f.authority.shutdownPQReviews();assert.equal(shutdown,f.authority.shutdownPQReviews());let done=false;void shutdown.then(()=>{done=true;});await Promise.resolve();assert.equal(done,false);release();await assert.rejects(request);await shutdown;assert.equal(f.counts.retire,1);assert.equal(f.counts.join,1);assert.equal(f.counts.close,1);
});
test('mounted normal UI click reaches actual original main request and approval bodies with QA crypto',async t=>{
 const f=await approvalFixture(t),main=await fs.readFile(new URL('../src/main.mjs',import.meta.url),'utf8'),handlers=new Map(),events=[];
 const context={handleWalletIPC:(name,callback)=>handlers.set(name,callback),walletAuthority:f.authority,keyAccess:f.lifecycle,mainWindow:{webContents:{send:(...args)=>events.push(args)}},sensitiveIPC:(action,options)=>f.lifecycle.run(action,options),walletConnectRequests:new Map(),accountChangeInProgress:false};
 const start=main.indexOf("handleWalletIPC('wallet:pq-transfer-review'"),end=main.indexOf('\nhandleWalletIPC("wallet:transaction-history"',start),a=main.indexOf('handleWalletIPC("wallet:provider-action"'),b=main.indexOf('\nasync function handleCallback',a);
 assert.ok(start>=0&&end>start&&a>=0&&b>a);runInNewContext(main.slice(start,end)+'\n'+main.slice(a,b),context);
 const nodes=new Map(),node=()=>({value:'',textContent:'',disabled:false,append(value){this.child=value;},addEventListener(name,callback){this[name]=callback;}}),doc={querySelector:id=>{if(!nodes.has(id))nodes.set(id,node());return nodes.get(id);},createElement:node};doc.querySelector('#transfer-to').value='0x'+'2'.repeat(40);doc.querySelector('#transfer-amount').value='3';
 const ui=createPQTransferReviewUI({document:doc,getKeyState:()=>f.lifecycle.status(),api:{preparePQTransfer:async input=>({ok:true,value:await handlers.get('wallet:pq-transfer-review')({},input)})}});ui.render();assert.equal(doc.querySelector('#transfer-form').child.disabled,false);assert.equal(doc.querySelector('#transfer-form').child.type,'button');
 await doc.querySelector('#transfer-form').child.click();assert.match(doc.querySelector('#transfer-result').textContent,/approval window/);assert.equal(events.length,1);assert.equal(events[0][0],'wallet:provider-request');
 const result=await handlers.get('wallet:provider-action')({},events[0][1].id,'approve');assert.equal(result.status,'success');assert.equal(result.result.submitted,false);assert.equal(result.responseDelivered,false);assert.equal((await f.store.readPQOriginals(f.account,()=>{})).length,1);
});
test('mounted migration form reaches original main and pending approval with actual isolated crypto',async t=>{
 const f=await approvalFixture(t,{migration:true}),main=await fs.readFile(new URL('../src/main.mjs',import.meta.url),'utf8'),handlers=new Map(),events=[];
 const context={handleWalletIPC:(name,callback)=>handlers.set(name,callback),walletAuthority:f.authority,keyAccess:f.lifecycle,mainWindow:{webContents:{send:(...args)=>events.push(args)}},sensitiveIPC:(action,options)=>f.lifecycle.run(action,options),walletConnectRequests:new Map(),accountChangeInProgress:false};
 const start=main.indexOf("handleWalletIPC('wallet:pq-transfer-review'"),end=main.indexOf('\nhandleWalletIPC("wallet:transaction-history"',start),a=main.indexOf('handleWalletIPC("wallet:provider-action"'),b=main.indexOf('\nasync function handleCallback',a);
 runInNewContext(main.slice(start,end)+'\n'+main.slice(a,b),context);
 const nodes=new Map(),node=()=>({value:'',textContent:'',disabled:false,children:[],setAttribute(){},append(...values){this.children.push(...values);for(const value of values)if(value.id)nodes.set('#'+value.id,value);},addEventListener(name,callback){this[name]=callback;}}),doc={querySelector:id=>{if(!nodes.has(id))nodes.set(id,node());return nodes.get(id);},createElement:node};
 const ui=createPQMigrationReviewUI({document:doc,getKeyState:()=>f.lifecycle.status(),api:{preparePQMigration:async input=>({ok:true,value:await handlers.get('wallet:pq-migration-review')({},input)})}});ui.render();
 const form=nodes.get('#pq-migration-form'),height=nodes.get('#pq-migration-height'),button=form.children[3],notice=form.children[4];height.value='60';assert.equal(button.disabled,false);
 await form.submit({preventDefault(){}});assert.match(notice.textContent,/approval window/);assert.equal(events.length,1);assert.equal(events[0][1].method,'ynx_signPQMigration');assert.equal((await f.store.readPQOriginals(f.account,()=>{})).length,0);
 const result=await handlers.get('wallet:provider-action')({},events[0][1].id,'approve');assert.equal(result.result.submitted,false);assert.equal(result.responseDelivered,false);assert.equal((await f.store.readPQOriginals(f.account,()=>{}))[0].kind,'pq-migration');
});
function sessionQA(f,{legacy=false}={}){
 const at=new Date(),keys=pqPublicBindingToRegistrationKeys(f.binding),counts={acquire:0,recheck:0,retire:0,join:0,close:0};let retired=false;
 const view=Object.freeze({version:'YNX-PRODUCT-SESSION-ACCOUNT-POLICY/v1',networkId:CHAIN,canonicalOwner:f.account,checkpoint:Object.freeze({kind:'trusted-node-committed/v1',height:'9007199254740993',blockHash:'22'.repeat(32)}),policyVersion:'YNX-ACCOUNT-POLICY/v1',algorithmVersion:legacy?'legacy':'YNX-BATCH/v0.1',activeRecord:legacy?null:Object.freeze({revision:'1',registeredAt:'10',activeFrom:'20',pkA:keys.pkA,pkB:keys.pkB}),observedAt:at.toISOString(),expiresAt:new Date(at.getTime()+60000).toISOString()});
 const resource={readOriginal:()=>view,assertCurrent(){if(retired)throw Error('QA_RETIRED');},async recheck(){counts.recheck++;},retire(){counts.retire++;retired=true;},async join(){counts.join++;},async close(){counts.close++;}};
 const device=createECDH('prime256v1');device.setPrivateKey(Buffer.alloc(32,7));
 const request=createProductSessionRequest(PRODUCT_SESSION_REGISTRY,{productId:'finance',platform:'web',deviceId:'a'.repeat(43),deviceKey:device.getPublicKey(null,'compressed').toString('base64url'),scopes:['finance.portfolio.read'],purpose:'Explicit isolated QA sign-in',nonce:'b'.repeat(43),state:'c'.repeat(43)},at);
 const options={vault:f.vault,permissions:new MemoryPermissionStore(),transactionSender:{submissions:{intentStore:new FileTransactionIntentStore({filePath:path.join(f.directory,'session-journal.json')})}},clock:()=>at,pqNetworkId:CHAIN,pqSessionSource:async input=>{counts.acquire++;assert.equal(input.owner,f.account);assert.equal(input.operation,'approval');return resource;},pqSessionRecognized:value=>value===resource};
 return {at,view,resource,request,counts,options};
}
test('normal PQ callback refuses oversized inline fallback before delivery and retains the exact signed original',async t=>{
 const f=await fixture(t);await f.lifecycle.run(()=>f.vault.savePQKeys({handle:f.handle,publicBinding:f.binding,operationId:'QA-session-pair'}));
 const s=sessionQA(f),authority=new DesktopWalletAuthority(s.options);let signs=0,launches=0;
 const keys=f.vault.withPQKeys.bind(f.vault);f.vault.withPQKeys=(...args)=>{signs++;return keys(...args);};
 const controller=new DesktopAuthorizationController({authority,clock:()=>s.at,openExternal:async()=>{launches++;}});
 await controller.receive(encodeProductSessionWalletURL(PRODUCT_SESSION_REGISTRY,s.request,s.at));
 await assert.rejects(f.lifecycle.run(()=>controller.act('approve')),e=>e.code==='SESSION_REFERENCE_RETURN_REQUIRED');
 const store=s.options.transactionSender.submissions.intentStore,original=JSON.parse(await fs.readFile(store.filePath,'utf8')).sessionOriginals[0];
 assert.equal(original.approval.version,'3');assert.equal(original.deliveryAttempted,false);assert.equal(original.cleanupComplete,true);
 assert.equal(signs,1);assert.equal(launches,0);assert.ok(controller.prepared);
 const fresh=sessionQA(f);controller.authority=new DesktopWalletAuthority(fresh.options);
 await assert.rejects(f.lifecycle.run(()=>controller.act('approve')),e=>e.code==='SESSION_REFERENCE_RETURN_REQUIRED');
 assert.equal(signs,1);assert.equal(launches,0);
 const retained=JSON.parse(await fs.readFile(store.filePath,'utf8')).sessionOriginals[0];assert.equal(retained.approval.walletProof,original.approval.walletProof);assert.equal(retained.deliveryAttempted,false);
});
test('normal PQ provider return also refuses oversized inline fallback before its original delivery marker',async t=>{
 const f=await fixture(t);await f.lifecycle.run(()=>f.vault.savePQKeys({handle:f.handle,publicBinding:f.binding,operationId:'QA-session-pair'}));
 const s=sessionQA(f),authority=new DesktopWalletAuthority(s.options);
 await f.lifecycle.run(()=>authority.approveOrigin(s.request.origin,f.account));
 const pending=await f.lifecycle.run(()=>authority.request({origin:s.request.origin,method:'ynx_requestProductSessionV2',params:[encodeProductSessionWalletURL(PRODUCT_SESSION_REGISTRY,s.request,s.at)]}));
 await assert.rejects(f.lifecycle.run(()=>authority.approve(pending.request.id)),e=>e.code==='SESSION_REFERENCE_RETURN_REQUIRED');
 const original=JSON.parse(await fs.readFile(s.options.transactionSender.submissions.intentStore.filePath,'utf8')).sessionOriginals[0];
 assert.equal(original.approval.version,'3');assert.equal(original.deliveryAttempted,false);assert.equal(original.cleanupComplete,true);
});
test('normal committed-policy session caller uses actual registered PQ pair and original verified-cap callback without classic signing',async t=>{
 const f=await fixture(t);await f.lifecycle.run(()=>f.vault.savePQKeys({handle:f.handle,publicBinding:f.binding,operationId:'QA-session-pair'}));const s=sessionQA(f),authority=new DesktopWalletAuthority(s.options);
 let classic=0;f.vault.withSecret=()=>{classic++;assert.fail('active PQ cannot use classic approval');};
 const result=await f.lifecycle.run(()=>authority.approveCanonicalAuthorization(s.request,s.at.toISOString(),f.account));assert.equal(result.approval.version,'3');assert.ok(result.callbackUrl.length>4096);assert.ok(result.callbackUrl.length<=262144);assert.equal(classic,0);assert.equal('verifiedApproval' in result,false);assert.equal('observation' in result,false);
 const independent={...s.resource,assertCurrent(){},readOriginal:()=>s.view},observation=captureProductSessionAccountPolicy(independent,{networkId:CHAIN,account:ynxAddressFromEVM(f.account)},s.at);
 assert.equal(verifyPQProductSessionApproval(PRODUCT_SESSION_REGISTRY,s.request,result.approval,observation,s.at).approval.walletProof,result.approval.walletProof);assert.deepEqual(s.counts,{acquire:1,recheck:2,retire:1,join:1,close:1});
});
test('normal session source failure captures its partial and never enters classic fallback',async t=>{
 const f=await fixture(t),s=sessionQA(f),failure=Object.assign(new Error('QA_SOURCE_REFUSED'),{code:'QA_SOURCE_REFUSED'});Object.defineProperty(failure,'partial',{value:s.resource});let signs=0;f.vault.withSecret=()=>{signs++;};
 const authority=new DesktopWalletAuthority({...s.options,pqSessionSource:async()=>{throw failure;}});await assert.rejects(f.lifecycle.run(()=>authority.approveCanonicalAuthorization(s.request,s.at.toISOString(),f.account)),e=>e===failure);assert.equal(signs,0);assert.equal(s.counts.retire,1);assert.equal(s.counts.join,1);assert.equal(s.counts.close,1);
});
test('normal lawful legacy session requires the same fresh committed source instead of treating the PQ backup as activation',async t=>{
 const f=await fixture(t),s=sessionQA(f,{legacy:true}),authority=new DesktopWalletAuthority(s.options);
 const result=await f.lifecycle.run(()=>authority.approveCanonicalAuthorization(s.request,s.at.toISOString(),f.account));assert.equal(result.approval.version,'2');assert.ok(result.callbackUrl.length<=4096);assert.equal(s.counts.recheck,2);assert.equal(s.counts.close,1);
});
test('original source acquisition reservation prevents overlapping session and transaction resources before either returns',async t=>{
 const f=await fixture(t),s=sessionQA(f);let release,entered;const acquired=new Promise(resolve=>{entered=resolve;});
 const authority=new DesktopWalletAuthority({...s.options,pqSessionSource:async()=>{s.counts.acquire++;entered();await new Promise(resolve=>{release=resolve;});return s.resource;},pqPolicySource:async()=>{assert.fail('must not acquire a second original');},pqPolicyRecognized:()=>true});
 await assert.rejects(f.lifecycle.run(async()=>{
  const first=authority.approveCanonicalAuthorization(s.request,s.at.toISOString(),f.account);await acquired;
  await assert.rejects(authority.approveCanonicalAuthorization(s.request,s.at.toISOString(),f.account),error=>error.data?.code==='PQ_POLICY_RESOURCE_UNRESOLVED');
  await assert.rejects(authority.requestPQTransfer({to:'0x'+'2'.repeat(40),amount:'3'}),error=>error.data?.code==='PQ_POLICY_RESOURCE_UNRESOLVED');
  f.lifecycle.lock();release();await assert.rejects(first);
 }));await authority.shutdownPQReviews();assert.equal(s.counts.acquire,1);assert.equal(s.counts.close,1);
});
test('signed session original survives post-source failure durably and is recovered with fresh policy without another signature',async t=>{
 const f=await fixture(t);await f.lifecycle.run(()=>f.vault.savePQKeys({handle:f.handle,publicBinding:f.binding,operationId:'QA-session-pair'}));const s=sessionQA(f),failure=Object.assign(new Error('QA_POST_SOURCE'),{code:'QA_POST_SOURCE'});s.resource.recheck=async()=>{if(++s.counts.recheck===2)throw failure;};let signs=0;const keys=f.vault.withPQKeys.bind(f.vault);f.vault.withPQKeys=(...args)=>{signs++;return keys(...args);};
 const authority=new DesktopWalletAuthority(s.options);await assert.rejects(f.lifecycle.run(()=>authority.approveCanonicalAuthorization(s.request,s.at.toISOString(),f.account)),error=>error===failure);
 const text=await fs.readFile(path.join(f.directory,'session-journal.json'),'utf8'),state=JSON.parse(text);assert.equal(state.sessionOriginals.length,1);const original=state.sessionOriginals[0];assert.equal(original.approval.version,'3');assert.equal(original.requestDigest,productSessionRequestDigest(PRODUCT_SESSION_REGISTRY,s.request,s.at));assert.equal(original.firstCause.code,'QA_POST_SOURCE');assert.equal(original.deliveryAttempted,false);
 const fresh=sessionQA(f),cold=new DesktopWalletAuthority({...fresh.options,transactionSender:{submissions:{intentStore:new FileTransactionIntentStore({filePath:path.join(f.directory,'session-journal.json')})}}});
 // Preserve the original request, not a new random/renewed request. The new
 // committed observation belongs to the independent cold owner only.
 const recovered=await f.lifecycle.run(()=>cold.approveCanonicalAuthorization(s.request,s.at.toISOString(),f.account));assert.equal(recovered.approval.walletProof,original.approval.walletProof);assert.equal(signs,1);
});
test('session signature capture before lock still completes only its reserved private save, then cold readback uses no keys',async t=>{
 const f=await fixture(t);await f.lifecycle.run(()=>f.vault.savePQKeys({handle:f.handle,publicBinding:f.binding,operationId:'QA-session-pair'}));const s=sessionQA(f),store=s.options.transactionSender.submissions.intentStore,capture=store.captureSessionOriginal.bind(store);let captures=0;
 store.captureSessionOriginal=(...args)=>{capture(...args);captures++;f.lifecycle.lock();};const authority=new DesktopWalletAuthority(s.options);
 await assert.rejects(f.lifecycle.run(()=>authority.approveCanonicalAuthorization(s.request,s.at.toISOString(),f.account)));
 const state=JSON.parse(await fs.readFile(store.filePath,'utf8')),original=state.sessionOriginals[0];assert.equal(original.approval.version,'3');assert.equal(original.firstCause.kind,'error');assert.equal(f.lifecycle.status().locked,true);assert.equal(captures,1);
 await f.lifecycle.unlock({password:PASSWORD});const fresh=sessionQA(f),cold=new DesktopWalletAuthority(fresh.options);f.vault.withPQKeys=()=>assert.fail('read-only recovery cannot acquire keys');
 const result=await f.lifecycle.run(()=>cold.reconcileCanonicalAuthorization(s.request,f.account));assert.equal(result.approval.walletProof,original.approval.walletProof);assert.equal(captures,1);
});
test('falsy cleanup failure is persisted separately and blocks replacement acquisition without erasing the signature',async t=>{
 const f=await fixture(t);await f.lifecycle.run(()=>f.vault.savePQKeys({handle:f.handle,publicBinding:f.binding,operationId:'QA-session-pair'}));const s=sessionQA(f),authority=new DesktopWalletAuthority(s.options);s.resource.join=async()=>{s.counts.join++;throw false;};
 await assert.rejects(f.lifecycle.run(()=>authority.approveCanonicalAuthorization(s.request,s.at.toISOString(),f.account)),error=>error===false);
 const [original]=JSON.parse(await fs.readFile(s.options.transactionSender.submissions.intentStore.filePath,'utf8')).sessionOriginals;assert.ok(original.approval.walletProof);assert.deepEqual(original.firstCause,{kind:'boolean',value:false,code:null});assert.deepEqual(original.cleanupCause,original.firstCause);assert.equal(s.counts.close,0);
 await assert.rejects(f.lifecycle.run(()=>authority.approveCanonicalAuthorization(s.request,s.at.toISOString(),f.account)),error=>error.data?.code==='PQ_POLICY_RESOURCE_UNRESOLVED');assert.equal(s.counts.acquire,1);
 const fresh=sessionQA(f),cold=new DesktopWalletAuthority(fresh.options);await assert.rejects(f.lifecycle.run(()=>cold.reconcileCanonicalAuthorization(s.request,f.account)),error=>error.data?.code==='SESSION_ORIGINAL_CLEANUP_UNKNOWN');assert.equal(fresh.counts.acquire,0);
});
test('reservation lost ACK leaves UNKNOWN across restart and never authorizes a new session signature',async t=>{
 const f=await fixture(t),s=sessionQA(f),store=s.options.transactionSender.submissions.intentStore,reserve=store.reserveSessionOriginal.bind(store);let keys=0;f.vault.withPQKeys=()=>{keys++;};
 store.reserveSessionOriginal=async(...args)=>{await reserve(...args);throw Object.assign(Error('QA_RESERVE_ACK'),{code:'QA_RESERVE_ACK'});};const authority=new DesktopWalletAuthority(s.options);
 await assert.rejects(f.lifecycle.run(()=>authority.approveCanonicalAuthorization(s.request,s.at.toISOString(),f.account)),error=>error.code==='QA_RESERVE_ACK');assert.equal(keys,0);
 const fresh=sessionQA(f),cold=new DesktopWalletAuthority(fresh.options);await assert.rejects(f.lifecycle.run(()=>cold.approveCanonicalAuthorization(s.request,s.at.toISOString(),f.account)),error=>error.data?.code==='SESSION_APPROVAL_RESULT_UNKNOWN');assert.equal(keys,0);assert.equal(fresh.counts.acquire,0);
});
test('original Controller retries only fresh-policy readback of its original signed result after pre-prepared failure',async t=>{
 const f=await fixture(t);await f.lifecycle.run(()=>f.vault.savePQKeys({handle:f.handle,publicBinding:f.binding,operationId:'QA-session-pair'}));const s=sessionQA(f);s.resource.recheck=async()=>{if(++s.counts.recheck===2)throw Object.assign(Error('QA_POST_SOURCE'),{code:'QA_POST_SOURCE'});};let signs=0,launches=0;const keys=f.vault.withPQKeys.bind(f.vault);f.vault.withPQKeys=(...args)=>{signs++;return keys(...args);};
 const controller=new DesktopAuthorizationController({authority:new DesktopWalletAuthority(s.options),clock:()=>s.at,requestId:()=> 'QA-original-controller-id',openExternal:async()=>{launches++;}});
 await controller.receive(encodeProductSessionWalletURL(PRODUCT_SESSION_REGISTRY,s.request,s.at));await assert.rejects(f.lifecycle.run(()=>controller.act('approve')));assert.equal(controller.prepared,null);assert.equal(launches,0);
 const original=JSON.parse(await fs.readFile(s.options.transactionSender.submissions.intentStore.filePath,'utf8')).sessionOriginals[0];assert.equal(original.requestId,'QA-original-controller-id');
 const fresh=sessionQA(f);controller.authority=new DesktopWalletAuthority(fresh.options);await assert.rejects(f.lifecycle.run(()=>controller.act('approve')),e=>e.code==='SESSION_REFERENCE_RETURN_REQUIRED');assert.equal(controller.prepared.originalRequestId,original.requestId);assert.equal(signs,1);assert.equal(launches,0);
});
test('signed session save lost ACK reconciles exact original on cold read without another save or signature',async t=>{
 const f=await fixture(t);await f.lifecycle.run(()=>f.vault.savePQKeys({handle:f.handle,publicBinding:f.binding,operationId:'QA-session-pair'}));const s=sessionQA(f),store=s.options.transactionSender.submissions.intentStore,replace=store.filePolicy.replace.bind(store.filePolicy),save=store.saveSessionOriginal.bind(store);let lost=false,saves=0,signs=0;const keys=f.vault.withPQKeys.bind(f.vault);f.vault.withPQKeys=(...args)=>{signs++;return keys(...args);};store.saveSessionOriginal=(...args)=>{saves++;return save(...args);};
 store.filePolicy.replace=async(...args)=>{const next=JSON.parse(await fs.readFile(args[0],'utf8'));await replace(...args);if(!lost&&next.sessionOriginals?.[0]?.approval&&!next.sessionOriginals[0].cleanupComplete){lost=true;throw Object.assign(Error('QA_SIGNED_ACK_LOST'),{code:'QA_SIGNED_ACK_LOST'});}};
 const authority=new DesktopWalletAuthority(s.options);await assert.rejects(f.lifecycle.run(()=>authority.approveCanonicalAuthorization(s.request,s.at.toISOString(),f.account)));
 const [original]=JSON.parse(await fs.readFile(store.filePath,'utf8')).sessionOriginals;assert.equal(original.approval.version,'3');assert.ok(original.storageCause);assert.equal(original.cleanupComplete,true);assert.equal(lost,true);
 const fresh=sessionQA(f),cold=new DesktopWalletAuthority(fresh.options);const recovered=await f.lifecycle.run(()=>cold.reconcileCanonicalAuthorization(s.request,f.account));assert.equal(recovered.approval.walletProof,original.approval.walletProof);assert.equal(saves,1);assert.equal(signs,1);assert.equal((await fs.stat(store.filePath)).mode&0o077,0);
});
test('session first source error and separate falsy cleanup error both survive without a misleading clean result',async t=>{
 const f=await fixture(t);await f.lifecycle.run(()=>f.vault.savePQKeys({handle:f.handle,publicBinding:f.binding,operationId:'QA-session-pair'}));const s=sessionQA(f),first=Object.assign(Error('QA_FIRST_SOURCE'),{code:'QA_FIRST_SOURCE'});s.resource.recheck=async()=>{if(++s.counts.recheck===2)throw first;};s.resource.join=async()=>{throw false;};
 const authority=new DesktopWalletAuthority(s.options);await assert.rejects(f.lifecycle.run(()=>authority.approveCanonicalAuthorization(s.request,s.at.toISOString(),f.account)),error=>error===first);
 const [original]=JSON.parse(await fs.readFile(s.options.transactionSender.submissions.intentStore.filePath,'utf8')).sessionOriginals;assert.equal(original.firstCause.code,'QA_FIRST_SOURCE');assert.deepEqual(original.cleanupCause,{kind:'boolean',value:false,code:null});assert.equal(original.cleanupComplete,false);assert.ok(original.approval.walletProof);
});
test('unknown callback delivery never becomes an automatic second launch or replacement signature',async t=>{
 const f=await fixture(t),s=sessionQA(f,{legacy:true});let signs=0,launches=0;const keys=f.vault.withSecret.bind(f.vault);f.vault.withSecret=(...args)=>{signs++;return keys(...args);};
 const controller=new DesktopAuthorizationController({authority:new DesktopWalletAuthority(s.options),clock:()=>s.at,openExternal:async()=>{launches++;throw Error('QA_EXTERNAL_UNKNOWN');}});await controller.receive(encodeProductSessionWalletURL(PRODUCT_SESSION_REGISTRY,s.request,s.at));await assert.rejects(f.lifecycle.run(()=>controller.act('approve')));
 const [original]=JSON.parse(await fs.readFile(s.options.transactionSender.submissions.intentStore.filePath,'utf8')).sessionOriginals;assert.equal(original.deliveryAttempted,true);
 await assert.rejects(f.lifecycle.run(()=>controller.act('approve')),error=>error.data?.code==='SESSION_CALLBACK_DELIVERY_UNKNOWN');assert.equal(signs,1);assert.equal(launches,1);
});
test('session successor journal preserves existing typed transfer ownership and never downgrades schema or loses either original',async t=>{
 const f=await fixture(t);await f.lifecycle.run(()=>f.vault.savePQKeys({handle:f.handle,publicBinding:f.binding,operationId:'QA-session-pair'}));const s=sessionQA(f),store=s.options.transactionSender.submissions.intentStore,authority=new DesktopWalletAuthority(s.options);
 const approval=await f.lifecycle.run(()=>authority.approveCanonicalAuthorization(s.request,s.at.toISOString(),f.account));
 const {snapshot,transfer}=syntheticTransfer(f);await store.reserveOriginal(f.account,'pq-transfer');const original=createPQOriginalRecord({account:f.account,kind:'pq-transfer',operationId:'QA-schema7-transfer',request:SDK.signPQWalletNativeTransfer(f.handle,transfer,snapshot)});store.captureOriginal(f.account,original,'pq-transfer');await store.saveOriginal(f.account,original.hash,()=>{});
 const state=JSON.parse(await fs.readFile(store.filePath,'utf8'));assert.equal(state.schemaVersion,7);assert.equal(state.pqOriginals[0].hash,original.hash);assert.equal(state.sessionOriginals[0].approval.walletProof,approval.approval.walletProof);assert.equal((await new FileTransactionIntentStore({filePath:store.filePath}).readPQOriginals(f.account,()=>{}))[0].hash,original.hash);
});
test('corrupted saved session proof is rejected by fresh source and actual SDK verification without acquiring signing keys',async t=>{
 const f=await fixture(t);await f.lifecycle.run(()=>f.vault.savePQKeys({handle:f.handle,publicBinding:f.binding,operationId:'QA-session-pair'}));const s=sessionQA(f),authority=new DesktopWalletAuthority(s.options),store=s.options.transactionSender.submissions.intentStore;
 await f.lifecycle.run(()=>authority.approveCanonicalAuthorization(s.request,s.at.toISOString(),f.account));const state=JSON.parse(await fs.readFile(store.filePath,'utf8')),proof=state.sessionOriginals[0].approval.walletProof;state.sessionOriginals[0].approval.walletProof=proof.slice(0,-2)+(proof.endsWith('AA')?'BB':'AA');await fs.writeFile(store.filePath,JSON.stringify(state));
 const fresh=sessionQA(f),cold=new DesktopWalletAuthority(fresh.options);f.vault.withPQKeys=()=>assert.fail('corrupt stored proof cannot trigger replacement signing');await assert.rejects(f.lifecycle.run(()=>cold.reconcileCanonicalAuthorization(s.request,f.account)));assert.equal(fresh.counts.close,1);
});
test('lock during successful source close records the late cause without discarding the durable signed result',async t=>{
 const f=await fixture(t);await f.lifecycle.run(()=>f.vault.savePQKeys({handle:f.handle,publicBinding:f.binding,operationId:'QA-session-pair'}));const s=sessionQA(f);s.resource.close=async()=>{s.counts.close++;f.lifecycle.lock();};const authority=new DesktopWalletAuthority(s.options);
 await assert.rejects(f.lifecycle.run(()=>authority.approveCanonicalAuthorization(s.request,s.at.toISOString(),f.account)));
 const [original]=JSON.parse(await fs.readFile(s.options.transactionSender.submissions.intentStore.filePath,'utf8')).sessionOriginals;assert.ok(original.approval.walletProof);assert.equal(original.cleanupComplete,true);assert.equal(original.firstCause.code,'WALLET_OPERATION_CANCELLED');
 const summary=await authority.canonicalAuthorizationStatus(s.request,f.account);assert.equal(summary.status,'signed-retained');assert.equal(summary.storageConfirmed,true);assert.equal('approval' in summary,false);assert.equal('callbackUrl' in summary,false);
 const main=await fs.readFile(new URL('../src/main.mjs',import.meta.url),'utf8'),start=main.indexOf('async function authorizationFailure('),end=main.indexOf('\nhandleWalletIPC("wallet:account-status"',start),context={walletAuthority:authority,authorizationController:{pending:{request:s.request,account:f.account}},safeCode:()=> 'WALLET_OPERATION_CANCELLED',safeErrorClass:()=> 'Error',safeFailureCategory:()=> 'operation',mainWindow:null,lastCallback:null};runInNewContext(main.slice(start,end),context);
 const displayed=await context.authorizationFailure('CANONICAL_AUTHORIZATION_SIGN_FAILED','approve',Error('QA_LOCK'));assert.equal(displayed.sessionOriginal.status,'signed-retained');assert.equal(displayed.callbackEmitted,false);assert.equal(displayed.productSessionCreated,false);assert.equal(JSON.stringify(displayed).includes(original.approval.walletProof),false);
});
test('session cause summaries preserve falsy causes without copying diagnostic payloads into storage or UI',()=>{
 for(const value of [false,null,undefined,0,'']){const summary=sessionOriginalCause(value);assert.equal(summary.kind,typeof value);assert.equal(summary.value,value===undefined?null:value);}
 const error=Object.assign(Error('PRIVATE_DIAGNOSTIC_DO_NOT_COPY'),{data:{code:'QA_SOURCE_FAILURE'}});assert.deepEqual(sessionOriginalCause(error),{kind:'error',value:null,code:'QA_SOURCE_FAILURE'});assert.equal(JSON.stringify(sessionOriginalCause(error)).includes('PRIVATE_DIAGNOSTIC'),false);
});
