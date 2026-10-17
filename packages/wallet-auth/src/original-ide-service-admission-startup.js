import {constants,openSync,closeSync,lstatSync,fstatSync,readSync} from 'node:fs';
import {dirname,isAbsolute,resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {types} from 'node:util';
import {canonicalJSON,exactFields,WalletAuthError} from './canonical.js';
import {captureOriginalRecoveryJSON} from './original-operation-recovery-state.js';
import {prepareOriginalWalletServiceAdmission} from './original-wallet-service-admission.js';
import {readOriginalOperationProtectedSource} from './original-operation-protected-startup.js';
// Final package identity is independently approved OUTSIDE the package.
// No final provenance digest/commit/tree is compiled back into its own inputs.
const fail=(c='IDE_ORIGINAL_ADMISSION_STARTUP_NOT_CONFIGURED')=>{throw new WalletAuthError(c,'Original private IDE admission startup unavailable');};
// A failed close may have released the FD already. Keep its original custody
// and cause privately; never retry an unknown/recycled FD or acquire more.
const consumerCleanupDebt=[];
const assertConsumerCleanupComplete=()=>{if(consumerCleanupDebt.length)fail('IDE_ADMISSION_CONSUMER_CLEANUP_INCOMPLETE');};
const uid=process.getuid?.();
const id=s=>({dev:s.dev,ino:s.ino,uid:s.uid,mode:s.mode});
const same=(s,i)=>s.dev===i.dev&&s.ino===i.ino&&s.uid===i.uid&&s.mode===i.mode;
// Fixed owner-native startup ONLY. Neither supportRoot/project/ENV nor an IPC
// caller supplies this selection. The root must already be independently
// approved; a selected public key/file/digest is not an approval ceremony.
export function prepareOriginalIDEServiceAdmissionStartup(ownerSelection,runningBackendModuleURL,originalNow){
 if(ownerSelection===null||typeof originalNow!=='function'||types.isProxy(originalNow))fail();
 assertConsumerCleanupComplete();
 const s=captureOriginalRecoveryJSON(ownerSelection);exactFields(s,['sourceSelection','receiptSelection','expectedRequest','receiptDirectory'],'Private original IDE startup selection');
 for(const k of ['receiptDirectory'])if(typeof s[k]!=='string'||!isAbsolute(s[k])||resolve(s[k])!==s[k])fail();
 exactFields(s.receiptSelection,['receiptPath','receiptDigest'],'Original installed receipt selection');
 if(s.receiptSelection.receiptPath!==join(s.receiptDirectory,s.expectedRequest.requestNonce+'.admission.json')||typeof s.expectedRequest.consumerManifestDigest!=='string'||!/^[0-9a-f]{64}$/.test(s.expectedRequest.consumerManifestDigest))fail('IDE_ADMISSION_CONSUMER_MISMATCH');
 // ONLY original Node/native backend passes its own import.meta.url. This is
 // an actual-location input, never a selected expected digest/root/permission.
 // It must be the currently executed server.mjs, not another matching old App.
 if(typeof runningBackendModuleURL!=='string')fail('IDE_ADMISSION_RUNNING_ENTRY_MISMATCH');
 let entry;try{const u=new URL(runningBackendModuleURL);if(u.protocol!=='file:'||u.host||u.search||u.hash)fail();entry=fileURLToPath(u);}catch{fail('IDE_ADMISSION_RUNNING_ENTRY_MISMATCH');}
 if(!isAbsolute(entry)||resolve(entry)!==entry||entry!==join(dirname(entry),'server.mjs')||typeof process.argv[1]!=='string'||resolve(process.argv[1])!==entry)fail('IDE_ADMISSION_RUNNING_ENTRY_MISMATCH');
 const resources=dirname(entry),consumerProvenancePath=join(resources,'build-provenance.json');
 const entryBefore=lstatSync(entry);
 if(!entryBefore.isFile()||entryBefore.isSymbolicLink()||![0,uid].includes(entryBefore.uid)||(entryBefore.mode&0o022)!==0||entryBefore.nlink!==1)fail('IDE_ADMISSION_CONSUMER_CUSTODY');
 const entryIdentity=id(entryBefore);
 const readConsumer=()=>{
  assertConsumerCleanupComplete();
  const held=[];let primaryFailurePresent=false,primaryCause;try{
   let p=dirname(consumerProvenancePath);const chain=[];for(;;){chain.unshift(p);if(dirname(p)===p)break;p=dirname(p);}
   for(const path of chain){const st=lstatSync(path);if(!st.isDirectory()||st.isSymbolicLink()||![0,uid].includes(st.uid)||(st.mode&0o022)!==0)fail('IDE_ADMISSION_CONSUMER_CUSTODY');const fd=openSync(path,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);held.push({fd,path,id:id(st)});if(!same(fstatSync(fd),id(st)))fail();}
   const entryFD=openSync(entry,constants.O_RDONLY|constants.O_NOFOLLOW);held.push({fd:entryFD,path:entry,id:entryIdentity});if(!same(fstatSync(entryFD),entryIdentity)||!same(lstatSync(entry),entryIdentity))fail('IDE_ADMISSION_RUNNING_ENTRY_CHANGED');
   const before=lstatSync(consumerProvenancePath);if(!before.isFile()||before.isSymbolicLink()||![0,uid].includes(before.uid)||(before.mode&0o022)!==0||before.nlink!==1||before.size>65536)fail('IDE_ADMISSION_CONSUMER_CUSTODY');
   const fd=openSync(consumerProvenancePath,constants.O_RDONLY|constants.O_NOFOLLOW);held.push({fd,path:consumerProvenancePath,id:id(before)});const bytes=Buffer.alloc(65537);let length=0;for(;;){const n=readSync(fd,bytes,length,bytes.length-length,length);if(n===0)break;length+=n;if(length===bytes.length)fail('IDE_ADMISSION_CONSUMER_CAPACITY');}
   if(length!==before.size||createHash('sha256').update(bytes.subarray(0,length)).digest('hex')!==s.expectedRequest.consumerManifestDigest)fail('IDE_ADMISSION_CONSUMER_MISMATCH');
   let value;try{value=JSON.parse(bytes.subarray(0,length).toString('utf8'));}catch{fail();}
   if(value.schemaVersion!==1||value.productId!=='ynx-developer-v1'||value.sourceDirty!==false||typeof value.sourceCommit!=='string'||! /^[0-9a-f]{40}$/.test(value.sourceCommit)||typeof value.sourceTree!=='string'||! /^[0-9a-f]{40}$/.test(value.sourceTree)||value.runtimeCheckpoint!==value.sourceCommit||value.platform!==`macos-${process.arch}`||value.artifactClass!=='unsigned-testnet-preview')fail('IDE_ADMISSION_CONSUMER_MISMATCH');
   for(const h of held)if(!same(fstatSync(h.fd),h.id)||!same(lstatSync(h.path),h.id))fail('IDE_ADMISSION_CONSUMER_CHANGED');
  }catch(cause){primaryFailurePresent=true;primaryCause=cause;}
  finally{for(const h of held.reverse())try{closeSync(h.fd);}catch(cause){consumerCleanupDebt.push({custody:h,cause});}}
  // Preserve the original read failure, including a falsy thrown value. Debt
  // remains independently retained and blocks every later acquisition/read.
  if(primaryFailurePresent)throw primaryCause;
  assertConsumerCleanupComplete();
 };
 const checkPrivate=()=>{const st=lstatSync(s.receiptDirectory);if(!st.isDirectory()||st.isSymbolicLink()||st.uid!==uid||(st.mode&0o077)!==0)fail('IDE_ADMISSION_RECEIPT_CUSTODY');readOriginalOperationProtectedSource(s.sourceSelection.rootPath,s.sourceSelection.rootDigest);readOriginalOperationProtectedSource(s.sourceSelection.rolePath,s.sourceSelection.roleDigest);readOriginalOperationProtectedSource(s.receiptSelection.receiptPath,s.receiptSelection.receiptDigest);readConsumer();};
 let active=false,invalid=false;
 readConsumer();const admission=prepareOriginalWalletServiceAdmission(s.sourceSelection,s.receiptSelection,s.expectedRequest,originalNow);checkPrivate();
 // Only this narrow callable crosses original native/backend to frontend proxy.
 // No selected paths/raw/root/role/key or installed flag becomes renderer data.
 return Object.freeze({assertCurrent(input){if(active){invalid=true;fail('IDE_ADMISSION_REENTRANT');}if(invalid)fail('IDE_ADMISSION_RETIRED');active=true;try{const v=captureOriginalRecoveryJSON(input);exactFields(v,['service','productId','platform','gatewayOrigin','operation'],'Original four-op IDE admission call');readConsumer();admission.assertCurrent(v);checkPrivate();admission.assertCurrent(v);checkPrivate();if(invalid)fail('IDE_ADMISSION_RETIRED');return undefined;}catch(e){invalid=true;throw e;}finally{active=false;}}});
}
