import * as fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {types} from 'node:util';
import {readOriginalPQHostSourceCatalog,readOriginalPQHostSourceCatalogBytes} from './wallet-pq-host-catalog.mjs';

const fail=code=>{throw Object.assign(Error(code),{code});};
const sha=b=>createHash('sha256').update(b).digest('hex');
const stamp=s=>[s.dev,s.ino,s.mode,s.uid,s.nlink,s.size,s.mtimeMs,s.ctimeMs].join(':');
const version='YNX-WALLET-PQ-HOST-REGISTRATION/v1';
// Protected Main DATA storage, NOT SourceOwner authentication or trust. Only
// the original independently qualified private receiver may call retain().
// No IPC/RPC/ENV installer, catalog-derived pin, replacement or eviction.
export class PQHostCatalogStore {
 #held=null;
 constructor({directory}){
  if(typeof directory!=='string'||!path.isAbsolute(directory)||path.normalize(directory)!==directory||directory===path.parse(directory).root||directory.includes('\0'))fail('PQ_HOST_REGISTRATION_DIRECTORY');
  this.directory=directory;
 }
 #directory(create=false){
  if(typeof process.getuid!=='function'||process.getuid()===0||process.geteuid()!==process.getuid())fail('PQ_HOST_REGISTRATION_OWNER');
  if(create)try{fs.mkdirSync(this.directory,{mode:0o700});}catch(e){if(e.code!=='EEXIST')throw e;}
  if(fs.realpathSync(this.directory)!==this.directory)fail('PQ_HOST_REGISTRATION_STORAGE');
  const s=fs.lstatSync(this.directory);
  if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==process.getuid()||(s.mode&0o7777)!==0o700)fail('PQ_HOST_REGISTRATION_STORAGE');
  return s;
 }
 #identity(value){
  const keys=['operationId','account','networkId','originalHash','nativeWireHash','transactionHash'];
  if(types.isProxy(value)||!value||Object.getPrototypeOf(value)!==Object.prototype)fail('PQ_HOST_REGISTRATION_BINDING');
  const d=Object.getOwnPropertyDescriptors(value);
  if(Reflect.ownKeys(d).length!==keys.length||keys.some(k=>!d[k]?.enumerable||!Object.hasOwn(d[k],'value')||typeof d[k].value!=='string'))fail('PQ_HOST_REGISTRATION_BINDING');
  const v=Object.fromEntries(keys.map(k=>[k,d[k].value]));
  if(!/^[A-Za-z0-9_-]{1,128}$/.test(v.operationId)||!/^0x[0-9a-f]{40}$/.test(v.account)||v.originalHash!=='0x'+v.nativeWireHash||['networkId','nativeWireHash','transactionHash'].some(k=>! /^[0-9a-f]{64}$/.test(v[k])||/^0{64}$/.test(v[k])))fail('PQ_HOST_REGISTRATION_BINDING');
  return v;
 }
 #file(identity){return path.join(this.directory,sha(JSON.stringify([identity.operationId,identity.account,identity.networkId]))+'.pqhreg');}
 #catalog(pair,identity){
  let value;try{value=JSON.parse(readOriginalPQHostSourceCatalogBytes(pair));}catch(cause){throw Object.assign(Error('PQ_HOST_CATALOG_UNVERIFIED'),{code:'PQ_HOST_CATALOG_UNVERIFIED',cause});}
  const fields=['version','manifestPath','manifestSHA256','binding','sourcePath','sourceSha256','sourceId','epoch'];
  if(!value||Object.getPrototypeOf(value)!==Object.prototype||Object.keys(value).length!==fields.length||fields.some(k=>!Object.hasOwn(value,k))||value.version!=='YNX-CONSENSUS-PROOF-HOST-SOURCE-CATALOG/v1'||JSON.stringify(this.#identity(value.binding))!==JSON.stringify(identity))fail('PQ_HOST_REGISTRATION_BINDING');
  // Full manifest/source/lifecycle/trust validation remains the original
  // selector and acquire/current. These checks cannot turn DATA into trust.
  return readOriginalPQHostSourceCatalog(pair);
 }
 #read(file){
  const parent=this.#directory();let fd,failure;
  try{
   fd=fs.openSync(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW??0)|(fs.constants.O_NONBLOCK??0));
   const s=fs.fstatSync(fd);
   if(!s.isFile()||s.nlink!==1||s.uid!==process.getuid()||(s.mode&0o7777)!==0o600||s.size<1||s.size>8192)fail('PQ_HOST_REGISTRATION_UNCONFIRMED');
   const raw=Buffer.alloc(s.size);let at=0;
   while(at<raw.length){const n=fs.readSync(fd,raw,at,raw.length-at,null);if(!n)fail('PQ_HOST_REGISTRATION_UNCONFIRMED');at+=n;}
   if(stamp(s)!==stamp(fs.fstatSync(fd))||stamp(s)!==stamp(fs.lstatSync(file)))fail('PQ_HOST_REGISTRATION_UNCONFIRMED');
   const after=this.#directory();if(parent.ino!==after.ino||parent.dev!==after.dev)fail('PQ_HOST_REGISTRATION_UNCONFIRMED');
   return raw;
  }catch(cause){failure=cause;throw cause;}
  finally{if(fd!==undefined)try{fs.closeSync(fd);}catch(cleanupCause){if(failure&&typeof failure==='object')failure.cleanupCause=cleanupCause;else throw cleanupCause;}}
 }
 #decode(raw,identity){
  let record;try{record=JSON.parse(raw);}catch{fail('PQ_HOST_REGISTRATION_UNCONFIRMED');}
  // Canonical exact byte equality also rejects duplicate/extra JSON keys.
  const expected={version,binding:identity,registration:record.registration};
  if(!raw.equals(Buffer.from(JSON.stringify(expected))))fail('PQ_HOST_REGISTRATION_CONFLICT');
  const pair=this.#catalog(record.registration,identity);
  return {raw,registration:pair};
 }
 #sync(){const fd=fs.openSync(this.directory,fs.constants.O_RDONLY);try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
 pending(){return this.#held?Object.freeze({operationId:this.#held.identity.operationId,sha256:sha(this.#held.raw),outcome:'UNKNOWN'}):null;}
 select(binding){
  if(this.#held)fail('PQ_HOST_REGISTRATION_UNCONFIRMED');
  const identity=this.#identity(binding);let raw;
  try{raw=this.#read(this.#file(identity));}catch(e){if(e.code==='ENOENT')fail('PQ_HOST_SOURCE_NOT_SUPPLIED');throw e;}
  return this.#decode(raw,identity).registration;
 }
 retain(binding,independentRegistration){
  if(this.#held)fail('PQ_HOST_REGISTRATION_UNCONFIRMED');
  const identity=this.#identity(binding),registration=this.#catalog(independentRegistration,identity);
  const raw=Buffer.from(JSON.stringify({version,binding:identity,registration})),file=this.#file(identity);
  const parent=this.#directory(true);
  // Existing identical receipt can be acknowledged but never rewritten. Any
  // different hash/pair/partial record for this operation stays untouched.
  try{const old=this.#read(file);if(!old.equals(raw))fail('PQ_HOST_REGISTRATION_CONFLICT');return this.#decode(old,identity).registration;}catch(e){if(e.code!=='ENOENT')throw e;}
  this.#held={identity,raw,file};let fd,failure;
  try{
   fd=fs.openSync(file,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|(fs.constants.O_NOFOLLOW??0),0o600);
   fs.writeFileSync(fd,raw);fs.fsyncSync(fd);const closing=fd;fd=undefined;fs.closeSync(closing);
   const after=this.#directory();if(parent.ino!==after.ino||parent.dev!==after.dev)fail('PQ_HOST_REGISTRATION_UNCONFIRMED');
   this.#sync();const saved=this.#decode(this.#read(file),identity);
   if(!saved.raw.equals(raw))fail('PQ_HOST_REGISTRATION_UNCONFIRMED');
   this.#held=null;return saved.registration;
  }catch(cause){failure=Object.assign(Error('PQ_HOST_REGISTRATION_UNCONFIRMED'),{code:'PQ_HOST_REGISTRATION_UNCONFIRMED',cause});throw failure;}
  finally{if(fd!==undefined)try{fs.closeSync(fd);}catch(cleanupCause){if(failure)failure.cleanupCause=cleanupCause;else throw cleanupCause;}}
 }
 // Reconcile only the same completed bytes after a failed local save. Never
 // create/repair/rewrite, rerun registration, select or resurrect a Host lease.
 reconcile(){
  if(!this.#held)fail('PQ_HOST_REGISTRATION_NO_HELD_RESULT');
  const h=this.#held,actual=this.#read(h.file);
  if(!actual.equals(h.raw))fail('PQ_HOST_REGISTRATION_UNCONFIRMED');
  this.#decode(actual,h.identity);this.#sync();this.#held=null;
  return Object.freeze({saved:true,hostAcquired:false,proofVerified:false});
 }
}
