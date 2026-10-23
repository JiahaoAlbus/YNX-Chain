import * as fs from 'node:fs/promises';
import {constants} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {types} from 'node:util';
import path from 'node:path';
import {PrivateFilePolicy} from './platform-private-file.mjs';
import {exactData,preparePQTransferOriginal} from './features/pq-transaction/transfer-binding.mjs';
import {PQ_FINALITY_COLLECTOR_LIMITS} from './features/pq-transaction/finality-collector.mjs';
import {pqTypedOriginalSummary} from './wallet-pq-typed-original.mjs';

// Private Main evidence only. A stored HTTP body/context/CLI result establishes
// neither trust nor finality and never releases the original transaction.
const magic=Buffer.from('YNXPQFE1\n'),uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
// Protocol c3/034 transaction.go: context and stdin have different bounds.
// Count standard-base64 envelope/native wire plus the exact DTO overhead;
// these DATA caps do not establish the context's independent provenance.
const maxExpectedBytes=4*Math.ceil((24<<20)/3)+4*Math.ceil((8<<20)/3)+(8<<10);
export const PQ_FINALITY_EVIDENCE_LIMITS=Object.freeze({
 'collector-http':PQ_FINALITY_COLLECTOR_LIMITS.proofBytes+PQ_FINALITY_COLLECTOR_LIMITS.envelopeBytes,
 'verifier-stdin':(80<<20)+maxExpectedBytes+1024,
 'host-context':maxExpectedBytes+(32<<10)+1024,
 'verifier-stdout':8<<20,'verifier-stderr':64<<10,'verifier-result':64<<10,
 'host-producer-stdin':4096,'host-producer-stdout':104521276,
 'host-producer-stderr':65536,'host-producer-result':64<<10,
 'host-selection-stdin':4096,'host-selection-stdout':16384,
 'host-selection-stderr':65536,'host-selection-result':64<<10,
});
const limits=PQ_FINALITY_EVIDENCE_LIMITS;
const fail=code=>{throw Object.assign(Error(code),{code});};
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
function httpMetadata(value){
 if(types.isProxy(value))fail('PQ_FINALITY_EVIDENCE_INVALID');
 exactData(value,['method','requestPath','contentType','cacheControl'],'PQ_FINALITY_EVIDENCE_INVALID');
 if(value.method!=='GET'||typeof value.requestPath!=='string'||!/^\/txs\/0x[0-9a-f]{64}\/pq-action-finality-proof$/.test(value.requestPath))fail('PQ_FINALITY_EVIDENCE_INVALID');
 // Preserve observed headers, even a bounded invalid value, for later parsing;
 // never manufacture accepted content/cache headers during cold recovery.
 for(const name of ['contentType','cacheControl'])if(typeof value[name]!=='string'||Buffer.byteLength(value[name])>1024)fail('PQ_FINALITY_EVIDENCE_INVALID');
 return Object.freeze({...value});
}
async function readExactly(handle,length){const bytes=Buffer.alloc(length);let offset=0;while(offset<length){const result=await handle.read(bytes,offset,length-offset,null);if(!result.bytesRead)fail('PQ_FINALITY_EVIDENCE_UNVERIFIED');offset+=result.bytesRead;}return bytes;}
function reference(value){
 if(types.isProxy(value))fail('PQ_FINALITY_EVIDENCE_INVALID');
 const status=Object.hasOwn(value??{},'httpStatus');
 const http=Object.hasOwn(value??{},'http');
 exactData(value,['eventId','attemptId','kind','bytes','sha256',...(status?['httpStatus']:[]),...(http?['http']:[])],'PQ_FINALITY_EVIDENCE_INVALID');
 if(typeof value.eventId!=='string'||typeof value.attemptId!=='string'||typeof value.kind!=='string'||typeof value.sha256!=='string'||!uuid.test(value.eventId)||!uuid.test(value.attemptId)||!Object.hasOwn(limits,value.kind)||!Number.isSafeInteger(value.bytes)||value.bytes<0||value.bytes>limits[value.kind]||! /^[a-f0-9]{64}$/.test(value.sha256))fail('PQ_FINALITY_EVIDENCE_INVALID');
 if(status&&(value.kind!=='collector-http'||![200,202,502].includes(value.httpStatus)))fail('PQ_FINALITY_EVIDENCE_INVALID');
 if(http&&(!status||value.kind!=='collector-http'))fail('PQ_FINALITY_EVIDENCE_INVALID');
 return Object.freeze({...value,...(http?{http:httpMetadata(value.http)}:{})});
}
export {reference as parsePQFinalityEvidenceReference};
function identity(original,binding){
 if(types.isProxy(binding))fail('PQ_FINALITY_EVIDENCE_INVALID');exactData(binding,['account','networkId'],'PQ_FINALITY_EVIDENCE_INVALID');
 if(original&&typeof original==='object'&&!types.isProxy(original)&&Object.getOwnPropertyDescriptor(original,'kind')?.value==='pq-typed-action'){
  // Validate the complete retained wire and both original SDK snapshots. A
  // typed transport hash is never passed off as a legacy native transfer hash.
  const saved=pqTypedOriginalSummary(original);
  if(binding.account!==saved.account||binding.networkId!==saved.networkId)fail('PQ_FINALITY_EVIDENCE_BINDING_MISMATCH');
  return Object.freeze({account:saved.account,networkId:saved.networkId,operationId:saved.operationId,hash:saved.hash,abciTransactionHash:saved.hash,kind:'pq-typed-action',memberHash:saved.memberHash});
 }
 const {binding:b}=preparePQTransferOriginal(original,binding);
 return Object.freeze({account:b.account,networkId:b.chainId,operationId:b.operationId,hash:b.hash,abciTransactionHash:b.abciTransactionHash});
}
export class PQFinalityEvidence {
 #held=null;#active=0;
 constructor({directory,io=fs,platform=process.platform,policy=new PrivateFilePolicy({io,platform})}){
  if(!path.isAbsolute(directory??'')||path.normalize(directory)!==directory||directory===path.parse(directory).root)fail('PQ_FINALITY_EVIDENCE_DIRECTORY_REQUIRED');
  this.directory=directory;this.io=io;this.platform=platform;this.policy=policy;
 }
 assertSafeToClose(){if(this.#held||this.#active)fail('PQ_FINALITY_EVIDENCE_UNCONFIRMED');}
 pending(){const h=this.#held;return h?Object.freeze({eventId:h.eventId,kind:h.kind,bytes:h.body.length,sha256:h.sha256,lastAttempt:h.lastAttempt,causePresent:h.causePresent}):null;}
 async #directory(){
  await this.policy.directory(this.directory);const s=await this.io.lstat(this.directory);
  if(!s.isDirectory()||s.isSymbolicLink()||this.platform!=='win32'&&((s.mode&0o077)!==0||s.uid!==process.getuid()))fail('PQ_FINALITY_EVIDENCE_DIRECTORY_UNVERIFIED');
 }
 #file(ref){return path.join(this.directory,ref.eventId+'.'+ref.attemptId+'.pqfe');}
 async #private(handle,file){const stat=await handle.stat();await this.policy.assertPrivate(file,stat);if(this.platform!=='win32'&&stat.uid!==process.getuid())fail('PQ_FINALITY_EVIDENCE_OWNER_UNVERIFIED');return stat;}
 async #read(ref,owner){
  let handle;const file=this.#file(ref);
  try{
   handle=await this.io.open(file,constants.O_RDONLY|(constants.O_NOFOLLOW??0)|(constants.O_NONBLOCK??0));const before=await this.#private(handle,file);
   const metadata=Buffer.from(JSON.stringify({version:1,reference:ref,original:owner}));
   if(metadata.length>8192||before.size!==magic.length+4+metadata.length+ref.bytes)fail('PQ_FINALITY_EVIDENCE_UNVERIFIED');
   const prefix=Buffer.alloc(magic.length+4+metadata.length);let offset=0;
   while(offset<prefix.length){const {bytesRead}=await handle.read(prefix,offset,prefix.length-offset,null);if(!bytesRead)fail('PQ_FINALITY_EVIDENCE_UNVERIFIED');offset+=bytesRead;}
   if(!prefix.subarray(0,magic.length).equals(magic)||prefix.readUInt32BE(magic.length)!==metadata.length||!prefix.subarray(magic.length+4).equals(metadata))fail('PQ_FINALITY_EVIDENCE_BINDING_MISMATCH');
   const body=Buffer.alloc(ref.bytes);offset=0;
   while(offset<body.length){const {bytesRead}=await handle.read(body,offset,Math.min(1<<20,body.length-offset),null);if(!bytesRead)fail('PQ_FINALITY_EVIDENCE_UNVERIFIED');offset+=bytesRead;}
   const after=await this.#private(handle,file);
   if(after.size!==before.size||after.mtimeMs!==before.mtimeMs||after.ctimeMs!==before.ctimeMs||sha(body)!==ref.sha256)fail('PQ_FINALITY_EVIDENCE_UNVERIFIED');return body;
  }finally{await handle?.close();}
 }
 async read(original,binding,value){
  const ref=reference(value),owner=identity(original,binding);this.#active++;
  try{await this.#directory();return await this.#read(ref,owner);}catch(cause){throw Object.assign(Error('PQ_FINALITY_EVIDENCE_UNVERIFIED'),{code:'PQ_FINALITY_EVIDENCE_UNVERIFIED',cause});}finally{this.#active--;}
 }
 // Discover bounded reference headers after restart. These are candidates,
 // not durable proof claims: read() must still verify the complete bytes.
 // Unknown/partial files are counted, never removed or treated as absence.
 async candidates(original,binding){
  const owner=identity(original,binding);this.#active++;
  try{
   await this.#directory();const names=await this.io.readdir(this.directory);if(names.length>1024)fail('PQ_FINALITY_EVIDENCE_CAPACITY');
   const candidates=[];let unreadable=0;
   for(const name of names.sort()){
    let handle;
    try{
     if(!name.endsWith('.pqfe')){unreadable++;continue;}
     const file=path.join(this.directory,name);handle=await this.io.open(file,constants.O_RDONLY|(constants.O_NOFOLLOW??0)|(constants.O_NONBLOCK??0));await this.#private(handle,file);
     const prefix=await readExactly(handle,magic.length+4),length=prefix.readUInt32BE(magic.length);if(!prefix.subarray(0,magic.length).equals(magic)||length<1||length>8192)fail('PQ_FINALITY_EVIDENCE_UNVERIFIED');
     const text=new TextDecoder('utf-8',{fatal:true}).decode(await readExactly(handle,length)),metadata=JSON.parse(text);
     exactData(metadata,['version','reference','original'],'PQ_FINALITY_EVIDENCE_INVALID');if(metadata.version!==1||JSON.stringify(metadata)!==text)fail('PQ_FINALITY_EVIDENCE_UNVERIFIED');
     const ref=reference(metadata.reference);if(path.basename(this.#file(ref))!==name)fail('PQ_FINALITY_EVIDENCE_BINDING_MISMATCH');
     await this.#private(handle,file);if(JSON.stringify(metadata.original)===JSON.stringify(owner))candidates.push(ref);
    }catch{unreadable++;}finally{try{await handle?.close();}catch{unreadable++;}}
   }
   return Object.freeze({candidates:Object.freeze(candidates),unreadable});
  }catch(cause){throw Object.assign(Error('PQ_FINALITY_EVIDENCE_UNVERIFIED'),{code:'PQ_FINALITY_EVIDENCE_UNVERIFIED',cause});}finally{this.#active--;}
 }
 // Captures a detached exact copy before the first await. There is deliberately
 // no key-state check that could discard a result arriving after focus lock.
 async append(original,binding,kind,bytes,transport=null){
  if(this.#held||this.#active)fail('PQ_FINALITY_EVIDENCE_UNCONFIRMED');
  const owner=identity(original,binding);
  let extra={};if(transport!==null){
   if(types.isProxy(transport))fail('PQ_FINALITY_EVIDENCE_INVALID');const http=Object.hasOwn(transport,'http');
   exactData(transport,['httpStatus',...(http?['http']:[])],'PQ_FINALITY_EVIDENCE_INVALID');
   if(kind!=='collector-http'||![200,202,502].includes(transport.httpStatus))fail('PQ_FINALITY_EVIDENCE_INVALID');extra={httpStatus:transport.httpStatus};
   if(http){const observed=httpMetadata(transport.http);if(owner.kind!=='pq-typed-action'||observed.requestPath!=='/txs/'+owner.abciTransactionHash+'/pq-action-finality-proof')fail('PQ_FINALITY_EVIDENCE_BINDING_MISMATCH');extra.http=observed;}
  }
  if(typeof kind!=='string'||!Object.hasOwn(limits,kind)||types.isProxy(bytes)||!types.isUint8Array(bytes)||![Uint8Array.prototype,Buffer.prototype].includes(Object.getPrototypeOf(bytes))||['buffer','byteLength','byteOffset','length'].some(key=>Object.hasOwn(bytes,key))||types.isSharedArrayBuffer(bytes.buffer)||bytes.byteLength>limits[kind])fail('PQ_FINALITY_EVIDENCE_INVALID');
  const body=Buffer.from(bytes);this.#held={owner,kind,body,extra,eventId:randomUUID(),sha256:sha(body),lastAttempt:null,causePresent:false,cause:undefined};
  return this.flush(this.#held.eventId);
 }
 // Explicit local saving only. Each attempt uses a NEW exclusive file; failed
 // and uncertain partial attempts remain untouched, never overwritten/reused.
 async flush(eventId){
  const h=this.#held;if(!h||h.eventId!==eventId||this.#active)fail('PQ_FINALITY_EVIDENCE_INVALID');this.#active++;
  const ref=reference({eventId:h.eventId,attemptId:randomUUID(),kind:h.kind,bytes:h.body.length,sha256:h.sha256,...h.extra});h.lastAttempt=ref;
  let handle,failed=false;
  try{
   await this.#directory();const file=this.#file(ref),metadata=Buffer.from(JSON.stringify({version:1,reference:ref,original:h.owner})),length=Buffer.alloc(4);length.writeUInt32BE(metadata.length);
   handle=await this.io.open(file,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|(constants.O_NOFOLLOW??0),0o600);
   await this.policy.protect(file);await this.#private(handle,file);
   await handle.writeFile(Buffer.concat([magic,length,metadata]));await handle.writeFile(h.body);await handle.sync();await this.#private(handle,file);
   await handle.close();handle=null;
   if(this.platform!=='win32'){const dir=await this.io.open(this.directory,'r');try{await dir.sync();}finally{await dir.close();}}
   await this.#read(ref,h.owner);this.#held=null;return ref;
  }catch(cause){failed=true;if(!h.causePresent){h.causePresent=true;h.cause=cause;}throw Object.assign(Error('PQ_FINALITY_EVIDENCE_UNCONFIRMED'),{code:'PQ_FINALITY_EVIDENCE_UNCONFIRMED',eventId:h.eventId,cause:h.cause});}
  finally{try{await handle?.close();}catch(cause){if(!failed){if(!h.causePresent){h.causePresent=true;h.cause=cause;}throw Object.assign(Error('PQ_FINALITY_EVIDENCE_UNCONFIRMED'),{code:'PQ_FINALITY_EVIDENCE_UNCONFIRMED',eventId:h.eventId,cause:h.cause});}}finally{this.#active--;}}
 }
}
