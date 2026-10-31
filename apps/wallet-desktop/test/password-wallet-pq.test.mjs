import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {webcrypto,createECDH} from 'node:crypto';
import {canonicalJSON} from '../../../packages/wallet-auth/src/canonical.js';
import {DesktopKeyLifecycle} from '../src/key-lifecycle.mjs';
import {PasswordWalletVault,isOriginalSelectedPQAccountPublicLease} from '../src/password-wallet-vault.mjs';
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
import {createPQTransferPreview} from '../src/wallet-pq-transfer-preview.mjs';
import {createOriginalNativePQCustody} from '../src/wallet-pq-native-custody.mjs';
import {encodeObservedPolicyOriginal} from '../src/original-policy-supplier/operator-policy-original.mjs';
import {captureCometPolicyObservation} from '../src/original-policy-supplier/comet-projection.mjs';
import {sessionOriginalCause} from '../src/wallet-session-original.mjs';
import {createPQTransferReviewUI} from '../src/wallet-pq-transfer-ui.mjs';
import {createPQMigrationReviewUI} from '../src/wallet-pq-migration-ui.mjs';
import {runInNewContext} from 'node:vm';
import {registerHooks,createRequire} from 'node:module';
import {createPublicWalletEvent} from './public-transaction-electron-fixture.mjs';
// Test worker only: real Auth factory, explicit PUBLIC Electron peer model.
registerHooks({resolve(specifier,context,next){return next(specifier==='electron'?new URL('./public-transaction-electron-fixture.mjs',import.meta.url).href:specifier,context);}});
const transactionAuth=await import('../src/original-policy-supplier/transaction-permission.mjs');
const device=await import('../src/original-policy-supplier/device-create-approval.mjs');
const deviceReview=await import('../src/original-policy-supplier/device-create-review.mjs');
import {createOriginalDeviceCreateIntentDATA} from '@ynx-chain/wallet-auth/original-device-create-intent';
import {productPlatformBinding} from '../../../packages/wallet-auth/src/product-session-registry.js';
import {formatApprovalReview} from '../src/approval-review-display.mjs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createProductSessionRequest,encodeProductSessionWalletURL,ynxAddressFromEVM,productSessionRequestDigest,productSessionApprovalDigest} from '@ynx-chain/wallet-auth';
import {DesktopAuthorizationController} from '../src/callback-policy.mjs';
import {PRODUCT_SESSION_REGISTRY} from '../src/wallet-auth-contract.mjs';
import {captureProductSessionAccountPolicy} from '@ynx-chain/wallet-auth/product-session-account-policy';
import {verifyPQProductSessionApproval} from '@ynx-chain/wallet-auth/product-session-pq-approval';
import {createProductWalletReturnPublisher} from '@ynx-chain/wallet-auth/product-wallet-connection';
const SDK=Object.freeze({...keySDK,...backupSDK,...contractSDK}),PASSWORD='isolated-PQ-app-fixture-password',SECRET='1'.padStart(64,'0'),CHAIN='a'.repeat(64);
test('App production PQ entry composes real SDK and encrypted SAME Vault without replacing classic accounts',async t=>{
 const {createPQKeyPreparationEntry}=await import('../src/wallet-pq-key-entry.mjs');
 const f=await fixture(t),before=parsePasswordVault(f.original);
 const entry=createPQKeyPreparationEntry({lifecycle:f.lifecycle,vault:f.vault,sdk:SDK,networkId:CHAIN,id:()=> 'TEST-production-entry'});
 assert.equal((await entry.generate()).persisted,true);
 const after=parsePasswordVault(await fs.readFile(f.filePath,'utf8'));
 assert.deepEqual(after.records,before.records);assert.deepEqual(after.accounts,before.accounts);
 assert.equal(after.activeAccount,before.activeAccount);assert.equal(after.pqKeyRecords[0].operationId,'TEST-production-entry');
 f.lifecycle.lock();assert.equal(entry.status().persisted,true);assert.equal(entry.status().keyRetired,true);
 await f.lifecycle.unlock({password:PASSWORD});
 const reopened=createPQKeyPreparationEntry({lifecycle:f.lifecycle,vault:f.vault,sdk:SDK,networkId:CHAIN,id:()=> 'TEST-replacement'});
 const original=await fs.readFile(f.filePath,'utf8');await assert.rejects(reopened.generate());
 assert.equal(reopened.status().preparationUnknown,false);
 assert.equal(await fs.readFile(f.filePath,'utf8'),original);
});
test('App production PQ entry reads saved original after a new controller, without generation or a write',async t=>{
 const {createPQKeyPreparationEntry}=await import('../src/wallet-pq-key-entry.mjs'),f=await fixture(t);
 const entry=createPQKeyPreparationEntry({lifecycle:f.lifecycle,vault:f.vault,sdk:SDK,networkId:CHAIN,id:()=> 'TEST-reopen-original'});
 await entry.generate();f.lifecycle.lock();await f.lifecycle.unlock({password:PASSWORD});
 const original=await fs.readFile(f.filePath,'utf8'),reopened=createPQKeyPreparationEntry({lifecycle:f.lifecycle,vault:f.vault,sdk:SDK,networkId:CHAIN,id:()=> 'TEST-never-enter'});
 assert.equal((await reopened.recover()).persisted,true);
 assert.equal(reopened.status().persisted,true);await assert.rejects(reopened.generate());assert.equal(reopened.status().persisted,true);
 assert.equal(await fs.readFile(f.filePath,'utf8'),original);
});
test('App production PQ entered failure survives controller restart and cannot regenerate',async t=>{
 const {createPQKeyPreparationEntry}=await import('../src/wallet-pq-key-entry.mjs'),f=await fixture(t);
 let generations=0;
 const failingSDK={...SDK,createPQWalletKeyHandle:async()=>{generations++;throw false;}};
 const entry=createPQKeyPreparationEntry({lifecycle:f.lifecycle,vault:f.vault,sdk:failingSDK,networkId:CHAIN,id:()=> 'TEST-uncertain-original'});
 await assert.rejects(entry.generate());f.lifecycle.lock();await f.lifecycle.unlock({password:PASSWORD});
 const reopened=createPQKeyPreparationEntry({lifecycle:f.lifecycle,vault:f.vault,sdk:failingSDK,networkId:CHAIN,id:()=> 'TEST-forbidden-replacement'});
 assert.equal((await reopened.recover()).preparationUnknown,true);
 assert.equal(reopened.status().preparationUnknown,true);
 await assert.rejects(reopened.generate());assert.equal(generations,1);
});
test('App PQ reservation and saved results survive actual fresh processes without replacement generation',async t=>{
 const {createPQKeyPreparationEntry}=await import('../src/wallet-pq-key-entry.mjs');
 for(const uncertain of [true,false]){
  const f=await fixture(t),sdk=uncertain?{...SDK,createPQWalletKeyHandle:async()=>{throw false;}}:SDK;
  const entry=createPQKeyPreparationEntry({lifecycle:f.lifecycle,vault:f.vault,sdk,networkId:CHAIN,id:()=> uncertain?'TEST-cold-unknown':'TEST-cold-saved'});
  if(uncertain)await assert.rejects(entry.generate());else await entry.generate();
  f.lifecycle.lock();const before=await fs.readFile(f.filePath,'utf8');
  const result=spawnSync(process.execPath,[fileURLToPath(new URL('./pq-preparation-reopen-worker.mjs',import.meta.url))],{input:JSON.stringify({filePath:f.filePath,password:PASSWORD,networkId:CHAIN,attemptGeneration:true}),encoding:'utf8',timeout:15000,maxBuffer:16384});
  assert.equal(result.error,undefined);assert.equal(result.status,0,result.stdout+result.stderr);const output=JSON.parse(result.stdout);
  assert.notEqual(output.pid,process.pid);assert.equal(output.state.preparationUnknown,uncertain);assert.equal(output.state.persisted,!uncertain);
  assert.equal(output.generations,0);assert.equal(output.refused,true);assert.equal(await fs.readFile(f.filePath,'utf8'),before);
 }
});
test('App PQ durable preparation metadata is authenticated and cannot be substituted or removed',async t=>{
 const {createPQKeyPreparationEntry}=await import('../src/wallet-pq-key-entry.mjs'),f=await fixture(t);
 const entry=createPQKeyPreparationEntry({lifecycle:f.lifecycle,vault:f.vault,sdk:{...SDK,createPQWalletKeyHandle:async()=>{throw false;}},networkId:CHAIN,id:()=> 'TEST-bound-original'});
 await assert.rejects(entry.generate());const original=JSON.parse(await fs.readFile(f.filePath,'utf8'));
 for(const alter of [v=>delete v.pqPreparationReservations,v=>v.pqPreparationReservations[0].networkId='b'.repeat(64),v=>v.pqPreparationReservations[0].operationId='TEST-substitute']){
  const changed=structuredClone(original);alter(changed);await assert.rejects(unlockPasswordVault(changed,PASSWORD));
 }
 assert.equal(await fs.readFile(f.filePath,'utf8'),JSON.stringify(original)+'\n');
});
test('App PQ reservation lost acknowledgement prevents SDK entry and preserves durable UNKNOWN',async t=>{
 const {createPQKeyPreparationEntry}=await import('../src/wallet-pq-key-entry.mjs'),f=await fixture(t);
 let generations=0;const publish=f.vault.files.publish.bind(f.vault.files);
 f.vault.files.publish=async(...args)=>{await publish(...args);throw Error('TEST_ONLY_LOST_RESERVATION_ACK');};
 const entry=createPQKeyPreparationEntry({lifecycle:f.lifecycle,vault:f.vault,sdk:{...SDK,createPQWalletKeyHandle:async()=>{generations++;throw Error('MUST_NOT_ENTER');}},networkId:CHAIN,id:()=> 'TEST-reserve-ack-unknown'});
 await assert.rejects(entry.generate());assert.equal(generations,0);
 const preserved=await fs.readFile(f.filePath,'utf8');assert.equal(parsePasswordVault(preserved).pqKeyRecords,undefined);
 f.vault.files.publish=publish;await f.lifecycle.unlock({password:PASSWORD});assert.equal((await entry.recover()).preparationUnknown,true);
 await assert.rejects(entry.generate());assert.equal(generations,0);assert.equal(await fs.readFile(f.filePath,'utf8'),preserved);
});
test('App PQ uncertain preparation cannot be discarded by classic password reset',async t=>{
 const {createPQKeyPreparationEntry}=await import('../src/wallet-pq-key-entry.mjs'),f=await fixture(t);
 const entry=createPQKeyPreparationEntry({lifecycle:f.lifecycle,vault:f.vault,sdk:{...SDK,createPQWalletKeyHandle:async()=>{throw false;}},networkId:CHAIN,id:()=> 'TEST-reset-unknown'});
 await assert.rejects(entry.generate());f.lifecycle.lock();const before=await fs.readFile(f.filePath,'utf8');
 await assert.rejects(f.lifecycle.custody(guard=>f.vault.prepareRecovery({account:f.account,kind:'private-key',value:SECRET,resetPassword:true,newPassword:'new isolated PQ password',confirmation:'new isolated PQ password'},guard)),e=>e?.data?.code==='PQ_INDEPENDENT_BACKUP_REQUIRED');
 assert.equal(await fs.readFile(f.filePath,'utf8'),before);
});
test('App normal PQ export is a standalone SDK backup restored in a fresh process without the original Vault',async t=>{
 const {createPQKeyPreparationEntry}=await import('../src/wallet-pq-key-entry.mjs'),{createPQBackupActions}=await import('../src/pq-backup-actions.mjs'),{PQBackupFile}=await import('../src/pq-backup-file.mjs'),f=await fixture(t);
 const preparation=createPQKeyPreparationEntry({lifecycle:f.lifecycle,vault:f.vault,sdk:SDK,networkId:CHAIN,id:()=> 'TEST-portable-original'});await preparation.generate();
 const expectedBinding=await f.lifecycle.run(()=>f.vault.readPQProposalBinding(CHAIN)),filePath=path.join(f.directory,'portable.ynxpq'),before=await fs.readFile(f.filePath,'utf8');
 const backup=createPQBackupActions({lifecycle:f.lifecycle,vault:f.vault,sdk:SDK,networkId:CHAIN,files:new PQBackupFile(),chooseExportFile:async()=>filePath,chooseVerifyFile:async()=>filePath});
 const exported=await backup.export();assert.equal(exported.verified,true);assert.equal(exported.walletChanged,false);assert.equal(await fs.readFile(f.filePath,'utf8'),before);
 const file=await fs.readFile(filePath);assert.equal(file.includes(exported.credential),false);assert.equal(JSON.parse(file).format,'YNX-PQ-WALLET-BACKUP/v1');
 const child=spawnSync(process.execPath,[fileURLToPath(new URL('./pq-portable-backup-worker.mjs',import.meta.url))],{input:JSON.stringify({filePath,credential:exported.credential,expectedBinding}),encoding:'utf8',timeout:15000,maxBuffer:16384});
 assert.equal(child.error,undefined);assert.equal(child.status,0,child.stdout+child.stderr);const recovered=JSON.parse(child.stdout);
 assert.notEqual(recovered.pid,process.pid);assert.deepEqual(recovered.binding,expectedBinding);assert.equal(recovered.walletAdopted,false);assert.equal(recovered.signed,false);assert.equal(recovered.broadcast,false);
 await assert.rejects(SDK.restorePQWalletKeyHandle(new Uint8Array(file),SDK.createPQRecoveryCredential(),expectedBinding));
 await assert.rejects(SDK.restorePQWalletKeyHandle(new Uint8Array(file),exported.credential,{...expectedBinding,owner:'0x'+'f'.repeat(40)}));
 const verified=await backup.verify();assert.equal(verified.verified,true);assert.equal(verified.credential,exported.credential);assert.deepEqual(await fs.readFile(filePath),file);assert.equal(await fs.readFile(f.filePath,'utf8'),before);
 // Export cannot clobber this existing file or replace the independent pair.
 await assert.rejects(backup.export());assert.deepEqual(await fs.readFile(filePath),file);assert.equal(await fs.readFile(f.filePath,'utf8'),before);
});
test('App normal registered restore uses original R54 factory and real SDK into SAME isolated Vault without replacing accounts',async t=>{
 const {createRegisteredPQRestore}=await import('../src/wallet-pq-registered-restore.mjs'),{PQBackupFile}=await import('../src/pq-backup-file.mjs');
 const https=(await import('node:https')).default,{EventEmitter}=await import('node:events'),{syncBuiltinESMExports}=await import('node:module');
 const f=await fixture(t),networkId='16366ff25bcc73c6bb95d12733be74d1ac885d3daf518ddd0e4bd4438cff243f';
 const originalRequest=https.request;let sourceKind='authoritative_producer',calls=[];
 t.after(()=>{https.request=originalRequest;syncBuiltinESMExports();});
 const key=await SDK.createPQWalletKeyHandle({chainId:networkId,owner:f.account}),binding=SDK.readPQWalletKeyPublic(key),credential=SDK.createPQRecoveryCredential();let wire;
 try{wire=await SDK.exportPQWalletBackup(key,credential);}finally{SDK.destroyPQWalletKeyHandle(key);}
 const file=path.join(f.directory,'registered-original.ynxpq');await new PQBackupFile().write(file,wire,{assert(){}});
 const registered=pqPublicBindingToRegistrationKeys(binding),rpc=()=>({owner:f.account,executionHeight:'25',ledgerNonce:'1',algorithmVersion:'YNX-BATCH/v0.1',enabled:true,policyVersion:'YNX-ACCOUNT-POLICY/v1',networkId,enableAt:'10',activeRevision:'1',records:[{algorithmVersion:'YNX-BATCH/v0.1',owner:f.account,pkA:registered.pkA,pkB:registered.pkB,revision:'1',registeredAt:'10',activeFrom:'20',ledgerNonce:'1'}],policyView:'next_execution',recordsView:'includes_pending',source:sourceKind,committedHeight:'24',committedBlockHash:'a'.repeat(64),committedAlgorithmVersion:'YNX-BATCH/v0.1',committedActiveRevision:'1',checkpointStatus:'durable',checkpointIntegrity:'b'.repeat(64),recordsComplete:true});
 // PUBLIC HTTP/TLS boundary instrumentation, not a live node, source grant,
 // test-kernel brand or authority fixture injected into the production caller.
 https.request=(url,options,callback)=>{
  assert.equal(url.origin,'https://rpc.ynxweb4.com');assert.equal(options.method,'GET');assert.equal(options.rejectUnauthorized,true);assert.equal(typeof options.checkServerIdentity,'function');calls.push(url.pathname);
  const request=new EventEmitter();request.destroy=()=>{};request.end=()=>queueMicrotask(()=>{const response=new EventEmitter();response.destroy=()=>{};response.statusCode=200;response.headers={'content-type':'application/json','cache-control':'no-store'};const body=url.pathname==='/status'?{chainId:6423,catchingUp:false,persistence:true,persistenceError:'',build:{commit:'65efa82e0615',release:'ynx-network-surgical-65efa82e0615'}}:url.pathname==='/blocks/0'?{height:0,hash:networkId}:rpc();callback(response);response.emit('data',Buffer.from(JSON.stringify(body)));response.emit('end');});return request;
 };syncBuiltinESMExports();
 const {acquireOriginalWalletRegisteredBinding:acquire,isOriginalWalletRegisteredBinding:isOriginal}=await import('../src/original-policy-supplier/registered-binding-resource.mjs');
 const actions=createRegisteredPQRestore({lifecycle:f.lifecycle,vault:f.vault,sdk:SDK,networkId,id:()=> 'TEST-normal-registered-restore',acquire,isOriginal,files:new PQBackupFile(),chooseFile:async()=>file});
 const saved=await actions.restore({credential});assert.equal(saved.persisted,true);assert.equal(saved.sourceClosed,true);assert.equal(saved.signingAuthorized,false);assert.equal(saved.transactionAuthorized,false);
 assert.deepEqual(calls,['/status','/blocks/0','/accounts/'+f.account+'/authorization','/status','/status','/blocks/0','/accounts/'+f.account+'/authorization','/status']);
 const before=parsePasswordVault(f.original),afterText=await fs.readFile(f.filePath,'utf8'),after=parsePasswordVault(afterText);
 assert.deepEqual(after.accounts,before.accounts);assert.deepEqual(after.records,before.records);assert.deepEqual(after.passwordWrap,before.passwordWrap);assert.equal(after.activeAccount,before.activeAccount);assert.equal(after.pqPreparationReservations[0].kind,'restore');
 await f.lifecycle.run(()=>f.vault.withPQBackup(networkId,(payload)=>{assert.deepEqual(payload.wire,Buffer.from(wire));assert.equal(payload.credential,credential);return true;}));
 assert.deepEqual(new Uint8Array(await fs.readFile(file)),wire);await assert.rejects(actions.restore({credential}));assert.equal(await fs.readFile(f.filePath,'utf8'),afterText);
 // Normal original source refusal: no backup metadata fallback or reservation.
 const refused=await fixture(t),refusedBefore=await fs.readFile(refused.filePath,'utf8');sourceKind='comet-rpc';
 const declined=createRegisteredPQRestore({lifecycle:refused.lifecycle,vault:refused.vault,sdk:SDK,networkId,id:()=> 'TEST-refused-source',acquire,isOriginal,files:new PQBackupFile(),chooseFile:async()=>file});
 await assert.rejects(declined.restore({credential}));assert.equal(await fs.readFile(refused.filePath,'utf8'),refusedBefore);declined.selectOriginalOutcome(r=>{assert(r.resource);assert.equal(r.closed,true);assert.equal(r.firstCause.code,'AUTH_POLICY_QUERY_UNHEALTHY');});
 // An incorrect credential is known input refusal BEFORE durable import.
 const wrong=await fixture(t),wrongBefore=await fs.readFile(wrong.filePath,'utf8');sourceKind='authoritative_producer';
 const corrected=createRegisteredPQRestore({lifecycle:wrong.lifecycle,vault:wrong.vault,sdk:SDK,networkId,id:()=> 'TEST-corrected-credential',acquire,isOriginal,files:new PQBackupFile(),chooseFile:async()=>file});
 await assert.rejects(corrected.restore({credential:SDK.createPQRecoveryCredential()}));assert.equal(await fs.readFile(wrong.filePath,'utf8'),wrongBefore);assert.equal((await corrected.restore({credential})).persisted,true);
 wire.fill(0);
});
async function fixture(t,pqSDK=SDK,nativePQCustody){
 const directory=await fs.mkdtemp(path.join(tmpdir(),'ynx-app-pq-vault-')),filePath=path.join(directory,'wallet-vault-v3.json');
 const lifecycle=new DesktopKeyLifecycle();lifecycle.setFocused(true);
 const vault=new PasswordWalletVault({filePath,authorization:lifecycle,pqSDK,nativePQCustody,randomSecret:()=>SECRET});lifecycle.authorizer=vault.authorizer();
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
// These new controls execute the actual encrypted PasswordWalletVault and
// lifecycle with a CONTROLLED private addon, not real Native crypto/signatures.
function controlledNativeTransaction(){
 let selected=false,closed=false,member=Buffer.from('PUBLIC-NATIVE-CONTROL-NOT-A-SIGNATURE');const counts={open:0,once:0,retire:0,close:0,release:0};const raw=()=>({callStatus:0,copyStatus:0,primitiveStatus:selected?0:-1,cleanupStatus:selected?2:0,selected,member:selected?Buffer.from(member):Buffer.alloc(0)});
 const api={originalPQCapabilities:()=>1,originalPQOpen(wire,credential,binding){counts.open++;assert.equal(JSON.parse(wire).format,'YNX-PQ-WALLET-BACKUP/v1');assert.equal(credential.length,43);assert.equal(JSON.parse(binding).protocolVersion,'YNX-BATCH/v0.1');return{status:0,ownerId:1n};},originalPQCurrent:()=>0,originalPQRetire(){counts.retire++;return 0;},originalPQTransactionOnce(){counts.once++;selected=true;return raw();},originalPQCopyOutcome:raw,originalPQClose(){counts.close++;closed=true;return 0;},originalPQReleaseClosed(){counts.release++;assert(closed);return 0;}};
 return{api,counts,custody:createOriginalNativePQCustody({load:()=>api}),setPublicMember:value=>{member=Buffer.from(value);}};
}
test('actual password Vault Native TX path never restores portable keys and captures public output before late lock',async t=>{
 for(const lateLock of [false,true]){
  let restores=0;const native=controlledNativeTransaction(),sdk={...SDK,restorePQWalletKeyHandle(...args){restores++;return SDK.restorePQWalletKeyHandle(...args);}},f=await fixture(t,sdk,native.custody);
  await f.lifecycle.run(()=>f.vault.savePQKeys({handle:f.handle,publicBinding:f.binding,operationId:'PUBLIC-native-source'}));const before=await fs.readFile(f.filePath,'utf8'),baseline=restores,held=[];
  const run=()=>f.lifecycle.run(()=>f.vault.withPQNativeTransaction(f.binding,{messageOriginal:Buffer.from('PUBLIC CONTROL MESSAGE'),policyOriginal:Buffer.from('PUBLIC CONTROL POLICY'),nativeChainId:'6423',keyVersion:'1',executionHeight:'30'},out=>{held.push(Buffer.from(out.member));if(lateLock)f.lifecycle.lock('focus-lost');},{assert(){}}));
  if(lateLock)await assert.rejects(run());else assert.equal((await run()).selected,true);
  assert.equal(held.length,1);assert.match(held[0].toString(),/PUBLIC-NATIVE-CONTROL/);assert.equal(restores,baseline);assert.equal(native.counts.open,1);assert.equal(native.counts.once,1);assert.equal(native.counts.close,1);assert.equal(native.counts.release,1);assert.equal(f.vault.pqCleanupUnresolved(),false);assert.equal(await fs.readFile(f.filePath,'utf8'),before);
 }
});
test('actual password Vault dedicated Native initial path keeps original capture across late lock without portable restoration',async t=>{
 for(const lateLock of [false,true]){
  let restores=0;const native=controlledNativeTransaction(),sdk={...SDK,restorePQWalletKeyHandle(...args){restores++;return SDK.restorePQWalletKeyHandle(...args);}},f=await fixture(t,sdk,native.custody);
  native.api.originalPQCapabilities=()=>3;
  const ordinary=native.api.originalPQTransactionOnce;
  native.api.originalPQOpenInitial=(wire,credential,binding,message,genesis,pin,chain,height)=>{assert.equal(message.toString(),'PUBLIC E15');assert.equal(genesis.toString(),'PUBLIC FULL GENESIS');assert.equal(pin.length,32);assert.equal(chain,6423n);assert.equal(height.toString(),'30');return native.api.originalPQOpen(wire,credential,binding);};
  native.api.originalPQInitialOnce=id=>{assert.equal(id,1n);return ordinary();};native.api.originalPQTransactionOnce=()=>assert.fail('No ordinary transfer purpose');
  await f.lifecycle.run(()=>f.vault.savePQKeys({handle:f.handle,publicBinding:f.binding,operationId:'PUBLIC-initial-source'}));const before=await fs.readFile(f.filePath,'utf8'),baseline=restores,held=[];
  const request={messageOriginal:Buffer.from('PUBLIC E15'),genesisOriginal:Buffer.from('PUBLIC FULL GENESIS'),genesisPin:Buffer.alloc(32,7),nativeChainId:'6423',executionHeight:'30'};
  const run=()=>f.lifecycle.run(()=>f.vault.withPQNativeAccountInitial(f.binding,request,out=>{held.push(Buffer.from(out.member));if(lateLock)f.lifecycle.lock('focus-lost');},{assert(){}}));
  if(lateLock)await assert.rejects(run());else assert.equal((await run()).selected,true);
  assert.equal(held.length,1);assert.equal(restores,baseline);assert.equal(native.counts.once,1);assert.equal(native.counts.release,1);assert.equal(f.vault.pqCleanupUnresolved(),false);assert.equal(await fs.readFile(f.filePath,'utf8'),before);
 }
});
test('actual password Vault refuses missing Native role or approval without portable key entry',async t=>{
 const native=controlledNativeTransaction(),f=await fixture(t,SDK,native.custody);await f.lifecycle.run(()=>f.vault.savePQKeys({handle:f.handle,publicBinding:f.binding,operationId:'PUBLIC-native-source'}));native.api.originalPQCapabilities=()=>0;
 await assert.rejects(f.lifecycle.run(()=>f.vault.withPQNativeTransaction(f.binding,{},()=>{},{assert(){}})),{code:'PQ_NATIVE_MATCHED_BINDING_REQUIRED'});await assert.rejects(f.lifecycle.run(()=>f.vault.withPQNativeTransaction(f.binding,{},()=>{})),e=>e.data?.code==='PQ_NATIVE_ORIGINAL_APPROVAL_REQUIRED');assert.equal(native.counts.open,0);assert.equal(native.counts.once,0);
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
test('T-P01-01 selected public account lease reads only the protected selection and never opens a private Native or portable key',async t=>{
 let armed=false,privateRestores=0;
 const sdk={...SDK,restorePQWalletKeyHandle(...args){if(armed){privateRestores++;throw Error('PUBLIC_SELECTION_MUST_NOT_RESTORE_KEYS');}return SDK.restorePQWalletKeyHandle(...args);}};
 const native=controlledNativeTransaction(),f=await fixture(t,sdk,native.custody);
 await f.lifecycle.run(()=>f.vault.savePQKeys({handle:f.handle,publicBinding:f.binding,operationId:'PUBLIC-selected-account'}));armed=true;
 const before=await fs.readFile(f.filePath,'utf8');
 const selected=await f.lifecycle.run(()=>f.vault.captureSelectedPQAccountPublic(CHAIN));
 t.after(()=>selected.close());const view=selected.readPublic();
 assert.equal(view.account,f.account);assert.equal(view.networkId,CHAIN);assert.deepEqual(view.publicBinding,f.binding);assert(Object.isFrozen(view));assert(Object.isFrozen(view.publicBinding));
 assert.equal(view.purpose,'product-session-device-selection-v4');
 for(const name of ['chainRegistrationVerified','deviceRegistrationVerified','signingAuthorized','transactionAuthorized'])assert.equal(view[name],false);
 for(const name of ['deviceId','registrationOriginal','credential','wire','handle','pkcs8A','pkcs8B'])assert.equal(name in view,false);
 await f.lifecycle.run(()=>selected.recheck());assert.equal(selected.assertCurrent(),undefined);
 assert.equal(privateRestores,0);assert.equal(native.counts.open,0);assert.equal(await fs.readFile(f.filePath,'utf8'),before);
 selected.close();assert.throws(()=>selected.readPublic());
});
test('T-P01-01 selected public lease cannot survive blur, account change, renewed unlock or changed protected file',async t=>{
 for(const change of ['focus','account','unlock','file']){
  const f=await fixture(t);await f.lifecycle.run(()=>f.vault.savePQKeys({handle:f.handle,publicBinding:f.binding,operationId:'PUBLIC-selected-account'}));
  const selected=await f.lifecycle.run(()=>f.vault.captureSelectedPQAccountPublic(CHAIN));t.after(()=>selected.close());
  if(change==='focus')f.lifecycle.setFocused(false);
  if(change==='account')f.lifecycle.setAccount('0x'+'4'.repeat(40));
  if(change==='unlock'){f.lifecycle.lock();await f.lifecycle.unlock({password:PASSWORD});}
  if(change==='file'){
   const before=await fs.readFile(f.filePath,'utf8');await fs.writeFile(f.filePath,before+'\n',{mode:0o600});
   await assert.rejects(f.lifecycle.run(()=>selected.recheck()));
   await fs.writeFile(f.filePath,before,{mode:0o600});
  }
  assert.throws(()=>selected.readPublic());
 }
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
async function approvalFixture(t,{onRecheck,acquire,migration=false,activeMigration=false,transactionPermission=false,nativeTransaction=false}={}){
 const native=nativeTransaction?controlledNativeTransaction():null;
 const f=await fixture(t,SDK,native?.custody),snapshot=migration&&!activeMigration?parsePQAccountAuthorization({owner:f.account,executionHeight:'30',ledgerNonce:'9007199254740993',algorithmVersion:'legacy',enabled:true,policyVersion:'YNX-ACCOUNT-POLICY/v1',networkId:CHAIN,enableAt:'10',records:[]},{chainId:CHAIN,nativeChainId:'6423',owner:f.account}):syntheticTransfer(f).snapshot;await f.lifecycle.run(()=>f.vault.savePQKeys({handle:f.handle,publicBinding:f.binding,operationId:'QA-sign-source'}));
 // Synthetic PUBLIC policy producer only. Production never rebuilds this
 // operand from a snapshot; it must come from the same HTTP response span.
 const policy=native?JSON.stringify({version:snapshot.policyVersion,networkId:snapshot.networkId,enableAt:snapshot.enableAt,records:snapshot.records}):null;
 if(native)native.setPublicMember(SDK.signPQWalletNativeTransfer(f.handle,syntheticTransfer(f).transfer,snapshot).body);
 const counts={acquire:0,recheck:0,retire:0,join:0,close:0},at=Date.now(),view=Object.freeze({version:native?'YNX-WALLET-TRANSACTION-POLICY/v3':'YNX-WALLET-TRANSACTION-POLICY/v1',networkId:CHAIN,nativeChainId:'6423',canonicalOwner:f.account,authorization:snapshot,...(native?{observation:captureCometPolicyObservation({kind:'comet-node-observed-app-state/v1',source:'comet-rpc',recordsView:'committed',committedHeight:(BigInt(snapshot.executionHeight)-1n).toString(),committedAppHash:'b'.repeat(64),independentFinality:false},snapshot),originalPolicy:encodeObservedPolicyOriginal(policy,snapshot)}:{}),observedAt:new Date(at-1000).toISOString(),expiresAt:new Date(at+60000).toISOString()});let retired=false;
 const resource={assertCurrent(){if(retired)throw Error('QA_RETIRED');},readOriginal(){return view;},async recheck(){counts.recheck++;await onRecheck?.();},retire(){counts.retire++;retired=true;},async join(){counts.join++;},async close(){counts.close++;}};
 if(native)resource.copyOriginalPolicyBytes=()=>new Uint8Array(Buffer.from(policy));
 const source=async input=>{counts.acquire++;assert.equal(input.owner,f.account);assert.equal(input.networkId,CHAIN);assert.equal(input.nativeChainId,'6423');assert.equal(input.operation,migration?'migration':'transfer');if(acquire)await acquire();return resource;};
 const store=new FileTransactionIntentStore({filePath:path.join(f.directory,'journal.json')}),authority=new DesktopWalletAuthority({vault:f.vault,permissions:new MemoryPermissionStore(),transactionSender:{submissions:{intentStore:store}},pqPolicySource:source,pqPolicyRecognized:value=>value===resource,pqNetworkId:CHAIN,...(transactionPermission?{pqTransactionPermissionSource:transactionAuth.acquireOriginalWalletTransactionPermission,pqTransactionPermissionRecognized:transactionAuth.isOriginalWalletTransactionPermission}:{})});
 return {...f,authority,store,counts,resource,native};
}
test('T-P01-02 actual Native-bound authority creates immutable preview without entering signer or journal',async t=>{
 const f=await approvalFixture(t,{nativeTransaction:true,transactionPermission:true});f.vault.withPQKeys=()=>assert.fail('Preview cannot restore portable keys');
 const out=await f.lifecycle.run(()=>f.authority.previewTransfer({to:'0x'+'2'.repeat(40),amount:'3'}));
 assert.equal(out.preview.id,out.request.id);assert.equal(out.preview.nonce,out.request.review.nonce);assert.equal(out.preview.policyRevision,out.request.review.policyRevision);
 assert(Object.isFrozen(out.preview));assert(Object.isFrozen(out.preview.binding));assert.throws(()=>out.preview.amount='999',TypeError);
 assert.deepEqual([out.preview.approved,out.preview.signed,out.preview.submitted],[false,false,false]);
 assert.equal(f.native.counts.once,0);assert.equal(await f.store.unresolvedPreparation(f.account),null);assert.equal((await f.store.readPQOriginals(f.account,()=>{})).length,0);f.authority.cancelAll();assert.equal(f.native.counts.once,0);
});
test('T-P01-02 policy source timeout returns without signing or reserving a transaction',async t=>{
 const timeout=Object.assign(Error('PUBLIC policy source timeout'),{code:'ETIMEDOUT'}),f=await approvalFixture(t,{nativeTransaction:true,transactionPermission:true,acquire:async()=>{throw timeout}});
 await assert.rejects(f.lifecycle.run(()=>f.authority.previewTransfer({to:'0x'+'2'.repeat(40),amount:'3'})),error=>error===timeout);
 assert.equal(f.native.counts.once,0);assert.equal(await f.store.unresolvedPreparation(f.account),null);assert.equal((await f.store.readPQOriginals(f.account,()=>{})).length,0);
});
test('normal independent approval calls Native TX custody once and saves the same public Member without portable fallback',async t=>{
 const f=await approvalFixture(t,{nativeTransaction:true,transactionPermission:true}),out=await f.lifecycle.run(()=>f.authority.requestPQTransfer({to:'0x'+'2'.repeat(40),amount:'3'}));f.vault.withPQKeys=()=>assert.fail('Native TX may not fall back to portable JS');
 const nativeEntry=f.vault.withPQNativeTransaction.bind(f.vault);f.vault.withPQNativeTransaction=async(...args)=>{const marker=await f.store.unresolvedPreparation(f.account);assert.equal(marker.intent.id,out.request.id);assert.deepEqual(marker.intent.binding,out.preview.binding);return nativeEntry(...args);};
 const capsule=transactionAuth.captureOriginalWalletTransactionApprovalIPC(createPublicWalletEvent(),out.request.id,'sign');t.after(()=>transactionAuth.retireUnusedOriginalWalletTransactionApproval(capsule));const response=await f.lifecycle.run(()=>f.authority.approve(out.request.id,capsule));
 assert.equal(response.status,'success');assert.equal(response.result.submitted,false);const [record]=await f.store.readPQOriginals(f.account,()=>{});assert.equal(record.hash,response.result.hash);assert.equal(record.kind,'pq-transfer');assert.equal(f.native.counts.once,1);assert.equal(f.native.counts.close,1);assert.equal(f.native.counts.release,1);await assert.rejects(f.lifecycle.run(()=>f.authority.approve(out.request.id,capsule)));assert.equal(f.native.counts.once,1);
});
test('normal Native TX late lock retains its public Member and explicit later local save never signs again',async t=>{
 const f=await approvalFixture(t,{nativeTransaction:true,transactionPermission:true}),out=await f.lifecycle.run(()=>f.authority.requestPQTransfer({to:'0x'+'2'.repeat(40),amount:'3'})),capture=f.store.capturePQTransferMember.bind(f.store);f.store.capturePQTransferMember=(...args)=>{const value=capture(...args);f.lifecycle.lock('focus-lost');return value;};
 const capsule=transactionAuth.captureOriginalWalletTransactionApprovalIPC(createPublicWalletEvent(),out.request.id,'sign');t.after(()=>transactionAuth.retireUnusedOriginalWalletTransactionApproval(capsule));await assert.rejects(f.lifecycle.run(()=>f.authority.approve(out.request.id,capsule)));const retained=f.store.localOriginal(f.account).pq;assert(retained.wire.length>1000);assert.equal(f.native.counts.once,1);assert.equal(f.native.counts.release,1);await f.lifecycle.unlock({password:PASSWORD});assert.equal((await f.lifecycle.run(()=>f.store.saveOriginal(f.account,retained.hash,()=>f.lifecycle.current().assert()))).savedLocally,true);assert.equal(f.native.counts.once,1);
});
test('T-P01-03 a returned Native member cannot replace the durable intent operation or transfer',async t=>{
 for(const changed of ['operation','amount','recipient','nonce','pair']){
  const f=await approvalFixture(t,{nativeTransaction:true,transactionPermission:true});
  const out=await f.lifecycle.run(()=>f.authority.previewTransfer({to:'0x'+'2'.repeat(40),amount:'3'}));
  if(changed==='operation'){
   const capture=f.store.capturePQTransferMember.bind(f.store);
   f.store.capturePQTransferMember=(account,member,options)=>capture(account,member,{...options,operationId:'different-original-operation'});
  }else if(changed==='pair'){
   const replacement=await SDK.createPQWalletKeyHandle({chainId:CHAIN,owner:f.account});
   try{
    const {snapshot,transfer}=syntheticTransfer(f),keys=pqPublicBindingToRegistrationKeys(SDK.readPQWalletKeyPublic(replacement));
    const differentPolicy=parsePQAccountAuthorization({...snapshot,records:snapshot.records.map(row=>({...row,pkA:keys.pkA,pkB:keys.pkB}))},{chainId:CHAIN,nativeChainId:'6423',owner:f.account});
    f.native.setPublicMember(SDK.signPQWalletNativeTransfer(replacement,transfer,differentPolicy).body);
   }finally{SDK.destroyPQWalletKeyHandle(replacement);}
  }else{
   const {snapshot,transfer}=syntheticTransfer(f);
   const replacement={...transfer,...(changed==='amount'?{amount:'4'}:changed==='recipient'?{to:'0x'+'3'.repeat(40)}:{nonce:(BigInt(transfer.nonce)+1n).toString()})};
   const differentPolicy=changed==='nonce'?parsePQAccountAuthorization({...snapshot,ledgerNonce:transfer.nonce},{chainId:CHAIN,nativeChainId:'6423',owner:f.account}):snapshot;
   f.native.setPublicMember(SDK.signPQWalletNativeTransfer(f.handle,replacement,differentPolicy).body);
  }
  const capsule=transactionAuth.captureOriginalWalletTransactionApprovalIPC(createPublicWalletEvent(),out.request.id,'sign');
  t.after(()=>transactionAuth.retireUnusedOriginalWalletTransactionApproval(capsule));
  await assert.rejects(f.lifecycle.run(()=>f.authority.approve(out.request.id,capsule)));
  const retained=f.store.localOriginal(f.account);
  assert(retained.pqMemberData.length>1000,'first public member remains in custody');
  assert.equal(retained.pq,null,'mismatched result is not a normally saveable signed original');
  assert.deepEqual((await f.store.unresolvedPreparation(f.account)).intent,out.preview);
  assert.equal((await f.store.readPQOriginals(f.account,()=>{})).length,0);
  await assert.rejects(f.store.reserveOriginal(f.account,'pq-transfer',{intent:out.preview}));
  const reopened=new FileTransactionIntentStore({filePath:path.join(f.directory,'journal.json')});
  assert.deepEqual((await reopened.unresolvedPreparation(f.account)).intent,out.preview);
  await assert.rejects(reopened.reserveOriginal(f.account,'pq-transfer',{intent:out.preview}));
  assert.equal(f.native.counts.once,1);
 }
});
test('T-P01-03 local save cannot erase a different valid intent after the original Native result was retained',async t=>{
 const f=await approvalFixture(t,{nativeTransaction:true,transactionPermission:true});
 const out=await f.lifecycle.run(()=>f.authority.previewTransfer({to:'0x'+'2'.repeat(40),amount:'3'}));
 const capture=f.store.capturePQTransferMember.bind(f.store);
 f.store.capturePQTransferMember=(...args)=>{const result=capture(...args);f.lifecycle.lock('focus-lost');return result;};
 const capsule=transactionAuth.captureOriginalWalletTransactionApprovalIPC(createPublicWalletEvent(),out.request.id,'sign');
 t.after(()=>transactionAuth.retireUnusedOriginalWalletTransactionApproval(capsule));
 await assert.rejects(f.lifecycle.run(()=>f.authority.approve(out.request.id,capsule)));
 const original=f.store.localOriginal(f.account).pq,filePath=path.join(f.directory,'journal.json');
 const state=JSON.parse(await fs.readFile(filePath,'utf8'));
 state.preparations[0].intent=createPQTransferPreview({...out.request,review:{...out.request.review,amount:'4'}},{account:f.account,networkId:CHAIN});
 const changed=JSON.stringify(state);await fs.writeFile(filePath,changed,{mode:0o600});
 await f.lifecycle.unlock({password:PASSWORD});
 await assert.rejects(f.lifecycle.run(()=>f.store.saveOriginal(f.account,original.hash,()=>f.lifecycle.current().assert())));
 assert.equal(await fs.readFile(filePath,'utf8'),changed);
 assert.equal(f.store.localOriginal(f.account).pq,original);
 assert.equal((await f.store.readPQOriginals(f.account,()=>{})).length,0);
 assert.equal(f.native.counts.once,1);
});
test('normal Native TX missing role or raw operand refuses before reservation, key entry or submit',async t=>{
 for(const missing of ['role','raw']){
  const f=await approvalFixture(t,{nativeTransaction:true,transactionPermission:true}),out=await f.lifecycle.run(()=>f.authority.requestPQTransfer({to:'0x'+'2'.repeat(40),amount:'3'}));
  if(missing==='role')f.native.api.originalPQCapabilities=()=>0;else f.resource.copyOriginalPolicyBytes=()=>{throw Object.assign(Error('PUBLIC original policy unavailable'),{code:'AUTH_TX_POLICY_ORIGINAL_POLICY_REQUIRED'});};
  const capsule=transactionAuth.captureOriginalWalletTransactionApprovalIPC(createPublicWalletEvent(),out.request.id,'sign');t.after(()=>transactionAuth.retireUnusedOriginalWalletTransactionApproval(capsule));await assert.rejects(f.lifecycle.run(()=>f.authority.approve(out.request.id,capsule)));assert.equal(await f.store.unresolvedPreparation(f.account),null);assert.equal(f.native.counts.open,0);assert.equal(f.native.counts.once,0);
 }
});
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
 const f=await approvalFixture(t,{transactionPermission:true}),main=await fs.readFile(new URL('../src/main.mjs',import.meta.url),'utf8'),handlers=new Map(),events=[];
 const context={...transactionAuth,handleWalletIPC:(name,callback)=>handlers.set(name,callback),walletAuthority:f.authority,keyAccess:f.lifecycle,mainWindow:{webContents:{send:(...args)=>events.push(args)}},sensitiveIPC:(action,options)=>f.lifecycle.run(action,options),walletConnectRequests:new Map(),accountChangeInProgress:false};
 const start=main.indexOf("handleWalletIPC('wallet:pq-transfer-review'"),end=main.indexOf('\nhandleWalletIPC("wallet:transaction-history"',start),a=main.indexOf('handleWalletIPC("wallet:provider-action"'),b=main.indexOf('\nasync function handleCallback',a);
 assert.ok(start>=0&&end>start&&a>=0&&b>a);runInNewContext(main.slice(start,end)+'\n'+main.slice(a,b),context);
 const nodes=new Map(),node=()=>({value:'',textContent:'',disabled:false,append(value){this.child=value;},addEventListener(name,callback){this[name]=callback;}}),doc={querySelector:id=>{if(!nodes.has(id))nodes.set(id,node());return nodes.get(id);},createElement:node};doc.querySelector('#transfer-to').value='0x'+'2'.repeat(40);doc.querySelector('#transfer-amount').value='3';
 const ui=createPQTransferReviewUI({document:doc,getKeyState:()=>f.lifecycle.status(),api:{preparePQTransfer:async input=>({ok:true,value:await handlers.get('wallet:pq-transfer-review')({},input)})}});ui.render();assert.equal(doc.querySelector('#transfer-form').child.disabled,false);assert.equal(doc.querySelector('#transfer-form').child.type,'button');
 await doc.querySelector('#transfer-form').child.click();assert.match(doc.querySelector('#transfer-result').textContent,/approval window/);assert.equal(events.length,1);assert.equal(events[0][0],'wallet:provider-request');
 const result=await handlers.get('wallet:provider-action')(createPublicWalletEvent(),events[0][1].id,'approve');assert.equal(result.status,'success');assert.equal(result.result.submitted,false);assert.equal(result.responseDelivered,false);assert.equal((await f.store.readPQOriginals(f.account,()=>{})).length,1);
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
test('same session journal fences concurrent publication once and preserves its marker, returned reference and original across restart',async t=>{
 const f=await fixture(t);await f.lifecycle.run(()=>f.vault.savePQKeys({handle:f.handle,publicBinding:f.binding,operationId:'QA-session-pair'}));
 const s=sessionQA(f),authority=new DesktopWalletAuthority(s.options);await f.lifecycle.run(()=>authority.approveCanonicalAuthorization(s.request,s.at.toISOString(),f.account));
 const store=s.options.transactionSender.submissions.intentStore,digest=productSessionRequestDigest(PRODUCT_SESSION_REGISTRY,s.request,s.at);
 const results=await Promise.all([store.beginSessionPublication(f.account,digest,()=>{}),store.beginSessionPublication(f.account,digest,()=>{})]);
 assert.deepEqual(results.map(r=>r.created),[true,false]);assert.equal(results[0].publication.publicationRequestId,results[1].publication.publicationRequestId);
 const cold=new FileTransactionIntentStore({filePath:store.filePath});assert.equal((await cold.beginSessionPublication(f.account,digest,()=>{})).created,false);
 const result={reference:'ynxpsr1_'+'r'.repeat(43),nonce:s.request.nonce,state:s.request.state,expiresAt:s.request.expiresAt};
 f.lifecycle.lock();await store.saveSessionPublicationResult(f.account,digest,result);
 assert.equal(f.lifecycle.status().locked,true);assert.equal((await cold.readSessionPublication(f.account,digest,()=>{})).result.reference,result.reference);
 assert.equal(store.retainedSessionPublicationResult(f.account,digest).rawResult,result);
 await assert.rejects(store.saveSessionPublicationResult(f.account,digest,{...result,reference:'ynxpsr1_'+'s'.repeat(43)}));
 const state=JSON.parse(await fs.readFile(store.filePath,'utf8'));assert.equal(state.schemaVersion,8);assert.equal(state.sessionOriginals[0].approval.version,'3');assert.equal(state.sessionOriginals[0].deliveryAttempted,false);
 assert.equal(state.sessionPublications[0].result.reference,result.reference);assert.equal((await fs.stat(store.filePath)).mode&0o077,0);
});
test('publication marker lost ACK permits only original readback and never a second admission',async t=>{
 const f=await fixture(t);await f.lifecycle.run(()=>f.vault.savePQKeys({handle:f.handle,publicBinding:f.binding,operationId:'QA-session-pair'}));
 const s=sessionQA(f);await f.lifecycle.run(()=>new DesktopWalletAuthority(s.options).approveCanonicalAuthorization(s.request,s.at.toISOString(),f.account));
 const store=s.options.transactionSender.submissions.intentStore,digest=productSessionRequestDigest(PRODUCT_SESSION_REGISTRY,s.request,s.at),replace=store.filePolicy.replace.bind(store.filePolicy);let lost=false;
 store.filePolicy.replace=async(...args)=>{await replace(...args);if(!lost){lost=true;throw Error('QA_PUBLICATION_MARKER_ACK_LOST');}};
 await assert.rejects(store.beginSessionPublication(f.account,digest,()=>{}));
 const cold=new FileTransactionIntentStore({filePath:store.filePath}),again=await cold.beginSessionPublication(f.account,digest,()=>{});
 assert.equal(again.created,false);assert.equal(again.publication.status,'publish-unknown');assert.equal(again.publication.result,null);
});
test('original Controller turns an admitted publication into a small reference and emits only after durable save',async t=>{
 const f=await fixture(t);await f.lifecycle.run(()=>f.vault.savePQKeys({handle:f.handle,publicBinding:f.binding,operationId:'QA-session-pair'}));
 const s=sessionQA(f);let publications=0,reads=0,launches=0;
 const client={async publishReturn(input){publications++;assert.equal(input.approval.version,'3');return {reference:'ynxpsr1_'+'r'.repeat(43),nonce:input.request.nonce,state:input.request.state,expiresAt:input.request.expiresAt};},async publicationOutcome(){reads++;assert.fail('no outcome read before the sole publication');}};
 const controller=new DesktopAuthorizationController({authority:new DesktopWalletAuthority({...s.options,sessionReturnClient:client}),clock:()=>s.at,openExternal:async url=>{
  launches++;assert.ok(Buffer.byteLength(url)<=4096);assert.equal(new URL(url).searchParams.get('result'),'reference');assert.equal(url.includes('walletProof'),false);
  const state=JSON.parse(await fs.readFile(s.options.transactionSender.submissions.intentStore.filePath,'utf8'));assert.equal(state.sessionPublications[0].status,'reference-ready');assert.equal(state.sessionOriginals[0].deliveryAttempted,true);
 }});
 await controller.receive(encodeProductSessionWalletURL(PRODUCT_SESSION_REGISTRY,s.request,s.at));const result=await f.lifecycle.run(()=>controller.act('approve'));
 assert.equal(result.callbackEmitted,true);assert.equal(result.authorityGranted,false);assert.equal(result.productSessionCreated,false);assert.equal(result.callbackReceivedProved,false);assert.equal(publications,1);assert.equal(reads,0);assert.equal(launches,1);
});
test('lost publication ACK recovers exact full originals by outcome read without another publication or signature',async t=>{
 const f=await fixture(t);await f.lifecycle.run(()=>f.vault.savePQKeys({handle:f.handle,publicBinding:f.binding,operationId:'QA-session-pair'}));
 const s=sessionQA(f);let publications=0,reads=0,signs=0;const keys=f.vault.withPQKeys.bind(f.vault);f.vault.withPQKeys=(...args)=>{signs++;return keys(...args);};
 let submitted;
 const client={async publishReturn(input){publications++;submitted=input;throw Error('QA_PUBLICATION_ACK_LOST');},async publicationOutcome(input){reads++;assert.equal(input.publicationRequestId,submitted.requestId);assert.deepEqual(input.request,submitted.request);assert.deepEqual(input.approval,submitted.approval);return {state:'pending',reference:'ynxpsr1_'+'r'.repeat(43),expiresAt:input.request.expiresAt,account:input.approval.account,requestDigest:input.approval.requestDigest,approvalDigest:productSessionApprovalDigest(input.approval),retryAuthorized:false};}};
 await assert.rejects(f.lifecycle.run(()=>new DesktopWalletAuthority({...s.options,sessionReturnClient:client}).approveCanonicalAuthorization(s.request,s.at.toISOString(),f.account)),/ACK_LOST/);
 const fresh=sessionQA(f),cold=new DesktopWalletAuthority({...fresh.options,sessionReturnClient:client});
 const recovered=await f.lifecycle.run(()=>cold.reconcileCanonicalAuthorization(s.request,f.account));assert.ok(recovered.callbackUrl.length<=4096);assert.equal(recovered.approval.walletProof,submitted.approval.walletProof);
 assert.equal(publications,1);assert.equal(reads,1);assert.equal(signs,1);
});
test('publication not-found or substituted account/digests never authorize retry or erase the UNKNOWN marker',async t=>{
 const f=await fixture(t);await f.lifecycle.run(()=>f.vault.savePQKeys({handle:f.handle,publicBinding:f.binding,operationId:'QA-session-pair'}));
 const s=sessionQA(f);let publications=0,mode='not_found',original;
 const client={async publishReturn(input){publications++;original=input;throw Error('QA_PUBLICATION_ACK_LOST');},async publicationOutcome(){
  if(mode==='not_found')return {state:'not_found',retryAuthorized:false};
  const found={state:'pending',reference:'ynxpsr1_'+'r'.repeat(43),expiresAt:original.request.expiresAt,account:original.approval.account,requestDigest:original.approval.requestDigest,approvalDigest:productSessionApprovalDigest(original.approval),retryAuthorized:false};
  if(mode==='account')found.account='ynx1'+'q'.repeat(38);if(mode==='approvalDigest')found.approvalDigest='0'.repeat(64);if(mode==='requestDigest')found.requestDigest='0'.repeat(64);if(mode==='retry')found.retryAuthorized=true;return found;
 }};
 await assert.rejects(f.lifecycle.run(()=>new DesktopWalletAuthority({...s.options,sessionReturnClient:client}).approveCanonicalAuthorization(s.request,s.at.toISOString(),f.account)));
 for(mode of ['not_found','account','approvalDigest','requestDigest','retry']){
  const fresh=sessionQA(f);await assert.rejects(f.lifecycle.run(()=>new DesktopWalletAuthority({...fresh.options,sessionReturnClient:client}).reconcileCanonicalAuthorization(s.request,f.account)),e=>e.code==='SESSION_PUBLICATION_UNKNOWN');
 }
 const state=JSON.parse(await fs.readFile(s.options.transactionSender.submissions.intentStore.filePath,'utf8'));assert.equal(state.sessionPublications[0].status,'publish-unknown');assert.equal(state.sessionPublications[0].result,null);assert.equal(publications,1);
});
test('lock immediately after publication response saves its original reference before refusing delivery',async t=>{
 const f=await fixture(t);await f.lifecycle.run(()=>f.vault.savePQKeys({handle:f.handle,publicBinding:f.binding,operationId:'QA-session-pair'}));
 const s=sessionQA(f);let publications=0;
 const client={async publishReturn(input){publications++;f.lifecycle.lock();return {reference:'ynxpsr1_'+'r'.repeat(43),nonce:input.request.nonce,state:input.request.state,expiresAt:input.request.expiresAt};},async publicationOutcome(){assert.fail('saved reference needs no extra outcome read');}};
 await assert.rejects(f.lifecycle.run(()=>new DesktopWalletAuthority({...s.options,sessionReturnClient:client}).approveCanonicalAuthorization(s.request,s.at.toISOString(),f.account)));
 const store=s.options.transactionSender.submissions.intentStore,state=JSON.parse(await fs.readFile(store.filePath,'utf8'));
 assert.equal(state.sessionPublications[0].status,'reference-ready');assert.equal(state.sessionOriginals[0].deliveryAttempted,false);assert.equal(f.lifecycle.status().locked,true);
 await f.lifecycle.unlock({password:PASSWORD});const fresh=sessionQA(f);f.vault.withPQKeys=()=>assert.fail('recovery cannot sign again');
 const result=await f.lifecycle.run(()=>new DesktopWalletAuthority({...fresh.options,sessionReturnClient:client}).reconcileCanonicalAuthorization(s.request,f.account));assert.ok(result.callbackUrl.length<=4096);assert.equal(publications,1);
});
test('reference save lost ACK is reconciled by original journal readback without republishing or overwriting',async t=>{
 const f=await fixture(t);await f.lifecycle.run(()=>f.vault.savePQKeys({handle:f.handle,publicBinding:f.binding,operationId:'QA-session-pair'}));
 const s=sessionQA(f),store=s.options.transactionSender.submissions.intentStore,replace=store.filePolicy.replace.bind(store.filePolicy);let publications=0,lost=false;
 store.filePolicy.replace=async(...args)=>{const data=JSON.parse(await fs.readFile(args[0],'utf8'));await replace(...args);if(!lost&&data.sessionPublications?.[0]?.status==='reference-ready'){lost=true;throw Error('QA_REFERENCE_SAVE_ACK_LOST');}};
 const client={async publishReturn(input){publications++;return {reference:'ynxpsr1_'+'r'.repeat(43),nonce:input.request.nonce,state:input.request.state,expiresAt:input.request.expiresAt};},async publicationOutcome(){assert.fail('durable original reference must be read first');}};
 await assert.rejects(f.lifecycle.run(()=>new DesktopWalletAuthority({...s.options,sessionReturnClient:client}).approveCanonicalAuthorization(s.request,s.at.toISOString(),f.account)),e=>e.data?.code==='TRANSACTION_JOURNAL_WRITE_FAILED'&&e.cause?.message==='QA_REFERENCE_SAVE_ACK_LOST');
 const digest=productSessionRequestDigest(PRODUCT_SESSION_REGISTRY,s.request,s.at);assert.equal(store.retainedSessionPublicationResult(f.account,digest).rawResult.reference,'ynxpsr1_'+'r'.repeat(43));
 const fresh=sessionQA(f);f.vault.withPQKeys=()=>assert.fail('no new signature');const result=await f.lifecycle.run(()=>new DesktopWalletAuthority({...fresh.options,sessionReturnClient:client}).reconcileCanonicalAuthorization(s.request,f.account));
 assert.ok(result.callbackUrl.length<=4096);assert.equal(lost,true);assert.equal(publications,1);
});
test('adding another original session never downgrades schema8 or drops the existing publication',async t=>{
 const f=await fixture(t);await f.lifecycle.run(()=>f.vault.savePQKeys({handle:f.handle,publicBinding:f.binding,operationId:'QA-session-pair'}));
 const s=sessionQA(f),client={async publishReturn(input){return {reference:'ynxpsr1_'+'r'.repeat(43),nonce:input.request.nonce,state:input.request.state,expiresAt:input.request.expiresAt};},async publicationOutcome(){assert.fail('unused');}};
 await f.lifecycle.run(()=>new DesktopWalletAuthority({...s.options,sessionReturnClient:client}).approveCanonicalAuthorization(s.request,s.at.toISOString(),f.account));
 const fresh=sessionQA(f),second={...s.request,purpose:'A different isolated QA original'};
 await f.lifecycle.run(()=>new DesktopWalletAuthority(fresh.options).approveCanonicalAuthorization(second,s.at.toISOString(),f.account));
 const state=JSON.parse(await fs.readFile(s.options.transactionSender.submissions.intentStore.filePath,'utf8'));
 assert.equal(state.schemaVersion,8);assert.equal(state.sessionOriginals.length,2);assert.equal(state.sessionPublications.length,1);assert.equal(state.sessionPublications[0].result.reference,'ynxpsr1_'+'r'.repeat(43));
});
test('normal read-only recovery exposes bounded local summaries and reads expired original outcome without keys, URL or grant',async t=>{
 const f=await fixture(t);await f.lifecycle.run(()=>f.vault.savePQKeys({handle:f.handle,publicBinding:f.binding,operationId:'QA-session-pair'}));
 const s=sessionQA(f);let original,publications=0,reads=0;
 const client={async publishReturn(input){publications++;original=input;throw Error('QA_PUBLICATION_ACK_LOST');},async publicationOutcome(input){reads++;assert.deepEqual(input.approval,original.approval);assert.deepEqual(input.request,original.request);assert.equal(input.publicationRequestId,original.requestId);return {state:'pending',reference:'ynxpsr1_'+'r'.repeat(43),expiresAt:input.request.expiresAt,account:input.approval.account,requestDigest:input.approval.requestDigest,approvalDigest:productSessionApprovalDigest(input.approval),retryAuthorized:false};}};
 await assert.rejects(f.lifecycle.run(()=>new DesktopWalletAuthority({...s.options,sessionReturnClient:client}).approveCanonicalAuthorization(s.request,s.at.toISOString(),f.account)));
 const digest=productSessionRequestDigest(PRODUCT_SESSION_REGISTRY,s.request,s.at),fresh=sessionQA(f),cold=new DesktopWalletAuthority({...fresh.options,sessionReturnClient:client,clock:()=>new Date(Date.parse(s.request.expiresAt)+1000)});
 f.vault.withPQKeys=()=>assert.fail('expired metadata read cannot acquire signing keys');f.vault.withSecret=()=>assert.fail('no classic fallback');
 const records=await f.lifecycle.run(()=>cold.canonicalPublicationRecords());assert.equal(records.length,1);assert.equal(records[0].publicationStatus,'publish-unknown');assert.equal(JSON.stringify(records).includes(original.approval.walletProof),false);
 const metadata=await f.lifecycle.run(()=>cold.readCanonicalPublicationOutcome(digest));assert.equal(metadata.state,'pending');assert.equal(metadata.expired,true);assert.equal(metadata.retryAuthorized,false);assert.equal(metadata.callbackEmitted,false);assert.equal(metadata.productSessionCreated,false);assert.equal('callbackUrl' in metadata,false);assert.equal('approval' in metadata,false);assert.equal(publications,1);assert.equal(reads,1);
 const store=fresh.options.transactionSender.submissions.intentStore;assert.equal((await store.sessionRecoverySummaries('0x'+'2'.repeat(40),()=>{})).length,0);
 f.lifecycle.lock();await assert.rejects(cold.canonicalPublicationRecords());await assert.rejects(cold.readCanonicalPublicationOutcome(digest));assert.equal(reads,1);
});
test('R3c normal fixed SDK HTTP caller drives actual App journal and cold recovery after lost publication ACK',async t=>{
 const f=await fixture(t);await f.lifecycle.run(()=>f.vault.savePQKeys({handle:f.handle,publicBinding:f.binding,operationId:'QA-session-pair'}));
 const s=sessionQA(f),originalFetch=globalThis.fetch;let published,publicationId,publishes=0,reads=0,signs=0;
 const keys=f.vault.withPQKeys.bind(f.vault);f.vault.withPQKeys=(...args)=>{signs++;return keys(...args);};
 t.after(()=>{globalThis.fetch=originalFetch;});
 // Controlled HTTPS replies exercise the actual fixed factory and its strict
 // envelope/DTO parser. They do NOT attest a deployed Source or public Auth.
 globalThis.fetch=async(url,init)=>{
  assert.equal(new URL(url).origin,'https://wallet-auth.ynxweb4.com');assert.equal(init.method,'POST');assert.equal(init.redirect,'error');assert.equal(init.cache,'no-store');assert.equal(init.credentials,'omit');
  const body=JSON.parse(init.body),id=init.headers['x-request-id'];
  if(new URL(url).pathname==='/v2/product-sessions/returns'){
   publishes++;assert.deepEqual(Object.keys(body).sort(),['approval','request']);assert.equal(body.approval.version,'3');published=body;publicationId=id;throw new TypeError('QA_NORMAL_PUBLICATION_ACK_LOST');
  }
  assert.equal(new URL(url).pathname,'/v2/product-sessions/returns/outcome');reads++;
  assert.deepEqual(Object.keys(body).sort(),['approval','publicationRequestId','request','selector']);assert.equal(body.selector,'YNX-PRODUCT-SESSION-PUBLICATION/v1');assert.equal(body.publicationRequestId,publicationId);assert.deepEqual(body.request,published.request);assert.deepEqual(body.approval,published.approval);
  const result={state:'pending',reference:'ynxpsr1_'+'r'.repeat(43),expiresAt:body.request.expiresAt,account:body.approval.account,requestDigest:body.approval.requestDigest,approvalDigest:productSessionApprovalDigest(body.approval),retryAuthorized:false};
  return new Response(canonicalJSON({ok:true,requestId:id,schemaVersion:2,result}),{headers:{'content-type':'application/json','x-request-id':id,'cache-control':'no-store'}});
 };
 const client=createProductWalletReturnPublisher({gatewayTimeoutMs:15000});
 await assert.rejects(f.lifecycle.run(()=>new DesktopWalletAuthority({...s.options,sessionReturnClient:client}).approveCanonicalAuthorization(s.request,s.at.toISOString(),f.account)),e=>e.code==='NETWORK_UNAVAILABLE');
 const failedState=JSON.parse(await fs.readFile(s.options.transactionSender.submissions.intentStore.filePath,'utf8'));assert.equal(failedState.sessionOriginals[0].firstCause?.code,'NETWORK_UNAVAILABLE');
 const fresh=sessionQA(f),cold=new DesktopWalletAuthority({...fresh.options,sessionReturnClient:createProductWalletReturnPublisher({gatewayTimeoutMs:15000})});
 const recovered=await f.lifecycle.run(()=>cold.reconcileCanonicalAuthorization(s.request,f.account));
 assert.equal(recovered.approval.walletProof,published.approval.walletProof);assert.ok(recovered.callbackUrl.length<=4096);assert.equal(new URL(recovered.callbackUrl).searchParams.get('result'),'reference');
 assert.equal(publishes,1);assert.equal(reads,1);assert.equal(signs,1);
 const state=JSON.parse(await fs.readFile(fresh.options.transactionSender.submissions.intentStore.filePath,'utf8'));assert.equal(state.schemaVersion,8);assert.equal(state.sessionPublications[0].status,'reference-ready');assert.equal(state.sessionOriginals[0].deliveryAttempted,false);
});
test('publication first failure survives a separate diagnostic-save ACK failure without another publish',async t=>{
 const f=await fixture(t);await f.lifecycle.run(()=>f.vault.savePQKeys({handle:f.handle,publicBinding:f.binding,operationId:'QA-session-pair'}));
 const s=sessionQA(f),store=s.options.transactionSender.submissions.intentStore,record=store.recordSessionFailure.bind(store),first=Object.assign(Error('QA_PUBLICATION_UNKNOWN'),{code:'QA_PUBLICATION_UNKNOWN'}),metadata=Error('QA_PUBLICATION_METADATA_ACK_LOST');let publications=0;
 store.recordSessionFailure=async(token,options)=>{const result=await record(token,options);if(options.firstPresent&&options.first===first)throw metadata;return result;};
 const client={async publishReturn(){publications++;throw first;},async publicationOutcome(){return {state:'not_found',retryAuthorized:false};}};
 await assert.rejects(f.lifecycle.run(()=>new DesktopWalletAuthority({...s.options,sessionReturnClient:client}).approveCanonicalAuthorization(s.request,s.at.toISOString(),f.account)),e=>e===first&&e.sessionOriginalMetadataError===metadata);
 assert.equal(Object.keys(first).includes('sessionOriginalMetadataError'),false);
 const state=JSON.parse(await fs.readFile(store.filePath,'utf8'));assert.equal(state.sessionOriginals[0].firstCause.code,'QA_PUBLICATION_UNKNOWN');assert.equal(state.sessionPublications[0].status,'publish-unknown');assert.equal(state.sessionOriginals[0].deliveryAttempted,false);
 const fresh=sessionQA(f);await assert.rejects(f.lifecycle.run(()=>new DesktopWalletAuthority({...fresh.options,sessionReturnClient:client}).reconcileCanonicalAuthorization(s.request,f.account)),e=>e.code==='SESSION_PUBLICATION_UNKNOWN');assert.equal(publications,1);
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
test('normal legacy policy cannot create a new classic session and never reserves or enters keys',async t=>{
 const f=await fixture(t),s=sessionQA(f,{legacy:true}),authority=new DesktopWalletAuthority(s.options);
 let classic=0,pq=0,reservations=0;f.vault.withSecret=()=>{classic++;assert.fail('no classic fallback');};f.vault.withPQKeys=()=>{pq++;assert.fail('legacy policy is not a PQ grant');};s.options.transactionSender.submissions.intentStore.reserveSessionOriginal=()=>{reservations++;assert.fail('no signing reservation');};
 await assert.rejects(f.lifecycle.run(()=>authority.approveCanonicalAuthorization(s.request,s.at.toISOString(),f.account)),e=>e.data?.code==='ACCOUNT_PQ_POLICY_REQUIRED');assert.equal(classic,0);assert.equal(pq,0);assert.equal(reservations,0);assert.equal(s.counts.recheck,1);assert.equal(s.counts.close,1);
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
 const f=await fixture(t);await f.lifecycle.run(()=>f.vault.savePQKeys({handle:f.handle,publicBinding:f.binding,operationId:'QA-session-pair'}));const s=sessionQA(f);let signs=0,launches=0;const keys=f.vault.withPQKeys.bind(f.vault);f.vault.withPQKeys=(...args)=>{signs++;return keys(...args);};f.vault.withSecret=()=>assert.fail('no classic fallback');
 const client={async publishReturn(input){return {reference:'ynxpsr1_'+'r'.repeat(43),nonce:input.request.nonce,state:input.request.state,expiresAt:input.request.expiresAt};},async publicationOutcome(){assert.fail('not queried');}};
 const controller=new DesktopAuthorizationController({authority:new DesktopWalletAuthority({...s.options,sessionReturnClient:client}),clock:()=>s.at,openExternal:async()=>{launches++;throw Error('QA_EXTERNAL_UNKNOWN');}});await controller.receive(encodeProductSessionWalletURL(PRODUCT_SESSION_REGISTRY,s.request,s.at));await assert.rejects(f.lifecycle.run(()=>controller.act('approve')));
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

async function deviceCreateFixture(t){
 const f=await fixture(t);await f.lifecycle.run(()=>f.vault.savePQKeys({handle:f.handle,publicBinding:f.binding,operationId:'PUBLIC-device-create'}));
 const selected=await f.lifecycle.run(()=>f.vault.captureSelectedPQAccountPublic(CHAIN));t.after(()=>selected.close());
 const product=productPlatformBinding(PRODUCT_SESSION_REGISTRY,'developer','macos'),at=Date.now();
 const input={networkId:CHAIN,canonicalOwner:f.account,account:ynxAddressFromEVM(f.account),...Object.fromEntries(['productId','clientId','platform','applicationId','bundleId','packageId','origin','callback'].map(k=>[k,product[k]])),deviceId:'PUBLIC-device-original',generation:'1',operationId:'PUBLIC-device-create-op',nonce:'3'.repeat(64),issuedAt:new Date(at).toISOString(),expiresAt:new Date(at+30000).toISOString()};
 const make=(delta={})=>createOriginalDeviceCreateIntentDATA({...input,...delta});
 const prepare=(delta={})=>{const view=make(delta),review=deviceReview.prepareOriginalWalletDeviceCreateReviewDATA(new TextEncoder().encode(view.approvedTerms),selected);t.after(()=>review.close());return {review,view};};
 return {...f,selected,make,prepare,input};
}
test('device-create approval keeps one original exact byte review and a separate purpose',async t=>{
 const f=await deviceCreateFixture(t),{review,view}=f.prepare(),event=createPublicWalletEvent(),capsule=device.captureOriginalWalletDeviceCreateApprovalIPC(event,review);
 assert.throws(()=>device.captureOriginalWalletDeviceCreateApprovalIPC(event,review),{code:'AUTH_DEVICE_CREATE_REVIEW_ALREADY_DECIDED'});
 const peer=device.claimOriginalWalletDeviceCreateApproval(capsule,review);
 try{
  const decision=peer.readOriginalDecision();assert.equal(decision.purpose,'device.create');assert.equal(decision.reviewId,review.id);assert(Object.isFrozen(decision));
  assert.equal(decision.approvedTerms,view.approvedTerms);assert.deepEqual(decision.binding,view.binding);assert.deepEqual(decision.stableIdentityBinding,view.stableIdentityBinding);assert.equal(decision.stableDeviceIdentity,view.stableDeviceIdentity);
  assert(Date.parse(decision.expiresAt)<=Date.parse(view.terms.expiresAt));assert(Date.parse(decision.expiresAt)-Date.parse(decision.issuedAt)<=30000);
  assert.equal(device.isOriginalWalletDeviceCreateApprovalPeer(peer),true);assert.equal(device.isOriginalWalletDeviceCreateApprovalPeer({...peer}),false);assert.equal(device.isOriginalWalletDeviceCreateApprovalPeer(decision),false);
  assert.throws(()=>device.claimOriginalWalletDeviceCreateApproval(capsule,review));device.retireUnusedOriginalWalletDeviceCreateApproval(capsule);assert.equal(peer.assertCurrent(),undefined);
  await f.lifecycle.run(()=>peer.recheck());
  const nativeRead=device.readOriginalWalletDeviceCreateApprovalForNative(peer);assert.equal(nativeRead.decision,decision);assert.deepEqual(nativeRead.selectedAccountDATA,{account:f.account,networkId:CHAIN});assert.equal(nativeRead.localSelectionOnly,true);assert(Object.isFrozen(nativeRead));assert(Object.isFrozen(nativeRead.selectedAccountDATA));
  assert.equal(device.assertOriginalWalletDeviceCreateApprovalCurrentForNative(peer),undefined);await f.lifecycle.run(()=>device.recheckOriginalWalletDeviceCreateApprovalForNative(peer));
 }finally{peer.close();}
 assert.throws(()=>peer.readOriginalDecision());assert.throws(()=>device.captureOriginalWalletDeviceCreateApprovalIPC(event,review));
});
test('device-create approval refuses JSON and cloned reviews, replacement bytes, funds capsules and navigation',async t=>{
 const f=await deviceCreateFixture(t),{review,view}=f.prepare(),{review:other}=f.prepare({nonce:'4'.repeat(64)}),event=createPublicWalletEvent();
 assert.throws(()=>device.claimOriginalWalletDeviceCreateApproval(Object.freeze({approved:true}),review));
 assert.throws(()=>device.captureOriginalWalletDeviceCreateApprovalIPC(event,{...review}));
 assert.throws(()=>device.captureOriginalWalletDeviceCreateApprovalIPC(event,review.id));
 const capsule=device.captureOriginalWalletDeviceCreateApprovalIPC(event,review);
 assert.throws(()=>device.claimOriginalWalletDeviceCreateApproval(capsule,other));
 for(const delta of [{generation:'2'},{operationId:'PUBLIC-device-other-op'},{nonce:'4'.repeat(64)},{expiresAt:new Date(Date.parse(f.input.expiresAt)-1).toISOString()}])assert.throws(()=>review.assertOriginalIntentDATA(f.make(delta)),{code:'DEVICE_CREATE_INTENT_CONFLICT'});
 assert.equal(review.assertOriginalIntentDATA(view).originalMatches,true);
 const funds=transactionAuth.captureOriginalWalletTransactionApprovalIPC(event,review.id,'sign');try{assert.throws(()=>device.claimOriginalWalletDeviceCreateApproval(funds,review));}finally{transactionAuth.retireUnusedOriginalWalletTransactionApproval(funds);}
 event.sender.emit('did-start-navigation');assert.throws(()=>device.claimOriginalWalletDeviceCreateApproval(capsule,review));device.retireUnusedOriginalWalletDeviceCreateApproval(capsule);
 assert.equal(event.sender.listenerCount('destroyed'),0);assert.equal(event.sender.listenerCount('did-start-navigation'),0);
 const bad=createPublicWalletEvent();bad.senderFrame={url:bad.sender.mainFrame.url};assert.throws(()=>device.captureOriginalWalletDeviceCreateApprovalIPC(bad,review));
});
test('device-create approval retires the decision on Wallet lock account renewed unlock and changed protected file',async t=>{
 for(const change of ['focus','account','unlock','file']){
  const f=await deviceCreateFixture(t),{review}=f.prepare();assert.equal(isOriginalSelectedPQAccountPublicLease(f.selected),true);assert.equal(isOriginalSelectedPQAccountPublicLease({...f.selected}),false);
  const event=createPublicWalletEvent(),capsule=device.captureOriginalWalletDeviceCreateApprovalIPC(event,review),peer=device.claimOriginalWalletDeviceCreateApproval(capsule,review);t.after(()=>peer.close());
  if(change==='focus')f.lifecycle.setFocused(false);if(change==='account')f.lifecycle.setAccount('0x'+'4'.repeat(40));if(change==='unlock'){f.lifecycle.lock();await f.lifecycle.unlock({password:PASSWORD});}
  if(change==='file'){const before=await fs.readFile(f.filePath,'utf8');await fs.writeFile(f.filePath,before+'\n',{mode:0o600});await assert.rejects(f.lifecycle.run(()=>peer.recheck()));await fs.writeFile(f.filePath,before,{mode:0o600});}
  assert.throws(()=>peer.assertCurrent());assert.throws(()=>peer.readOriginalDecision());assert.throws(()=>review.assertCurrent());
  assert.throws(()=>device.readOriginalWalletDeviceCreateApprovalForNative(peer));assert.throws(()=>device.assertOriginalWalletDeviceCreateApprovalCurrentForNative(peer));await assert.rejects(device.recheckOriginalWalletDeviceCreateApprovalForNative(peer));
 }
});
test('device-create approval expires permanently and rejects clock rollback without reviving its original review',async t=>{
 const f=await deviceCreateFixture(t),start=Date.parse(f.input.issuedAt);t.mock.timers.enable({apis:['Date'],now:start});
 const {review}=f.prepare(),event=createPublicWalletEvent(),capsule=device.captureOriginalWalletDeviceCreateApprovalIPC(event,review),peer=device.claimOriginalWalletDeviceCreateApproval(capsule,review);t.after(()=>peer.close());
 t.mock.timers.setTime(start+30000);assert.throws(()=>peer.assertCurrent());t.mock.timers.setTime(start+1);assert.throws(()=>peer.assertCurrent());assert.equal(event.sender.listenerCount('destroyed'),0);
 const {review:nextReview}=f.prepare(),second=createPublicWalletEvent(),next=device.captureOriginalWalletDeviceCreateApprovalIPC(second,nextReview),p=device.claimOriginalWalletDeviceCreateApproval(next,nextReview);t.after(()=>p.close());
 t.mock.timers.setTime(start+2);p.assertCurrent();t.mock.timers.setTime(start+1);assert.throws(()=>p.assertCurrent());t.mock.timers.setTime(start+3);assert.throws(()=>p.readOriginalDecision());assert.throws(()=>nextReview.assertCurrent());assert.equal(second.sender.listenerCount('did-start-navigation'),0);
});
test('device-create review rejects a different protected asset account or network and shows complete canonical terms',async t=>{
 const f=await deviceCreateFixture(t),{review,view}=f.prepare();
 assert.equal(review.request.review.purpose,'device.create');for(const [k,v]of Object.entries(view.terms))assert.equal(review.request.review[k],v);
 for(const delta of [{networkId:'b'.repeat(64)},{canonicalOwner:'0x'+'4'.repeat(40),account:ynxAddressFromEVM('0x'+'4'.repeat(40))}])assert.throws(()=>f.prepare(delta),{code:'AUTH_DEVICE_CREATE_SELECTED_ACCOUNT_CHANGED'});
 assert.throws(()=>deviceReview.prepareOriginalWalletDeviceCreateReviewDATA(new TextEncoder().encode(view.approvedTerms),{...f.selected}));
 const displayed=formatApprovalReview(review.request.review);for(const value of [view.terms.account,view.terms.canonicalOwner,view.terms.networkId,view.terms.deviceId,view.terms.operationId,view.terms.nonce,view.terms.callback,view.terms.expiresAt,view.binding.sha512,view.stableIdentityBinding.sha3_512])assert(displayed.includes(value));
 assert(!displayed.includes('Signing domain:'));assert(!displayed.includes('Transaction nonce:'));
 assert.equal(view.userApproved,false);assert.equal(view.SourceAdmission,false);assert.equal(view.NativeAdmission,false);
});

test('device-create fixed Native capture reader refuses injected methods and copied decision DATA',async t=>{
 const f=await deviceCreateFixture(t),{review}=f.prepare(),event=createPublicWalletEvent(),capsule=device.captureOriginalWalletDeviceCreateApprovalIPC(event,review),peer=device.claimOriginalWalletDeviceCreateApproval(capsule,review);t.after(()=>peer.close());
 let invoked=0;const fake={assertCurrent(){invoked++;},readOriginalDecision(){invoked++;return peer.readOriginalDecision();}};
 for(const value of [fake,{...peer},peer.readOriginalDecision(),JSON.parse(JSON.stringify(peer.readOriginalDecision())),new Proxy(peer,{get(){invoked++;throw Error('UNTRUSTED_PEER_GETTER');}})]){
  assert.throws(()=>device.readOriginalWalletDeviceCreateApprovalForNative(value),{code:'AUTH_DEVICE_CREATE_APPROVAL_PEER_REQUIRED'});assert.throws(()=>device.assertOriginalWalletDeviceCreateApprovalCurrentForNative(value));await assert.rejects(device.recheckOriginalWalletDeviceCreateApprovalForNative(value));
 }
 assert.equal(invoked,0);peer.close();assert.throws(()=>device.readOriginalWalletDeviceCreateApprovalForNative(peer));assert.equal(event.sender.listenerCount('destroyed'),0);
});

test('device-create fixed createRequire namespace recognizes the same original Main peer instance',async t=>{
 const f=await deviceCreateFixture(t),{review}=f.prepare(),capsule=device.captureOriginalWalletDeviceCreateApprovalIPC(createPublicWalletEvent(),review),peer=device.claimOriginalWalletDeviceCreateApproval(capsule,review);t.after(()=>peer.close());
 const fixed=createRequire(import.meta.url)(fileURLToPath(new URL('../src/original-policy-supplier/device-create-approval.mjs',import.meta.url)));
 assert.equal(fixed.isOriginalWalletDeviceCreateApprovalPeer,device.isOriginalWalletDeviceCreateApprovalPeer);assert.equal(fixed.readOriginalWalletDeviceCreateApprovalForNative,device.readOriginalWalletDeviceCreateApprovalForNative);assert.equal(fixed.isOriginalWalletDeviceCreateApprovalPeer(peer),true);
 assert.equal(fixed.readOriginalWalletDeviceCreateApprovalForNative(peer).decision,peer.readOriginalDecision());assert.equal(fixed.assertOriginalWalletDeviceCreateApprovalCurrentForNative(peer),undefined);await f.lifecycle.run(()=>fixed.recheckOriginalWalletDeviceCreateApprovalForNative(peer));
 assert.equal(fixed.isOriginalWalletDeviceCreateApprovalPeer({...peer}),false);assert.throws(()=>fixed.readOriginalWalletDeviceCreateApprovalForNative({...peer}));peer.close();assert.throws(()=>fixed.assertOriginalWalletDeviceCreateApprovalCurrentForNative(peer));
});
