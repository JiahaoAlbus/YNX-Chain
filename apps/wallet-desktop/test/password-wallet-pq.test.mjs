import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {webcrypto} from 'node:crypto';
import {canonicalJSON} from '../../../packages/wallet-auth/src/canonical.js';
import {DesktopKeyLifecycle} from '../src/key-lifecycle.mjs';
import {PasswordWalletVault} from '../src/password-wallet-vault.mjs';
import {createDualPQKeyPreparation} from '../src/wallet-pq-key-preparation.mjs';
import {createPQKeyPreparationSource} from '../src/wallet-pq-key-source.mjs';
import {parsePasswordVault,unlockPasswordVault,closePasswordVaultSession,decryptPasswordVaultRecord,rewritePasswordVault,decryptPasswordVaultPQRecord} from '../src/password-vault-crypto.mjs';
import * as keySDK from '../../../packages/wallet-auth/src/pq-wallet-key-backup.js';
import * as backupSDK from '../../../packages/wallet-auth/src/pq-wallet-backup.js';
import * as contractSDK from '../../../packages/wallet-auth/src/pq-wallet-contract.js';
import {pqPublicBindingToRegistrationKeys,decodePQTransferRequest} from '@ynx-chain/wallet-auth/pq-wallet-authorization';
import {parsePQAccountAuthorization} from '@ynx-chain/wallet-auth/pq-wallet-policy';
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
