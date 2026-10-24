import {createHash} from 'node:crypto';
import {openSync,readSync,fstatSync,closeSync,lstatSync,realpathSync,constants} from 'node:fs';
import path from 'node:path';
export const SDK14_RUNTIME_UNION=Object.freeze({bytes:1453193,sha256:'bf1826a33910b8c2879316a64f5b8c84f5280d26dbdc3b5ee23157b8a2736b5d',files:9335,totalBytes:77245456});
export const SDK18_RUNTIME_UNION=Object.freeze({bytes:1453193,sha256:'774c520036f356e93e7f58333a8f64f98cf71c7b439b1d550f06a4b69a589f85',files:9335,totalBytes:77260211});
export const SDK19_RUNTIME_UNION=Object.freeze({bytes:1453193,sha256:'a208e293f36e624cd52bb9f8328c4c92d715e1f72c63ad1c07d18c5031edcdbc',files:9335,totalBytes:77265325});
export const SDK20_RUNTIME_UNION=Object.freeze({bytes:1453195,sha256:'6cfd7cdf412c007eb827096afb6eb8358ad0981debe2c40bc710f221b74b7b3a',files:9335,totalBytes:77271135});
export const SDK23_RUNTIME_UNION=Object.freeze({bytes:1454232,sha256:'dc4427a01bad707eaae9861b92e22b251dc83ac3d2b9535b576b162df1e60b84',files:9342,totalBytes:77355747});
export const SDK26_RUNTIME_UNION=Object.freeze({bytes:1455441,sha256:'98d83dffd7688cca98db4e421d26b3ed6c355686845087148b82bfa0c527202a',files:9350,totalBytes:77402024});
export const SDK28_RUNTIME_UNION=Object.freeze({bytes:1455585,sha256:'abea187a58c2700834c16b0f9f594547c2d293ff46b988f1fbde66b38dcbe9b3',files:9351,totalBytes:77412980});
export const SDK31_RUNTIME_UNION=Object.freeze({bytes:1464442,sha256:'2070d6ca11b27693fa8d21b97fef71315aab89b2ef6b861105d087fa4657facc',files:9413,totalBytes:77777339});
export const SDK32_RUNTIME_UNION=Object.freeze({bytes:1466009,sha256:'7543115cdd892e2a84c2af71a3e99200c17dd760ab0bcd4823df824748658e32',files:9424,totalBytes:77829265});
export const SDK33_RUNTIME_UNION=Object.freeze({bytes:1466009,sha256:'692bdcb8511e50bf75d6ad18868e87ffc248d22a4075143048db696dec693eed',files:9424,totalBytes:77830031});
export const SDK34_RUNTIME_UNION=Object.freeze({bytes:1466009,sha256:'798649f0d8859d27a20a99a283c8af1d53866ad35908648db1b2a8e1d8e5b1db',files:9424,totalBytes:77830151});
export const SDK35_RUNTIME_UNION=Object.freeze({bytes:1466281,sha256:'7fc9b57edc5747e630b44c430dfe93891af1ab791749de141307be223d5848fd',files:9426,totalBytes:77838348});
export const SDK36_RUNTIME_UNION=Object.freeze({bytes:1466281,sha256:'898e42a7f2aa2e5a8a9b4d8e8b2c958bf1d318299dc30f733c0617299d7039e4',files:9426,totalBytes:77841819});
export const SDK37_RUNTIME_UNION=Object.freeze({bytes:1466281,sha256:'a9e6c4469e797855b0afc2fa4e73c56b347ece595a377ddaaa4ee1e4175d7d0d',files:9426,totalBytes:77841875});
export const SDK38_RUNTIME_UNION=Object.freeze({bytes:1466422,sha256:'e33dcc503602b81096e8040dde25c384a134a6bf11bbb7c88ea973fdda7afa09',files:9427,totalBytes:77860268});
export const SDK_RUNTIME_UNIONS=Object.freeze({'1.3.0-pq.3.32-auth.14':SDK14_RUNTIME_UNION,'1.3.0-pq.3.32-auth.18':SDK18_RUNTIME_UNION,'1.3.0-pq.3.32-auth.19':SDK19_RUNTIME_UNION,'1.3.0-pq.3.32-auth.20':SDK20_RUNTIME_UNION,'1.3.0-pq.3.32-auth.23':SDK23_RUNTIME_UNION,'1.3.0-pq.3.32-auth.26':SDK26_RUNTIME_UNION,'1.3.0-pq.3.32-auth.28':SDK28_RUNTIME_UNION,'1.3.0-pq.3.32-auth.31':SDK31_RUNTIME_UNION,'1.3.0-pq.3.32-auth.32':SDK32_RUNTIME_UNION,'1.3.0-pq.3.32-auth.33':SDK33_RUNTIME_UNION,'1.3.0-pq.3.32-auth.34':SDK34_RUNTIME_UNION,'1.3.0-pq.3.32-auth.35':SDK35_RUNTIME_UNION,'1.3.0-pq.3.32-auth.36':SDK36_RUNTIME_UNION,'1.3.0-pq.3.32-auth.37':SDK37_RUNTIME_UNION,'1.3.0-pq.3.32-auth.38':SDK38_RUNTIME_UNION});
export function sdkRuntimeUnionProfile(version){if(typeof version!=='string'||!Object.hasOwn(SDK_RUNTIME_UNIONS,version))throw Error('WALLET_RUNTIME_UNION_VERSION_UNSUPPORTED');return SDK_RUNTIME_UNIONS[version];}
export const SDK14_RUNTIME_UNION_SOURCE='packages/wallet-auth/native/original-ide-contract-relay-runtime-manifest.json';
const sha=b=>createHash('sha256').update(b).digest('hex');
/** Build-only exact source image readback. Never executes/imports SDK code,
 * admits a Native Source, raises FD limits or qualifies an installed image.
 * A retains the original same-package union, not parent13 or a self manifest.
 */
export function verifySDK14RuntimeUnion(root,manifestBytes){
 return verifySDKRuntimeUnion('1.3.0-pq.3.32-auth.14',root,manifestBytes);
}
/** Same strict bounded reader, explicit frozen version selection only. */
export function verifySDKRuntimeUnion(version,root,manifestBytes){
 const pin=sdkRuntimeUnionProfile(version),tag='SDK'+version.split('.').at(-1),fail=()=>{throw Error(`WALLET_${tag}_RUNTIME_UNION_DIFFERS`)};
 if(typeof root!=='string'||!path.isAbsolute(root)||path.normalize(root)!==root||realpathSync(root)!==root||!Buffer.isBuffer(manifestBytes)||manifestBytes.length!==pin.bytes||sha(manifestBytes)!==pin.sha256)fail();
 const body=JSON.parse(manifestBytes),files=body.files;
 if(body.version!=='YNX-ORIGINAL-AUTH-RUNTIME-CLOSURE/v1'||Object.keys(body).join(',')!=='files,version'||!Array.isArray(files)||files.length!==pin.files||!Buffer.from(JSON.stringify(body)).equals(manifestBytes))fail();
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
  finally{if(fd!==undefined)try{closeSync(fd);}catch(error){if(failed)throw Object.assign(Error(`WALLET_${tag}_RUNTIME_READ_UNCONFIRMED`),{cause,cleanupCause:error});throw error;}}
  if(failed)throw cause;
  total+=bytes.length;previous=row.path;
 }
 if(total!==pin.totalBytes)fail();
 return Object.freeze({...pin,filesVerified:files.length,sourceRoot:root,NativeAdmission:false,installedImageQualified:false,platformQualified:false,networkActivated:false});
}
