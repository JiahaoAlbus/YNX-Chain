import * as fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {types} from 'node:util';
import {PrivateFilePolicy} from './platform-private-file.mjs';
import {exactData} from './features/pq-transaction/transfer-binding.mjs';
import {preparePQFinalityOriginal as preparePQTransferOriginal,bindPQFinalityContext as bindPQTransferFinalityContext} from './wallet-pq-finality-original.mjs';
import {preparePQHostSourceRequest} from './wallet-pq-host-context.mjs';
const roles=[['migration','migration.json',1<<30],['genesis','genesis.json',64<<20],['state','committed-state.json',1<<30],['schedule','schedule.json',32768],['runtime','runtime-plan.json',4096],['trustedLightBlock','trusted-light-block.json',10<<20],['context','trust-context.json',44781228],['lifecycle','lifecycle.json',4096],['source','host-source.json',16384]];
const fields={manifest:['version','sourceId','epoch','binding','sourceFile','sourceSHA256','files','totalBytes'],binding:['operationId','account','networkId','originalHash','nativeWireHash','transactionHash'],file:['role','name','bytes','sha256'],source:['version','sourceId','epoch','contextFile','contextSHA256','lifecycleFile','lifecycleSHA256','migrationSHA256','genesisSHA256','stateSHA256','scheduleSHA256','runtimePlanSHA256','trustedLightBlockSHA256'],lifecycle:['version','sourceId','epoch','status']};
const hash=b=>createHash('sha256').update(b).digest('hex');
const fail=code=>{throw Object.assign(Error(code),{code});};
const invalid=()=>fail('PQ_HOST_DELIVERY_INVALID');
function exact(v,keys){if(types.isProxy(v))invalid();exactData(v,keys,'PQ_HOST_DELIVERY_INVALID');}
function digest(v){if(typeof v!=='string'||! /^[a-f0-9]{64}$/.test(v)||/^0{64}$/.test(v))invalid();return v;}
function absolute(v){if(typeof v!=='string'||!path.isAbsolute(v)||path.normalize(v)!==v||v===path.parse(v).root||v.includes('\0')||Buffer.byteLength(v)>4096||Buffer.from(v).toString()!==v)invalid();return v;}
function integer(v,max){if(typeof v!=='string'||! /^[1-9][0-9]{0,19}$/.test(v)||BigInt(v)>BigInt(max))invalid();return BigInt(v);}
// Bounded string/object/array grammar. Reject duplicate decoded keys, BOM,
// numbers, prototype aliases and arbitrary nesting before ordinary JSON parse.
function json(raw){
 let text;try{text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(raw);}catch{invalid();}
 let at=0;const space=()=>{while(/[ \t\r\n]/.test(text[at]??'!'))at++;};
 const string=()=>{const start=at;if(text[at++]!=='"')invalid();while(at<text.length){const c=text.charCodeAt(at++);if(c===34){try{return JSON.parse(text.slice(start,at));}catch{invalid();}}if(c<32)invalid();if(c===92)at++;}invalid();};
 const value=depth=>{if(depth>4)invalid();space();if(text[at]==='"')return string();if(text[at]==='['){at++;const out=[];space();if(text[at]!==']')for(;;){if(out.length>=9)invalid();out.push(value(depth+1));space();if(text[at]===']')break;if(text[at++]!==',')invalid();}at++;return out;}if(text[at]!=='{')invalid();at++;const out={},seen=new Set();space();if(text[at]!=='}')for(;;){space();const k=string();if(seen.has(k)||['__proto__','constructor','prototype'].includes(k))invalid();seen.add(k);space();if(text[at++]!==':')invalid();out[k]=value(depth+1);space();if(text[at]==='}')break;if(text[at++]!==',')invalid();}at++;return out;};
 const result=value(0);space();if(at!==text.length)invalid();return result;
}
const statKeys=['dev','ino','size','mode','uid','nlink','mtimeMs','ctimeMs'];
function same(a,b){if(statKeys.some(k=>a[k]!==b[k]))fail('PQ_HOST_DELIVERY_CHANGED');}
function sourceStat(s){if(!s.isFile()||s.nlink!==1||(s.mode&0o022)!==0||typeof process.getuid==='function'&&![0,process.getuid()].includes(s.uid))invalid();}
async function read(file,pin,{capture=false,destination=null,policy=null,guard,privateFile=false}={}){
 let input,output,cause;const chunks=[];let result;
 try{
  guard.assert();if(await fs.realpath(file)!==file)invalid();input=await fs.open(file,constants.O_RDONLY|(constants.O_NOFOLLOW??0)|(constants.O_NONBLOCK??0));const before=await input.stat();sourceStat(before);if(before.size!==pin.bytes||privateFile&&((before.mode&0o077)!==0||typeof process.getuid==='function'&&before.uid!==process.getuid()))invalid();
  if(destination){output=await fs.open(destination,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|(constants.O_NOFOLLOW??0),0o600);await policy.protect(destination);}
  const h=createHash('sha256'),buffer=Buffer.alloc(Math.min(pin.bytes,1<<20));let total=0;
  while(total<pin.bytes){guard.assert();const n=await input.read(buffer,0,Math.min(buffer.length,pin.bytes-total),null);if(!n.bytesRead)invalid();const chunk=buffer.subarray(0,n.bytesRead);h.update(chunk);if(capture)chunks.push(Buffer.from(chunk));if(output)await output.writeFile(chunk);total+=n.bytesRead;}
  if(h.digest('hex')!==pin.sha256)fail('PQ_HOST_DELIVERY_PIN_MISMATCH');same(before,await input.stat());const entry=await fs.lstat(file);sourceStat(entry);same(before,entry);if(await fs.realpath(file)!==file)invalid();
  if(output){await output.sync();await policy.assertPrivate(destination,await output.stat());}
  guard.assert();result=capture?Buffer.concat(chunks,total):null;
 }catch(e){cause=e;}
 finally{for(const handle of [output,input])try{await handle?.close();}catch(e){if(cause){if(!Object.hasOwn(cause,'cleanupCause'))cause.cleanupCause=e;}else cause=e;}}
 if(cause)throw cause;return result;
}
async function write(file,bytes,policy){let handle,cause;try{handle=await fs.open(file,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|(constants.O_NOFOLLOW??0),0o600);await policy.protect(file);await handle.writeFile(bytes);await handle.sync();await policy.assertPrivate(file,await handle.stat());}catch(e){cause=e;}finally{try{await handle?.close();}catch(e){if(cause)cause.cleanupCause=e;else cause=e;}}if(cause)throw cause;}
async function syncDirectory(directory){const h=await fs.open(directory,'r');try{await h.sync();}finally{await h.close();}}
function catalogFor(manifestRaw,original,binding){
 const own=preparePQTransferOriginal(original,binding),manifest=json(manifestRaw);exact(manifest,fields.manifest);exact(manifest.binding,fields.binding);
 if(manifest.version!=='YNX-CONSENSUS-PROOF-HOST-DELIVERY/v1'||manifest.sourceFile!=='host-source.json'||!Array.isArray(manifest.files)||![8,9].includes(manifest.files.length))invalid();
 // Protocol DELIVERY originalHash names native bytes, not the Wallet typed
 // journal's full-transport key. Bind both explicitly rather than aliasing.
 const nativeHash=own.original.kind==='pq-typed-action'?own.original.typed.memberHash:own.original.hash;
 const expected={operationId:own.original.operationId,account:own.original.account,networkId:own.binding.chainId,originalHash:nativeHash,nativeWireHash:nativeHash.slice(2),transactionHash:own.binding.abciTransactionHash.slice(2)};
 if(Object.entries(expected).some(([k,v])=>manifest.binding[k]!==v))fail('PQ_HOST_DELIVERY_ORIGINAL_MISMATCH');
 const layout=roles.filter(([r])=>manifest.files.length===9||r!=='runtime'),catalog=new Map();let total=0n;
 for(let i=0;i<layout.length;i++){const f=manifest.files[i],[role,name,max]=layout[i];exact(f,fields.file);if(f.role!==role||f.name!==name)invalid();const size=integer(f.bytes,max);digest(f.sha256);total+=size;catalog.set(role,{name,bytes:Number(size),sha256:f.sha256});}
 if(integer(manifest.totalBytes,18446744073709551615n)!==total||digest(manifest.sourceSHA256)!==catalog.get('source').sha256)invalid();
 return {manifest,layout,catalog,total};
}
function materialFor(catalog,manifest,small,original,binding){
 const source=json(small.source),lifecycle=json(small.lifecycle);exact(source,fields.source);exact(lifecycle,fields.lifecycle);
 const selected=preparePQHostSourceRequest({sourcePath:absolute(source.contextFile),sourceSha256:manifest.sourceSHA256,sourceId:manifest.sourceId,epoch:manifest.epoch},'acquire').selection;
 if(source.version!=='YNX-CONSENSUS-PROOF-HOST-SOURCE/v1'||lifecycle.version!=='YNX-CONSENSUS-PROOF-HOST-LIFECYCLE/v1'||lifecycle.status!=='current'||source.sourceId!==selected.sourceId||source.epoch!==selected.epoch||lifecycle.sourceId!==selected.sourceId||lifecycle.epoch!==selected.epoch)invalid();
 const pins={context:'contextSHA256',lifecycle:'lifecycleSHA256',migration:'migrationSHA256',genesis:'genesisSHA256',state:'stateSHA256',schedule:'scheduleSHA256',runtime:'runtimePlanSHA256',trustedLightBlock:'trustedLightBlockSHA256'};
 for(const [role,key]of Object.entries(pins))if(source[key]!== (catalog.get(role)?.sha256??''))fail('PQ_HOST_DELIVERY_PIN_MISMATCH');
 const context=bindPQTransferFinalityContext(original,binding,small.context),oldRoot=absolute(path.dirname(absolute(source.contextFile)));
 const pathRoles={migrationFile:'migration',genesisFile:'genesis',stateFile:'state',scheduleFile:'schedule',runtimePlanFile:'runtime',trustedLightBlockFile:'trustedLightBlock'};
 if(source.contextFile!==path.join(oldRoot,'trust-context.json')||source.lifecycleFile!==path.join(oldRoot,'lifecycle.json')||context.lightTrust.trustedLightBlockSHA256!==source.trustedLightBlockSHA256)invalid();
 for(const [field,role]of Object.entries(pathRoles))if(context.lightTrust[field]!== (catalog.has(role)?path.join(oldRoot,catalog.get(role).name):''))invalid();
 return {source,selected,context,pathRoles};
}
function relocated(material,catalog,directory,original,binding){
 const {source,selected,context,pathRoles}=material,lightTrust={...context.lightTrust};for(const [field,role]of Object.entries(pathRoles))lightTrust[field]=catalog.has(role)?path.join(directory,catalog.get(role).name):'';
 const contextBytes=Buffer.from(JSON.stringify({version:'YNX-CONSENSUS-TRANSACTION-PROOF-TRUST/v1',lightTrust,expectedTransaction:context.expected}));bindPQTransferFinalityContext(original,binding,contextBytes);
 const contextPath=path.join(directory,'trust-context.json'),sourcePath=path.join(directory,'host-source.json'),sourceBytes=Buffer.from(JSON.stringify({...source,contextFile:contextPath,contextSHA256:hash(contextBytes),lifecycleFile:path.join(directory,'lifecycle.json')}));if(sourceBytes.length>16384)invalid();
 return {contextBytes,sourceBytes,contextPath,sourcePath,selection:preparePQHostSourceRequest({sourcePath,sourceSha256:hash(sourceBytes),sourceId:selected.sourceId,epoch:selected.epoch},'acquire').selection};
}
/** Original Protocol DELIVERY/v1 DATA receiver, not a supplier/grant factory.
 * Only private Main may call after a genuine operator opaqueRef/current action
 * and independently supplied manifest SHA. These arguments cannot establish
 * that provenance. No IPC, ENV, process, clock, signing or network fallback.
 * Failed/uncertain partial directories are retained; never overwrite or retry.
 */
