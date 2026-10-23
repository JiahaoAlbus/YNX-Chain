import fs from 'node:fs/promises';
import {constants,writeSync,fsyncSync,fstatSync,lstatSync,unlinkSync} from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {contractScopeNamespace} from './contract-relay-scope.mjs';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const HASH=/^[a-f0-9]{64}$/;
const METHODS=new Set(['ynx_preparePQContractAction','ynx_preparePQContractBroadcast','ynx_getPQContractOriginal']);
const FIELDS=['account','method','requestPayloadSHA256','originalRequestKeyHash','operationId','transportHash','memberHash','state'];
const fail=code=>Object.assign(Error('The original Wallet query reference must be preserved.'),{code});
const same=(a,b)=>a.dev===b.dev&&a.ino===b.ino&&a.uid===b.uid;
const uid=()=>process.getuid();
export function contractBroadcastReferenceId(referenceId){
 if(!UUID.test(referenceId||''))throw fail('IDE_CONTRACT_REQUEST_INVALID');
 const hex=createHash('sha256').update('ynx-ide-local-broadcast-reference-v1\0'+referenceId).digest('hex').slice(0,32);
 return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
function validate(value){
 if(!value||Object.getPrototypeOf(value)!==Object.prototype||Object.keys(value).sort().join()!==[...FIELDS].sort().join()||!/^0x[a-f0-9]{40}$/.test(value.account)||!METHODS.has(value.method)||!HASH.test(value.requestPayloadSHA256)||!['pending','unknown','saved'].includes(value.state))throw fail('CONTRACT_REFERENCE_INVALID');
 for(const key of ['originalRequestKeyHash','transportHash','memberHash'])if(value[key]!==null&&!(key==='originalRequestKeyHash'?HASH:/^0x[a-f0-9]{64}$/).test(value[key]))throw fail('CONTRACT_REFERENCE_INVALID');
 if(value.operationId!==null&&(typeof value.operationId!=='string'||!/^[A-Za-z0-9:_-]{1,160}$/.test(value.operationId)))throw fail('CONTRACT_REFERENCE_INVALID');
 return structuredClone(value);
}
// This journal stores query coordinates only. Neither editable local files nor
// their digest can grant an identity, a project permission, a signature or send.
export async function openContractReferenceJournal({profile,projectId,owner,account}){
 if(typeof owner!=='string'||!owner||owner.length>512||typeof account!=='string'||!account||account.length>512)throw fail('CONTRACT_REFERENCE_BINDING');
 return openJournal({profile,projectId,binding:{projectId,owner,account},directoryName:'wallet-contract-query-references'});
}
export async function openRelayContractReferenceJournal({profile,projectId,scope}){
 return openJournal({profile,projectId,binding:{version:2,localProjectId:projectId,relay:contractScopeNamespace(scope)},directoryName:'wallet-contract-query-references-v2'});
}
async function openJournal({profile,projectId,binding,directoryName}){
 if(!path.isAbsolute(profile)||!UUID.test(projectId))throw fail('CONTRACT_REFERENCE_BINDING');
 if(await fs.realpath(profile)!==profile)throw fail('CONTRACT_REFERENCE_BINDING');
 const base=await fs.lstat(profile);if(!base.isDirectory()||base.isSymbolicLink()||base.uid!==uid()||(base.mode&0o777)!==0o700)throw fail('CONTRACT_REFERENCE_BINDING');
 const digest=createHash('sha256').update(JSON.stringify(binding)).digest('hex');
 const directory=path.join(profile,directoryName);await fs.mkdir(directory,{mode:0o700}).catch(e=>{if(e.code!=='EEXIST')throw e;});
 const captured=await fs.lstat(directory);if(!captured.isDirectory()||captured.isSymbolicLink()||captured.uid!==uid()||(captured.mode&0o777)!==0o700)throw fail('CONTRACT_REFERENCE_BINDING');
 function current(){const a=lstatSync(profile),b=lstatSync(directory);if(!a.isDirectory()||a.isSymbolicLink()||!same(a,base)||(a.mode&0o777)!==0o700||!b.isDirectory()||b.isSymbolicLink()||!same(b,captured)||(b.mode&0o777)!==0o700)throw fail('CONTRACT_REFERENCE_BINDING');}
 const file=id=>{if(!UUID.test(id))throw fail('CONTRACT_REFERENCE_INVALID');return path.join(directory,id+'.jsonl');};
 async function read(id){
  current();const target=file(id);let fd;try{fd=await fs.open(target,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);}catch(e){if(e.code==='ENOENT')return null;throw e;}
  try{const before=await fd.stat();if(!before.isFile()||before.uid!==uid()||before.nlink!==1||(before.mode&0o777)!==0o600||before.size>128*1024)throw fail('CONTRACT_REFERENCE_INVALID');const raw=await fd.readFile('utf8'),after=await fd.stat();current();if(!same(before,after)||!same(lstatSync(target),after)||after.nlink!==1||(after.mode&0o777)!==0o600||before.size!==after.size||raw.length===0||!raw.endsWith('\n'))throw fail('CONTRACT_REFERENCE_UNKNOWN');let previous=null,revision=0;
   for(const line of raw.trimEnd().split('\n')){const row=JSON.parse(line);if(!row||typeof row!=='object'||!HASH.test(row.bindingHash||''))throw fail('CONTRACT_REFERENCE_UNKNOWN');if(row.bindingHash!==digest)throw fail('CONTRACT_REFERENCE_BINDING');if(Object.keys(row).sort().join()!=='bindingHash,referenceId,revision,value'||row.referenceId!==id||row.revision!==revision++)throw fail('CONTRACT_REFERENCE_UNKNOWN');const next=validate(row.value);if(previous)compatible(previous,next);previous=next;}
   return Object.freeze({referenceId:id,revision:revision-1,...previous,authority:'query-reference-only',replayAllowed:false});
  }finally{await fd.close();}
 }
 function compatible(old,next){
  for(const key of ['account','method','requestPayloadSHA256'])if(old[key]!==next[key])throw fail('CONTRACT_REFERENCE_CONFLICT');
  for(const key of ['originalRequestKeyHash','operationId','transportHash','memberHash'])if(old[key]!==null&&old[key]!==next[key])throw fail('CONTRACT_REFERENCE_CONFLICT');
  if(old.state==='unknown'&&next.state!=='unknown'||old.state==='saved'&&next.state==='pending')throw fail('CONTRACT_REFERENCE_UNKNOWN');
 }
 async function append(id,value){
  const next=validate(value),target=file(id);current();const lockPath=target+'.lock';let lock;try{lock=await fs.open(lockPath,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW,0o600);}catch(e){if(e.code==='EEXIST')throw fail('CONTRACT_REFERENCE_BUSY');throw e;}
  const lockIdentity=await lock.stat();let entered=false,done=false,fd;
  try{
   await lock.writeFile(JSON.stringify({pid:process.pid,nonce:randomUUID()})+'\n');await lock.sync();
   const old=await read(id);if(old)compatible(old,next);
   if(!old){const files=await fs.readdir(directory);if(files.filter(n=>n.endsWith('.jsonl')).length>=128)throw fail('CONTRACT_REFERENCE_CAPACITY');}
   fd=await fs.open(target,constants.O_APPEND|constants.O_WRONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK|(old?0:constants.O_CREAT|constants.O_EXCL),0o600);
   const stat=await fd.stat();if(!stat.isFile()||stat.uid!==uid()||stat.nlink!==1||(stat.mode&0o777)!==0o600)throw fail('CONTRACT_REFERENCE_INVALID');
   const row=JSON.stringify({bindingHash:digest,referenceId:id,revision:old?old.revision+1:0,value:next})+'\n';if(stat.size+Buffer.byteLength(row)>128*1024)throw fail('CONTRACT_REFERENCE_CAPACITY');
   current();if(!same(lstatSync(target),stat))throw fail('CONTRACT_REFERENCE_UNKNOWN');entered=true;const bytes=Buffer.from(row);let written=0;while(written<bytes.length){const count=writeSync(fd.fd,bytes,written,bytes.length-written);if(count<=0)throw fail('CONTRACT_REFERENCE_UNKNOWN');written+=count;}fsyncSync(fd.fd);current();if(!same(lstatSync(target),fstatSync(fd.fd)))throw fail('CONTRACT_REFERENCE_UNKNOWN');
   const dirfd=await fs.open(directory,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK|constants.O_DIRECTORY);try{if(!same(await dirfd.stat(),captured))throw fail('CONTRACT_REFERENCE_BINDING');await dirfd.sync();}finally{await dirfd.close();}current();done=true;return await read(id);
  }finally{
   await fd?.close();await lock.close();if(!entered||done){const held=lstatSync(lockPath);if(same(held,lockIdentity))unlinkSync(lockPath);}
   // An uncertain write keeps its lock and original bytes. A later reader may
   // inspect them, but no stale-lock takeover or automatic resend is provided.
  }
 }
 async function list(strict=false){current();const rows=[];let seen=0;for await(const entry of await fs.opendir(directory)){if(++seen>256)throw fail('CONTRACT_REFERENCE_CAPACITY');const match=/^([a-f0-9-]{36})\.jsonl$/.exec(entry.name);if(!match)continue;try{const row=await read(match[1]);if(row)rows.push(row);}catch(error){if(strict&&error.code!=='CONTRACT_REFERENCE_BINDING')throw fail('CONTRACT_REFERENCE_UNKNOWN');/* Foreign bindings and damaged originals are never adopted or removed. */}}current();return Object.freeze(rows.sort((a,b)=>a.referenceId.localeCompare(b.referenceId)));}
 // Old rows are untrusted query DATA, never a principal or a permission. Read
 // them only to prevent re-sending the same uncertain Wallet operation across
 // a format/caller upgrade. No returned payload can authorize a new request.
 async function acrossNamespaces(){
  current();const rows=[];let legacyPresent=false;
  for(const name of ['wallet-contract-query-references','wallet-contract-query-references-v2']){
   const folder=path.join(profile,name);let parent;try{parent=await fs.lstat(folder);}catch(error){if(error.code==='ENOENT')continue;throw error;}
   if(!parent.isDirectory()||parent.isSymbolicLink()||parent.uid!==uid()||(parent.mode&0o777)!==0o700)throw fail('CONTRACT_REFERENCE_UNKNOWN');
   let seen=0;
   for await(const entry of await fs.opendir(folder)){
    if(++seen>256)throw fail('CONTRACT_REFERENCE_CAPACITY');
    const match=/^([a-f0-9-]{36})\.jsonl$/.exec(entry.name);if(!match)continue;
    if(name==='wallet-contract-query-references')legacyPresent=true;
    const referenceId=match[1],target=path.join(folder,entry.name);if(!UUID.test(referenceId))throw fail('CONTRACT_REFERENCE_UNKNOWN');
    const fd=await fs.open(target,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
    try{
     const before=await fd.stat();if(!before.isFile()||before.uid!==uid()||before.nlink!==1||(before.mode&0o777)!==0o600||before.size>128*1024)throw fail('CONTRACT_REFERENCE_UNKNOWN');
     const raw=await fd.readFile('utf8'),after=await fd.stat();current();if(!same(parent,await fs.lstat(folder))||!same(before,after)||!same(lstatSync(target),after)||before.size!==after.size||before.mtimeMs!==after.mtimeMs||before.ctimeMs!==after.ctimeMs||after.nlink!==1||(after.mode&0o777)!==0o600||!raw||!raw.endsWith('\n'))throw fail('CONTRACT_REFERENCE_UNKNOWN');
     let previous=null,revision=0,bindingHash;
     for(const line of raw.trimEnd().split('\n')){const row=JSON.parse(line);if(!row||Object.keys(row).sort().join()!=='bindingHash,referenceId,revision,value'||!HASH.test(row.bindingHash||'')||row.referenceId!==referenceId||row.revision!==revision++||bindingHash!==undefined&&row.bindingHash!==bindingHash)throw fail('CONTRACT_REFERENCE_UNKNOWN');bindingHash=row.bindingHash;const next=validate(row.value);if(previous)compatible(previous,next);previous=next;}
     rows.push({referenceId,bindingHash,...previous});
    }finally{await fd.close();}
   }
   current();if(!same(parent,await fs.lstat(folder)))throw fail('CONTRACT_REFERENCE_UNKNOWN');
  }
  return{rows,legacyPresent};
 }
 async function unresolved(request){const {rows}=await acrossNamespaces();for(const original of rows.filter(row=>row.account===request.account&&row.method===request.method&&row.requestPayloadSHA256===request.requestPayloadSHA256)){
  if(original.state!=='saved')return original.referenceId;
  const id=contractBroadcastReferenceId(original.referenceId),pending=rows.find(row=>row.referenceId===id&&row.account===request.account&&row.method==='ynx_preparePQContractBroadcast'&&row.state!=='saved');if(pending)return pending.referenceId;
 }return null;}
 async function history(){const references=await list();let retained;try{const {rows,legacyPresent}=await acrossNamespaces();retained=legacyPresent||rows.some(row=>row.bindingHash!==digest);}catch{current();retained=true;}return Object.freeze({version:2,references,legacy:Object.freeze({state:retained?'retained-scope-unavailable':'none',queryOnly:true,readable:false,replayAllowed:false})});}
 return Object.freeze({read,append,list,history,unresolved});
}
