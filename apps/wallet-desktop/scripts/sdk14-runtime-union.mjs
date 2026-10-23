import {createHash} from 'node:crypto';
import {openSync,readSync,fstatSync,closeSync,lstatSync,realpathSync,constants} from 'node:fs';
import path from 'node:path';
export const SDK14_RUNTIME_UNION=Object.freeze({bytes:1453193,sha256:'bf1826a33910b8c2879316a64f5b8c84f5280d26dbdc3b5ee23157b8a2736b5d',files:9335,totalBytes:77245456});
export const SDK14_RUNTIME_UNION_SOURCE='packages/wallet-auth/native/original-ide-contract-relay-runtime-manifest.json';
const sha=b=>createHash('sha256').update(b).digest('hex');
const fail=()=>{throw Error('WALLET_SDK14_RUNTIME_UNION_DIFFERS');};
/** Build-only exact source image readback. Never executes/imports SDK code,
 * admits a Native Source, raises FD limits or qualifies an installed image.
 * A retains the original same-package union, not parent13 or a self manifest.
 */
export function verifySDK14RuntimeUnion(root,manifestBytes){
 if(typeof root!=='string'||!path.isAbsolute(root)||path.normalize(root)!==root||realpathSync(root)!==root||!Buffer.isBuffer(manifestBytes)||manifestBytes.length!==SDK14_RUNTIME_UNION.bytes||sha(manifestBytes)!==SDK14_RUNTIME_UNION.sha256)fail();
 const body=JSON.parse(manifestBytes),files=body.files;
 if(body.version!=='YNX-ORIGINAL-AUTH-RUNTIME-CLOSURE/v1'||Object.keys(body).join(',')!=='files,version'||!Array.isArray(files)||files.length!==SDK14_RUNTIME_UNION.files||!Buffer.from(JSON.stringify(body)).equals(manifestBytes))fail();
 let previous='',total=0;
 for(const row of files){
  if(Object.keys(row).join(',')!=='bytes,path,sha256'||typeof row.path!=='string'||!row.path||row.path<=previous||row.path.startsWith('/')||row.path.includes('\\')||row.path.split('/').some(p=>!p||p==='.'||p==='..')||row.path==='native/original-ide-contract-relay-runtime-manifest.json'||!Number.isSafeInteger(row.bytes)||row.bytes<0||row.bytes>16777216||!/^[a-f0-9]{64}$/.test(row.sha256))fail();
  const file=path.join(root,row.path);if(realpathSync(file)!==file)fail();
  let fd,bytes,before,failed=false,cause;
  try{
   fd=openSync(file,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);before=fstatSync(fd);
   if(!before.isFile()||before.size!==row.bytes)fail();bytes=Buffer.alloc(row.bytes);let at=0;
   while(at<bytes.length){const n=readSync(fd,bytes,at,bytes.length-at,null);if(!n)fail();at+=n;}
   if(readSync(fd,Buffer.alloc(1),0,1,null)!==0)fail();
   for(const after of [fstatSync(fd),lstatSync(file)])if(!after.isFile()||after.isSymbolicLink()||['dev','ino','size','mode','uid','mtimeMs','ctimeMs'].some(k=>before[k]!==after[k]))fail();
   if(sha(bytes)!==row.sha256)fail();
  }catch(error){failed=true;cause=error;}
  finally{if(fd!==undefined)try{closeSync(fd);}catch(error){if(failed)throw Object.assign(Error('WALLET_SDK14_RUNTIME_READ_UNCONFIRMED'),{cause,cleanupCause:error});throw error;}}
  if(failed)throw cause;
  total+=bytes.length;previous=row.path;
 }
 if(total!==SDK14_RUNTIME_UNION.totalBytes)fail();
 return Object.freeze({...SDK14_RUNTIME_UNION,filesVerified:files.length,sourceRoot:root,NativeAdmission:false,installedImageQualified:false,platformQualified:false,networkActivated:false});
}
