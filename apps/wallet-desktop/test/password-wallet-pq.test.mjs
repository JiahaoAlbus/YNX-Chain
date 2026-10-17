import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {DesktopKeyLifecycle} from '../src/key-lifecycle.mjs';
import {PasswordWalletVault} from '../src/password-wallet-vault.mjs';
import {createDualPQKeyPreparation} from '../src/wallet-pq-key-preparation.mjs';
import {createPQKeyPreparationSource} from '../src/wallet-pq-key-source.mjs';
import {parsePasswordVault,unlockPasswordVault,closePasswordVaultSession,decryptPasswordVaultRecord,rewritePasswordVault,decryptPasswordVaultPQRecord} from '../src/password-vault-crypto.mjs';
import * as keySDK from '../../../packages/wallet-auth/src/pq-wallet-key-backup.js';
import * as backupSDK from '../../../packages/wallet-auth/src/pq-wallet-backup.js';
import * as contractSDK from '../../../packages/wallet-auth/src/pq-wallet-contract.js';
const SDK=Object.freeze({...keySDK,...backupSDK,...contractSDK}),PASSWORD='isolated-PQ-app-fixture-password',SECRET='1'.padStart(64,'0'),CHAIN='a'.repeat(64);
async function fixture(t){
 const directory=await fs.mkdtemp(path.join(tmpdir(),'ynx-app-pq-vault-')),filePath=path.join(directory,'wallet-vault-v3.json');
 const lifecycle=new DesktopKeyLifecycle();lifecycle.setFocused(true);
 const vault=new PasswordWalletVault({filePath,authorization:lifecycle,pqSDK:SDK,randomSecret:()=>SECRET});lifecycle.authorizer=vault.authorizer();
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
