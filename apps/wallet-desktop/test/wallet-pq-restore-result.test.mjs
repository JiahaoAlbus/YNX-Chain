import test from 'node:test';import assert from 'node:assert/strict';import * as fs from 'node:fs/promises';import path from 'node:path';import {tmpdir} from 'node:os';
import {DesktopKeyLifecycle} from '../src/key-lifecycle.mjs';
import {PasswordWalletVault} from '../src/password-wallet-vault.mjs';
import {parsePasswordVault,unlockPasswordVault,rewritePasswordVault,closePasswordVaultSession,decryptPasswordVaultPQRecord} from '../src/password-vault-crypto.mjs';
import {createRegisteredPQRestore} from '../src/wallet-pq-registered-restore.mjs';
import * as keys from '@ynx-chain/wallet-auth/pq-wallet-key-backup';import * as backup from '@ynx-chain/wallet-auth/pq-wallet-backup';import * as contract from '@ynx-chain/wallet-auth/pq-wallet-contract';
import {pqPublicBindingToRegistrationKeys} from '@ynx-chain/wallet-auth/pq-wallet-authorization';
import {acquireOriginalWalletRegisteredBinding,isOriginalWalletRegisteredBinding} from '../src/original-policy-supplier/registered-binding-resource.mjs';
import https from 'node:https';import {EventEmitter} from 'node:events';import {syncBuiltinESMExports} from 'node:module';
const networkId='16366ff25bcc73c6bb95d12733be74d1ac885d3daf518ddd0e4bd4438cff243f',password='isolated-restore-result-QA-password',deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
// Real SDK and encrypted production Vault; all keys/accounts are new synthetic
// QA fixtures. Source below is a PUBLIC contract stand-in, not live authority.
async function fixture(t,{normal=false}={}){
 const directory=await fs.mkdtemp(path.join(tmpdir(),'ynx-restore-result-')),filePath=path.join(directory,'vault.json'),counts={import:0,acquire:0,recheck:0,close:0,fileRead:0,choose:0,pqPublish:0},options={gate:null,importFailure:false,closeFailure:false,changedBinding:false,lockAfterCapture:false,publicFailure:false,destroyFailure:false};
 const lifecycle=new DesktopKeyLifecycle();lifecycle.setFocused(true);let returned;
 const sdk=Object.freeze({...keys,...backup,...contract,readPQWalletKeyPublic(handle){if(options.publicFailure&&handle===returned)throw false;return keys.readPQWalletKeyPublic(handle);},destroyPQWalletKeyHandle(handle){if(options.destroyFailure&&handle===returned)throw false;return keys.destroyPQWalletKeyHandle(handle);},async restorePQWalletKeyHandle(...args){counts.import++;if(options.importFailure)throw false;const handle=await keys.restorePQWalletKeyHandle(...args);returned=handle;if(options.gate){options.gate.entered.resolve();await options.gate.release.promise;}return handle;}});
 const vault=new PasswordWalletVault({filePath,authorization:lifecycle,pqSDK:sdk,randomSecret:()=> '1'.padStart(64,'0')});lifecycle.authorizer=vault.authorizer();
 t.after(async()=>{lifecycle.lock();if(returned)keys.destroyPQWalletKeyHandle(returned);await fs.rm(directory,{recursive:true,force:true});});
 await lifecycle.custody(g=>vault.setup({password,confirmation:password},g));await lifecycle.unlock({password});const status=await lifecycle.run(()=>vault.createAccount());lifecycle.setAccount(status.account);await lifecycle.unlock({password});
 const source=await keys.createPQWalletKeyHandle({chainId:networkId,owner:status.account});t.after(()=>keys.destroyPQWalletKeyHandle(source));
 const binding=keys.readPQWalletKeyPublic(source),credential=backup.createPQRecoveryCredential(),wire=await keys.exportPQWalletBackup(source,credential),before=parsePasswordVault(await fs.readFile(filePath,'utf8'));
 const originals=new WeakSet();const acquire=async request=>{
  assert.equal(request.operation,'read-registered-binding');assert.equal(request.owner,status.account);assert.equal(request.networkId,networkId);counts.acquire++;if(normal)return acquireOriginalWalletRegisteredBinding(request);let retired=false;
  const resource={assertCurrent(){if(retired)throw Error('QA_RETIRED');},readOriginal(){return Object.freeze({version:'YNX-WALLET-REGISTERED-BINDING/v1',publicBinding:options.changedBinding?{...binding,pkB:binding.pkB[0]==='A'?'B'+binding.pkB.slice(1):'A'+binding.pkB.slice(1)}:binding,dataOnly:true,restorationAuthorized:false,adoptionAuthorized:false,signingAuthorized:false,transactionAuthorized:false,retryAuthorized:false});},async recheck(){counts.recheck++;},retire(){retired=true;},async close(){retired=true;counts.close++;if(options.closeFailure)throw false;}};originals.add(resource);return resource;
 };
 const make=()=>createRegisteredPQRestore({lifecycle,vault,sdk,networkId,id:()=> 'QA-original-restore-result',acquire,isOriginal:normal?isOriginalWalletRegisteredBinding:value=>originals.has(value),files:{async read(){counts.fileRead++;return new Uint8Array(wire);}},chooseFile:async()=>{counts.choose++;return 'QA-original-backup';}});
 const capture=vault.capturePQRestoreResult.bind(vault);vault.capturePQRestoreResult=(...args)=>{const result=capture(...args);if(options.lockAfterCapture)lifecycle.lock();return result;};
 const publish=vault.files.publish.bind(vault.files);vault.files.publish=async(value,...args)=>{if(value.pqKeyRecords?.length)counts.pqPublish++;return publish(value,...args);};
 return {directory,filePath,lifecycle,vault,sdk,counts,options,binding,credential,wire,before,api:make(),make,account:status.account,returned:()=>returned};
}
async function verifyStored(f){
 const text=await fs.readFile(f.filePath,'utf8'),after=parsePasswordVault(text);assert.deepEqual(after.accounts,f.before.accounts);assert.deepEqual(after.records,f.before.records);assert.deepEqual(after.passwordWrap,f.before.passwordWrap);assert.equal(after.activeAccount,f.before.activeAccount);
 const session=await unlockPasswordVault(text,password);try{const payload=await decryptPasswordVaultPQRecord(after,f.account,session);assert.equal(Buffer.from(payload.wire).equals(Buffer.from(f.wire)),true);assert.equal(payload.credential,f.credential);payload.wire.fill(0);payload.credential=null;}finally{closePasswordVaultSession(session);}
 assert.equal(text.includes(f.credential),false);
}
async function interrupt(f){f.options.gate={entered:deferred(),release:deferred()};const work=f.api.restore({credential:f.credential});await f.options.gate.entered.promise;f.lifecycle.lock();f.options.gate.release.resolve();await assert.rejects(work);assert.equal(f.api.status().resumeAvailable,true);assert.equal(keys.readPQWalletKeyCleanupOutcome(f.returned()).cleanupComplete,true);}
test('original restore stores exact backup with one SDK import and preserves existing classic Vault',async t=>{
 const f=await fixture(t),result=await f.api.restore({credential:f.credential});assert.equal(result.persisted,true);assert.equal(result.resumeAvailable,false);assert.equal(f.counts.import,1);assert.equal(f.counts.pqPublish,1);assert.equal(keys.readPQWalletKeyCleanupOutcome(f.returned()).cleanupComplete,true);await verifyStored(f);
});
test('late import after lock retains encrypted verified result; explicit resume saves without another import, file read or credential',async t=>{
 const f=await fixture(t);await interrupt(f);assert.equal(f.api.status().persisted,false);assert.equal(f.counts.pqPublish,0);
 f.api.selectOriginalOutcome(r=>f.vault.selectPQRestoreResultOutcome(r.restoreResult,result=>{assert.equal(result.verified,true);assert.equal(result.hasEncryptedCandidate,true);assert.equal(result.retainsCredential,false);assert.equal(result.retainsDEK,false);}));
 await f.lifecycle.unlock({password});assert.equal((await f.api.recover()).resumeAvailable,true);assert.equal(f.counts.import,1);const result=await f.api.resume();assert.equal(result.persisted,true);assert.equal(result.signingAuthorized,false);assert.equal(result.transactionAuthorized,false);
 assert.equal(f.counts.import,1);assert.equal(f.counts.choose,1);assert.equal(f.counts.fileRead,1);assert.equal(f.counts.pqPublish,1);assert.equal(f.counts.acquire,2);assert.equal(f.counts.recheck,1);await verifyStored(f);await assert.rejects(f.api.resume());assert.equal(f.counts.import,1);
});
test('lock immediately after public result capture also resumes only the same retired original',async t=>{
 const f=await fixture(t);f.options.lockAfterCapture=true;await assert.rejects(f.api.restore({credential:f.credential}));assert.equal(f.api.status().resumeAvailable,true);await f.lifecycle.unlock({password});assert.equal((await f.api.resume()).persisted,true);assert.equal(f.counts.import,1);assert.equal(f.counts.pqPublish,1);
});
test('lost save acknowledgement permits readonly reconciliation only, not another write or import',async t=>{
 const f=await fixture(t),publish=f.vault.files.publish.bind(f.vault.files);f.vault.files.publish=async(value,...args)=>{const result=await publish(value,...args);if(value.pqKeyRecords?.length){f.lifecycle.lock();throw false;}return result;};
 await assert.rejects(f.api.restore({credential:f.credential}));assert.equal(f.api.status().persistenceAttempted,true);assert.equal(f.api.status().resumeAvailable,false);assert.equal(f.counts.pqPublish,1);
 await f.lifecycle.unlock({password});await assert.rejects(f.api.resume());const before=await fs.readFile(f.filePath,'utf8');assert.equal((await f.api.recover()).persisted,true);assert.equal(await fs.readFile(f.filePath,'utf8'),before);assert.equal(f.counts.import,1);assert.equal(f.counts.pqPublish,1);await verifyStored(f);
});
test('unconfirmed failed save does not clear reservation or blindly rewrite the original candidate',async t=>{
 const f=await fixture(t),publish=f.vault.files.publish.bind(f.vault.files);f.vault.files.publish=async(value,...args)=>{if(value.pqKeyRecords?.length)throw false;return publish(value,...args);};
 await assert.rejects(f.api.restore({credential:f.credential}));assert.equal(f.api.status().resumeAvailable,false);await f.lifecycle.unlock({password});const before=await fs.readFile(f.filePath,'utf8');await assert.rejects(f.api.recover());await assert.rejects(f.api.resume());await assert.rejects(f.api.restore({credential:f.credential}));assert.equal(await fs.readFile(f.filePath,'utf8'),before);assert.equal(f.counts.import,1);assert.equal(parsePasswordVault(before).pqPreparationReservations[0].kind,'restore');
});
test('changed original registered pair refuses resume without replacing candidate or importing again',async t=>{
 const f=await fixture(t);await interrupt(f);await f.lifecycle.unlock({password});f.options.changedBinding=true;const before=await fs.readFile(f.filePath,'utf8');await assert.rejects(f.api.resume());assert.equal(await fs.readFile(f.filePath,'utf8'),before);assert.equal(f.counts.import,1);assert.equal(f.counts.pqPublish,0);assert.equal(f.counts.close,2);
});
test('same-account Vault generation change refuses resume by original digest CAS',async t=>{
 const f=await fixture(t);await interrupt(f);const text=await fs.readFile(f.filePath,'utf8'),session=await unlockPasswordVault(text,password);let candidate;
 try{candidate=await rewritePasswordVault(text,{},session);await fs.writeFile(f.filePath,JSON.stringify(candidate.vault)+'\n',{mode:0o600});}finally{closePasswordVaultSession(session);closePasswordVaultSession(candidate?.session);}
 await f.lifecycle.unlock({password});const before=await fs.readFile(f.filePath,'utf8');await assert.rejects(f.api.resume());assert.equal(await fs.readFile(f.filePath,'utf8'),before);assert.equal(f.counts.import,1);assert.equal(f.counts.pqPublish,0);
});
test('no returned import result remains UNKNOWN across a new controller and cannot resume or import again',async t=>{
 const f=await fixture(t);f.options.importFailure=true;await assert.rejects(f.api.restore({credential:f.credential}));assert.equal(f.api.status().preparationUnknown,true);assert.equal(f.api.status().resumeAvailable,false);
 assert.equal((await f.api.recover()).preparationUnknown,true);const cold=f.make();assert.equal((await cold.recover()).preparationUnknown,true);await assert.rejects(cold.resume());await assert.rejects(cold.restore({credential:f.credential}));assert.equal(f.counts.import,1);assert.equal(f.counts.pqPublish,0);
 f.api.selectOriginalOutcome(r=>r.controller.selectRetainedOutcome(result=>{assert.equal(result.firstCausePresent,true);assert.equal(result.firstCause,false);}));
});
test('original source cleanup failure keeps saved facts separate and blocks a retained-result resume',async t=>{
 const f=await fixture(t);f.options.closeFailure=true;await assert.rejects(f.api.restore({credential:f.credential}));assert.equal(f.api.status().persisted,true);assert.equal(f.api.status().cleanupDebt,true);await assert.rejects(f.api.resume());assert.equal(f.counts.import,1);assert.equal(f.counts.pqPublish,1);
});
test('unverifiable returned public identity retains falsy first cause and cannot authorize a save or resume',async t=>{
 const f=await fixture(t);f.options.publicFailure=true;await assert.rejects(f.api.restore({credential:f.credential}));assert.equal(f.api.status().resumeAvailable,false);assert.equal(f.counts.import,1);assert.equal(f.counts.pqPublish,0);assert.equal(keys.readPQWalletKeyCleanupOutcome(f.returned()).cleanupComplete,true);
 f.api.selectOriginalOutcome(r=>{f.vault.selectPQRestoreResultOutcome(r.restoreResult,result=>{assert.equal(result.verified,false);assert.equal(result.firstCausePresent,true);assert.equal(result.firstCause,false);});r.controller.selectRetainedOutcome(result=>assert.equal(result.firstCause,false));});await assert.rejects(f.api.resume());
});
test('cleanup failure of the original returned private handle blocks resume without hiding saved facts',async t=>{
 const f=await fixture(t);f.options.destroyFailure=true;f.options.lockAfterCapture=true;await assert.rejects(f.api.restore({credential:f.credential}));assert.equal(f.api.status().cleanupDebt,true);assert.equal(f.api.status().resumeAvailable,false);assert.equal(f.counts.pqPublish,0);await f.lifecycle.unlock({password});await assert.rejects(f.api.resume());assert.equal(f.counts.import,1);assert.equal(f.counts.acquire,1);
 f.api.selectOriginalOutcome(r=>r.controller.selectRetainedOutcome(result=>{assert.equal(result.cleanupCausePresent,true);assert.equal(result.cleanupCause,false);}));
});
test('plain DTO or another Vault cannot manufacture an opaque original restore result',async t=>{
 const f=await fixture(t);await assert.rejects(f.vault.commitPQRestoreResult({verified:true}));assert.throws(()=>f.vault.capturePQRestoreResult({},{}));assert.equal(f.counts.import,0);assert.equal(f.counts.pqPublish,0);
 await f.api.restore({credential:f.credential});const token=f.api.selectOriginalOutcome(r=>r.restoreResult),other=new PasswordWalletVault({filePath:path.join(f.directory,'other-vault.json'),authorization:f.lifecycle,pqSDK:f.sdk});
 await assert.rejects(other.commitPQRestoreResult(token));assert.throws(()=>other.pqRestoreResultStatus(token));assert.equal(f.counts.import,1);assert.equal(f.counts.pqPublish,1);await assert.rejects(fs.stat(path.join(f.directory,'other-vault.json')),{code:'ENOENT'});
});
test('actual R54 original factory supplies fresh registered binding for same-result resume with GET-only instrumentation',async t=>{
 const f=await fixture(t,{normal:true}),originalHTTPS=https.request,calls=[],pair=pqPublicBindingToRegistrationKeys(f.binding);
 https.request=(url,options,callback)=>{
  assert.equal(url.origin,'https://rpc.ynxweb4.com');assert.equal(options.method,'GET');assert.equal(options.rejectUnauthorized,true);assert.equal(options.agent,false);calls.push(url.pathname);
  const request=new EventEmitter();request.destroy=()=>{};request.end=()=>queueMicrotask(()=>{
   const response=new EventEmitter();response.destroy=()=>{};response.statusCode=200;response.headers={'content-type':'application/json','cache-control':'no-store'};
   const body=url.pathname==='/status'?{chainId:6423,catchingUp:false,persistence:true,persistenceError:'',build:{commit:'65efa82e0615',release:'ynx-network-surgical-65efa82e0615'}}:url.pathname==='/blocks/0'?{height:0,hash:networkId}:{owner:f.account,executionHeight:'30',ledgerNonce:'1',algorithmVersion:'YNX-BATCH/v0.1',enabled:true,policyVersion:'YNX-ACCOUNT-POLICY/v1',networkId,enableAt:'10',activeRevision:'1',records:[{algorithmVersion:pair.algorithmVersion,owner:f.account,pkA:pair.pkA,pkB:pair.pkB,revision:'1',registeredAt:'10',activeFrom:'20',ledgerNonce:'1'}],revocations:[],policyView:'next_execution',recordsView:'includes_pending',source:'authoritative_producer',recordsComplete:true,committedHeight:'29',committedBlockHash:'30'.padStart(64,'0'),committedAlgorithmVersion:'YNX-BATCH/v0.1',committedActiveRevision:'1',checkpointStatus:'durable',checkpointIntegrity:'a'.repeat(64),globalPolicyVersion:'YNX-ACCOUNT-POLICY/v1',authorizationStatus:'active',pqSigningEnabled:true,committedAuthorizationStatus:'active',committedPQSigningEnabled:true};
   callback(response);response.emit('data',Buffer.from(JSON.stringify(body)));response.emit('end');
  });return request;
 };syncBuiltinESMExports();
 try{
  await interrupt(f);await f.lifecycle.unlock({password});assert.equal((await f.api.resume()).persisted,true);assert.equal(f.counts.import,1);assert.equal(f.counts.pqPublish,1);
  assert.deepEqual(calls,Array.from({length:3},()=>['/status','/blocks/0','/accounts/'+f.account+'/authorization','/status']).flat());
 }finally{https.request=originalHTTPS;syncBuiltinESMExports();}
});