export async function installOriginalProofHostDelivery({deliveryDirectory,deliverySha256,destinationDirectory,original,binding,guard}){
 absolute(deliveryDirectory);absolute(destinationDirectory);digest(deliverySha256);guard.assert();
 if(destinationDirectory===deliveryDirectory||destinationDirectory.startsWith(deliveryDirectory+path.sep))invalid();
 const own=preparePQTransferOriginal(original,binding);if(guard.account!==own.original.account)invalid();
 let created=false,originals=null;const parent=path.dirname(destinationDirectory);
 try{
  if(await fs.realpath(deliveryDirectory)!==deliveryDirectory)invalid();const dir=await fs.lstat(deliveryDirectory);if(!dir.isDirectory()||dir.isSymbolicLink()||(dir.mode&0o022)!==0)invalid();
  const manifestPath=path.join(deliveryDirectory,'delivery.json'),ms=await fs.lstat(manifestPath);if(ms.size<1||ms.size>16384)invalid();
  const manifestRaw=await read(manifestPath,{bytes:ms.size,sha256:deliverySha256},{capture:true,guard}),{manifest,layout,catalog,total}=catalogFor(manifestRaw,original,binding);
  const allowed=['delivery.json',...layout.map(([,name])=>name)].sort(),names=await fs.readdir(deliveryDirectory);if(JSON.stringify(names.sort())!==JSON.stringify(allowed))invalid();
  const small={};for(const role of ['context','lifecycle','source']){const p=catalog.get(role);small[role]=await read(path.join(deliveryDirectory,p.name),p,{capture:true,guard});}
  const material=materialFor(catalog,manifest,small,original,binding);
  if(await fs.realpath(parent)!==parent)invalid();const policy=new PrivateFilePolicy();await policy.directory(parent);guard.assert();
  const capacity=await fs.statfs(parent);if(BigInt(capacity.bavail)*BigInt(capacity.bsize)<total+BigInt(small.context.length+small.source.length)+(64n<<20n))fail('PQ_HOST_DELIVERY_STORAGE_UNAVAILABLE');
  await fs.mkdir(destinationDirectory,{mode:0o700});created=true;await policy.directory(destinationDirectory);originals=path.join(destinationDirectory,'original');await fs.mkdir(originals,{mode:0o700});await policy.directory(originals);await syncDirectory(parent);
  await write(path.join(originals,'delivery.json'),manifestRaw,policy);
  for(const [role,p]of catalog){const dest=path.join(['source','context'].includes(role)?originals:destinationDirectory,p.name);await read(path.join(deliveryDirectory,p.name),p,{destination:dest,policy,guard});await read(dest,p,{guard});}
  const {contextBytes,sourceBytes,contextPath,sourcePath,selection}=relocated(material,catalog,destinationDirectory,original,binding);
  guard.assert();await write(contextPath,contextBytes,policy);await read(contextPath,{bytes:contextBytes.length,sha256:hash(contextBytes)},{guard});await write(sourcePath,sourceBytes,policy);await read(sourcePath,{bytes:sourceBytes.length,sha256:hash(sourceBytes)},{guard});
  await syncDirectory(originals);await syncDirectory(destinationDirectory);await syncDirectory(parent);guard.assert();
  if(await fs.realpath(deliveryDirectory)!==deliveryDirectory||JSON.stringify((await fs.readdir(deliveryDirectory)).sort())!==JSON.stringify(allowed))fail('PQ_HOST_DELIVERY_CHANGED');
  return selection;
 }catch(cause){if(created)for(const directory of [originals,destinationDirectory,parent].filter(Boolean))try{await syncDirectory(directory);}catch(cleanupCause){if(cause&&typeof cause==='object'&&!Object.hasOwn(cause,'cleanupCause'))cause.cleanupCause=cleanupCause;}throw Object.assign(Error('PQ_HOST_DELIVERY_UNCONFIRMED'),{code:'PQ_HOST_DELIVERY_UNCONFIRMED',cause,partialDirectory:created?destinationDirectory:null,nativeGrant:false,independentFinality:false});}
}
/** Read-only cold DATA recovery. A fresh legitimate operator action must still
 * supply the independent original manifest pin. No local file grants current
 * authority and nothing is repaired, rewritten, installed or executed here. */
