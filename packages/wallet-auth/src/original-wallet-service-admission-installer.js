import {constants,openSync,closeSync,lstatSync,fstatSync,readSync,writeSync,fsyncSync,linkSync,unlinkSync} from 'node:fs';
import {resolve,dirname,isAbsolute,join} from 'node:path';
import {createHash} from 'node:crypto';
import {types} from 'node:util';
import {canonicalJSON,exactFields,WalletAuthError} from './canonical.js';
import {captureOriginalRecoveryJSON} from './original-operation-recovery-state.js';
import {readOriginalOperationProtectedSource} from './original-operation-protected-startup.js';
import {prepareOriginalWalletServiceAdmission,prepareOriginalWalletServiceAdmissionReview,validateOriginalWalletServiceAdmissionReceiptRaw} from './original-wallet-service-admission.js';
const fail=(code='WALLET_SERVICE_ADMISSION_INSTALLER_NOT_CONFIGURED')=>{throw new WalletAuthError(code,'Original protected service receipt installation is unavailable');};
const hash=b=>createHash('sha256').update(b).digest('hex');
const uid=process.getuid?.();
const identity=s=>({dev:s.dev,ino:s.ino,mode:s.mode,uid:s.uid});
const same=(s,v)=>s.dev===v.dev&&s.ino===v.ino&&s.mode===v.mode&&s.uid===v.uid;
// Owner/private main supplies this fixed target. No renderer path, ENV,
// project document, callback header or receipt chooses an installer target.
export function installOriginalWalletServiceAdmissionReceipt(sourceSelection,privateTarget,signedRaw,originalGuard,originalNow){
 if(!originalGuard||typeof originalGuard.assert!=='function'||types.isProxy(originalGuard)||typeof originalNow!=='function'||types.isProxy(originalNow))fail();
 const source=captureOriginalRecoveryJSON(sourceSelection),target=captureOriginalRecoveryJSON(privateTarget);
 exactFields(source,['rootPath','rootDigest','rolePath','roleDigest'],'Fixed independently approved admission source');
 exactFields(target,['directory','expectedRequest'],'Original private native installer target');
 if(typeof target.directory!=='string'||!isAbsolute(target.directory)||resolve(target.directory)!==target.directory||typeof signedRaw!=='string'||Buffer.byteLength(signedRaw)>16384)fail();
 const raw=captureOriginalRecoveryJSON(JSON.parse(signedRaw)),text=canonicalJSON(raw);
 if(text!==signedRaw)fail();const expected=prepareOriginalWalletServiceAdmissionReview(target.expectedRequest);
 if(canonicalJSON(raw.request)!==expected.requestRaw||raw.reviewDigest!==expected.reviewDigest)fail('WALLET_SERVICE_ADMISSION_BINDING_MISMATCH');
 const nonce=target.expectedRequest.requestNonce,digest=hash(Buffer.from(text));
 // Original fixed request validation checks canonical nonce before filenames.
 const finalPath=join(target.directory,nonce+'.admission.json'),tempPath=join(target.directory,nonce+'.incoming');
 let floor=-1;const now=()=>{const value=originalNow();if(types.isProxy(value)||!(value instanceof Date))fail();const t=Date.prototype.getTime.call(value);if(!Number.isSafeInteger(t)||t<0||t<floor)fail('WALLET_SERVICE_ADMISSION_CLOCK_UNAVAILABLE');floor=t;return value;};
 const held=[];let tempFD=null;const directories=[];let path=target.directory;
 try{
  // Hold the entire original existing directory chain; never create directories
  // or follow aliases. Final target is private current UID, ancestors trusted
  // root/current UID and non-writable by other users.
  for(;;){directories.unshift(path);if(path===dirname(path))break;path=dirname(path);}
  for(const directory of directories){const before=lstatSync(directory);if(!before.isDirectory()||before.isSymbolicLink()||!Number.isInteger(uid)||!([0,uid].includes(before.uid))||(before.mode&0o022)!==0||directory===target.directory&&(before.uid!==uid||(before.mode&0o077)!==0))fail('WALLET_SERVICE_ADMISSION_INSTALL_CUSTODY');const fd=openSync(directory,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);held.push({fd,path:directory,id:identity(before)});if(!same(fstatSync(fd),identity(before)))fail();}
  const check=()=>{originalGuard.assert();const t=Date.prototype.getTime.call(now());if(!Number.isSafeInteger(raw.expiresAtMs)||t>=raw.expiresAtMs)fail('WALLET_SERVICE_ADMISSION_EXPIRED');for(const h of held){if(!same(fstatSync(h.fd),h.id)||!same(lstatSync(h.path),h.id))fail('WALLET_SERVICE_ADMISSION_INSTALL_SOURCE_CHANGED');}};
  const verify=receiptPath=>{check();const admission=prepareOriginalWalletServiceAdmission(source,{receiptPath,receiptDigest:digest},target.expectedRequest,now);admission.assertCurrent({service:target.expectedRequest.service,productId:target.expectedRequest.productId,platform:target.expectedRequest.platform,gatewayOrigin:target.expectedRequest.gatewayOrigin,operation:'restore'});check();return admission;};
  // Every retry repairs the EXACT original inode/file+directory durability.
  // Merely seeing complete bytes/EEXIST/nlink1 never proves prior fsync success.
  const durable= (receiptPath,links)=>{
   check();const before=lstatSync(receiptPath);
   if(!before.isFile()||before.isSymbolicLink()||before.uid!==uid||(before.mode&0o077)!==0||before.nlink!==links||before.size!==Buffer.byteLength(text))fail('WALLET_SERVICE_ADMISSION_INSTALL_CUSTODY');
   const fd=openSync(receiptPath,constants.O_RDONLY|constants.O_NOFOLLOW);
   const exact=()=>{const current=fstatSync(fd);if(!same(current,identity(before))||current.nlink!==links||current.size!==before.size||!same(lstatSync(receiptPath),identity(before)))fail('WALLET_SERVICE_ADMISSION_INSTALL_SOURCE_CHANGED');const b=Buffer.alloc(16385);let size=0;for(;;){const n=readSync(fd,b,size,b.length-size,size);if(n===0)break;size+=n;if(size===b.length)fail();}if(size!==Buffer.byteLength(text)||hash(b.subarray(0,size))!==digest)fail('WALLET_SERVICE_ADMISSION_BINDING_MISMATCH');};
   try{exact();check();exact();fsyncSync(fd);fsyncSync(held.at(-1).fd);check();exact();}finally{closeSync(fd);}
  };
  check();validateOriginalWalletServiceAdmissionReceiptRaw(source,text,target.expectedRequest,now);check();let finalExists=false;try{lstatSync(finalPath);finalExists=true;}catch(e){if(e.code!=='ENOENT')throw e;}
  if(finalExists){
   const existing=lstatSync(finalPath);
   if(existing.nlink===2){
    // Recover only the exact retained incoming link from this original nonce.
    // Actual same-Vault raw and independent signature/current verified above.
    const incoming=lstatSync(tempPath);
    if(!existing.isFile()||existing.isSymbolicLink()||existing.uid!==uid||(existing.mode&0o077)!==0||!incoming.isFile()||incoming.isSymbolicLink()||incoming.dev!==existing.dev||incoming.ino!==existing.ino||incoming.nlink!==2)fail();
    const fd=openSync(finalPath,constants.O_RDONLY|constants.O_NOFOLLOW);try{if(!same(fstatSync(fd),identity(existing)))fail();const buf=Buffer.alloc(16385);let size=0;for(;;){const count=readSync(fd,buf,size,buf.length-size,null);if(count===0)break;size+=count;if(size===buf.length)fail();}if(size!==Buffer.byteLength(text)||hash(buf.subarray(0,size))!==digest)fail();}finally{closeSync(fd);}
    check();validateOriginalWalletServiceAdmissionReceiptRaw(source,text,target.expectedRequest,now);check();
    const currentFinal=lstatSync(finalPath),currentIncoming=lstatSync(tempPath);if(!same(currentFinal,identity(existing))||!same(currentIncoming,identity(incoming))||currentFinal.nlink!==2||currentIncoming.nlink!==2)fail();
    durable(finalPath,2);
    unlinkSync(tempPath);fsyncSync(held.at(-1).fd);
   }
   readOriginalOperationProtectedSource(finalPath,digest);verify(finalPath);
  }
  else{
   // The final file is write-once. A retained incoming file must be EXACT the
   // same original signed bytes; uncertainty never creates a new signature.
   try{tempFD=openSync(tempPath,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);const bytes=Buffer.from(text);let offset=0;while(offset<bytes.length){check();const wrote=writeSync(tempFD,bytes,offset,bytes.length-offset);if(wrote<=0)fail();offset+=wrote;}fsyncSync(tempFD);closeSync(tempFD);tempFD=null;fsyncSync(held.at(-1).fd);}catch(e){if(e.code!=='EEXIST')throw e;}
   readOriginalOperationProtectedSource(tempPath,digest);verify(tempPath);durable(tempPath,1);check();
   // link is atomic no-replace; no old receipt/UNKNOWN can be overwritten.
   linkSync(tempPath,finalPath);fsyncSync(held.at(-1).fd);check();
   const a=lstatSync(tempPath),b=lstatSync(finalPath);if(a.dev!==b.dev||a.ino!==b.ino||a.nlink!==2||b.nlink!==2||a.uid!==uid||b.uid!==uid)fail();
   unlinkSync(tempPath);fsyncSync(held.at(-1).fd);verify(finalPath);
  }
  // Last original current/time callback finishes before bounded immutable file
  // checks. No permission/current is inferred from successful installation.
  verify(finalPath);durable(finalPath,1);verify(finalPath);check();
  readOriginalOperationProtectedSource(source.rootPath,source.rootDigest);readOriginalOperationProtectedSource(source.rolePath,source.roleDigest);readOriginalOperationProtectedSource(finalPath,digest);
  for(const h of held)if(!same(fstatSync(h.fd),h.id)||!same(lstatSync(h.path),h.id))fail('WALLET_SERVICE_ADMISSION_INSTALL_SOURCE_CHANGED');
  return Object.freeze({requestNonce:nonce,receiptDigest:digest,receiptSelection:Object.freeze({receiptPath:finalPath,receiptDigest:digest}),expectedRequest:captureOriginalRecoveryJSON(target.expectedRequest),installed:true,serviceAdmitted:false});
 }finally{if(tempFD!==null)try{closeSync(tempFD);}catch{}for(const h of held.reverse())try{closeSync(h.fd);}catch{}}
 // On any refusal preserve original Vault signed/UNKNOWN record and any
 // installer bytes. Never erase, overwrite, re-sign or renew expiry here.
}
