import {openSync,closeSync,fstatSync,lstatSync,readSync,constants} from 'node:fs';
import {isAbsolute,dirname,resolve,sep} from 'node:path';
import {createHash} from 'node:crypto';
import {canonicalJSON,exactFields,WalletAuthError} from './canonical.js';
import {parsePrivateBusinessRegistrations} from './product-session-registry.js';
import {captureOriginalRecoveryJSON} from './original-operation-recovery-state.js';
import {createOriginalBackendOperationAuthenticator} from './original-backend-operation-auth.js';
import {ProductSessionControlNodeHost} from './product-session-control-node-host.js';
const fail=code=>{throw new WalletAuthError(code,'Original registered operation startup is unavailable');};
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const stamp=s=>[s.dev,s.ino,s.mode,s.uid,s.nlink,s.size,s.mtimeMs,s.ctimeMs].join(':');
const sync=value=>{if(value&&typeof value.then==='function')fail('ORIGINAL_OPERATION_SOURCE_ASYNC');if(value!==undefined)fail('ORIGINAL_OPERATION_SOURCE_INVALID');};

// Operator source custody only, not enrollment or permission. Every ancestor FD
// stays open through bounded read and final name/identity checks. Symlinks,
// writable ancestry, hardlinks and mutated same-inode content are refused.
export function readOriginalOperationProtectedSource(file,expectedDigest){
 if(typeof file!=='string'||!isAbsolute(file)||resolve(file)!==file||file.endsWith(sep)||!/^[0-9a-f]{64}$/.test(expectedDigest))fail('ORIGINAL_OPERATION_SOURCE_UNAVAILABLE');
 const names=[];for(let path=dirname(file);;path=dirname(path)){names.unshift(path);if(path===dirname(path))break;}
 const held=[];let fd;
 try{
  for(const name of names){
   const before=lstatSync(name);if(!before.isDirectory()||before.isSymbolicLink()||(before.mode&0o022))fail('ORIGINAL_OPERATION_SOURCE_PATH_INVALID');
   const dir=openSync(name,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);
   held.push({name,fd:dir,identity:stamp(fstatSync(dir))});
   if(stamp(before)!==held.at(-1).identity)fail('ORIGINAL_OPERATION_SOURCE_CHANGED');
  }
  const before=lstatSync(file);if(!before.isFile()||before.isSymbolicLink()||before.nlink!==1||(before.mode&0o077)||typeof process.getuid!=='function'||before.uid!==process.getuid()||before.size<2||before.size>65536)fail('ORIGINAL_OPERATION_SOURCE_PATH_INVALID');
  fd=openSync(file,constants.O_RDONLY|constants.O_NOFOLLOW);const first=fstatSync(fd);
  if(stamp(first)!==stamp(before))fail('ORIGINAL_OPERATION_SOURCE_CHANGED');
  const buffer=Buffer.alloc(65537);let size=0;
  while(size<buffer.length){const count=readSync(fd,buffer,size,buffer.length-size,null);if(count===0)break;size+=count;}
  if(size>65536||size!==first.size)fail('ORIGINAL_OPERATION_SOURCE_CHANGED');
  const bytes=buffer.subarray(0,size);if(sha(bytes)!==expectedDigest)fail('ORIGINAL_OPERATION_SOURCE_DIGEST_MISMATCH');
  if(stamp(fstatSync(fd))!==stamp(first)||stamp(lstatSync(file))!==stamp(first))fail('ORIGINAL_OPERATION_SOURCE_CHANGED');
  for(const h of held)if(stamp(fstatSync(h.fd))!==h.identity||stamp(lstatSync(h.name))!==h.identity)fail('ORIGINAL_OPERATION_SOURCE_CHANGED');
  // Return a detached copy; no fd, live buffer, key handle or authority leaked.
  return Buffer.from(bytes);
 }catch(error){if(error instanceof WalletAuthError)throw error;fail('ORIGINAL_OPERATION_SOURCE_UNAVAILABLE');}
 finally{if(fd!==undefined)closeSync(fd);for(const h of held.reverse())closeSync(h.fd);}
}