export async function readInstalledOriginalProofHostDelivery({directory,deliverySha256,original,binding,guard}){
 absolute(directory);digest(deliverySha256);guard.assert();const own=preparePQTransferOriginal(original,binding);if(guard.account!==own.original.account)invalid();
 try{
  const originals=path.join(directory,'original');
  for(const folder of [directory,originals]){if(await fs.realpath(folder)!==folder)invalid();const s=await fs.lstat(folder);if(!s.isDirectory()||s.isSymbolicLink()||(s.mode&0o077)!==0||typeof process.getuid==='function'&&s.uid!==process.getuid())invalid();}
  const manifestPath=path.join(originals,'delivery.json'),m=await fs.lstat(manifestPath);if(m.size<1||m.size>16384)invalid();const raw=await read(manifestPath,{bytes:m.size,sha256:deliverySha256},{capture:true,guard,privateFile:true}),{manifest,layout,catalog}=catalogFor(raw,original,binding);
  const rootNames=['original',...layout.map(([,name])=>name)].sort(),originalNames=['delivery.json','host-source.json','trust-context.json'];
  const checkNames=async()=>{if(JSON.stringify((await fs.readdir(directory)).sort())!==JSON.stringify(rootNames)||JSON.stringify((await fs.readdir(originals)).sort())!==JSON.stringify(originalNames))invalid();};await checkNames();
  const small={};for(const [role,p]of catalog){const file=path.join(['source','context'].includes(role)?originals:directory,p.name),capture=['source','context','lifecycle'].includes(role);const data=await read(file,p,{capture,guard,privateFile:true});if(capture)small[role]=data;}
  const result=relocated(materialFor(catalog,manifest,small,original,binding),catalog,directory,original,binding);
  await read(result.contextPath,{bytes:result.contextBytes.length,sha256:hash(result.contextBytes)},{guard,privateFile:true});await read(result.sourcePath,{bytes:result.sourceBytes.length,sha256:hash(result.sourceBytes)},{guard,privateFile:true});
  await checkNames();guard.assert();return result.selection;
 }catch(cause){throw Object.assign(Error('PQ_HOST_DELIVERY_RESTORE_UNVERIFIED'),{code:'PQ_HOST_DELIVERY_RESTORE_UNVERIFIED',cause,nativeGrant:false,independentFinality:false});}
}