// Config-before-state actual original Host factory. Missing roster/current
// producers refuse before any original state file is opened. A protected config
// and exact old registry binding select source; they do NOT attest a new purpose.
export function prepareOriginalRegisteredOperationHost(registryInput,options){
 exactFields(options,['sourcePath','expectedSourceDigest','assertOriginalRegistrationRosterCurrent','assertOriginalRegisteredSourceCurrent','originalNow'],'Original operation protected startup');
 const {sourcePath,expectedSourceDigest,assertOriginalRegistrationRosterCurrent:rosterCurrent,assertOriginalRegisteredSourceCurrent:sourceCurrent,originalNow}=options;
 if(typeof rosterCurrent!=='function'||typeof sourceCurrent!=='function'||typeof originalNow!=='function')fail('ORIGINAL_OPERATION_REGISTRATION_UNAVAILABLE');
 const registry=captureOriginalRecoveryJSON(registryInput);
 const bytes=readOriginalOperationProtectedSource(sourcePath,expectedSourceDigest);
 let config;try{config=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{fail('ORIGINAL_OPERATION_SOURCE_INVALID');}
 config=captureOriginalRecoveryJSON(config);
 exactFields(config,['version','registryDigest','registrations'],'Original operation protected declaration');
 if(config.version!=='ynx-original-operation-source/v1'||config.registryDigest!==sha(canonicalJSON(registry))||!Array.isArray(config.registrations)||config.registrations.length===0)fail('ORIGINAL_OPERATION_SOURCE_INVALID');
 const bindings=parsePrivateBusinessRegistrations(registry,config.registrations.map(r=>({productId:r.productId,platform:r.platform,keyId:r.keyId,allowedScopes:r.scopes})));
 for(let index=0;index<bindings.length;index++){
  const binding=bindings[index],declared=config.registrations[index];
  if(binding.clientId!==declared.clientId||binding.backendClientId!==declared.backendClientId||canonicalJSON(binding.allowedScopes)!==canonicalJSON(declared.scopes)||declared.sourceDigest!==expectedDigestForRegistration(config,index))fail('ORIGINAL_OPERATION_REGISTRATION_MISMATCH');
 }
 function expectedDigestForRegistration(value,index){return sha(canonicalJSON({version:value.version,registryDigest:value.registryDigest,registration:{...value.registrations[index],sourceDigest:null}}));}
 let floor=-Infinity;
 const freshClock=()=>{const at=originalNow();if(!(at instanceof Date)||!Number.isFinite(at.getTime())||at.getTime()<floor)fail('ORIGINAL_OPERATION_CLOCK_UNAVAILABLE');floor=at.getTime();return floor;};
 const checkRoster=()=>{
  freshClock();readOriginalOperationProtectedSource(sourcePath,expectedSourceDigest);
  sync(rosterCurrent(config.registrations,registry));
  // The final external roster callback may change its protected source. A
  // normal return never proves the named file remains the captured declaration.
  freshClock();readOriginalOperationProtectedSource(sourcePath,expectedSourceDigest);
 };
 checkRoster();
 const authenticator=createOriginalBackendOperationAuthenticator({registrations:config.registrations,assertOriginalRegisteredSourceCurrent:(registration,context,at)=>{checkRoster();sync(sourceCurrent(registration,context,at));freshClock();readOriginalOperationProtectedSource(sourcePath,expectedSourceDigest);},originalNow});
 return Object.freeze({sourceDigest:expectedSourceDigest,assertOriginalSourceCurrent:checkRoster,assertOriginalSourceUnchanged(){readOriginalOperationProtectedSource(sourcePath,expectedSourceDigest);},openOriginal(hostOptions){
  // Immutable capture of actual Host options is performed by its original
  // constructor; new authenticator cannot be overridden by the caller.
  checkRoster();const host=new ProductSessionControlNodeHost(registry,{...hostOptions,now:originalNow,originalBackendOperationAuthenticator:authenticator});checkRoster();return host;
 }});
}
