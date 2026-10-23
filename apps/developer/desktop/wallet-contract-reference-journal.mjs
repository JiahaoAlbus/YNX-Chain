import fs from 'node:fs/promises';
import {constants,writeSync,fsyncSync,fstatSync,lstatSync,unlinkSync} from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const HASH=/^[a-f0-9]{64}$/;
const METHODS=new Set(['ynx_preparePQContractAction','ynx_preparePQContractBroadcast','ynx_getPQContractOriginal']);
const FIELDS=['account','method','requestPayloadSHA256','originalRequestKeyHash','operationId','transportHash','memberHash','state'];
const fail=code=>Object.assign(Error('The original Wallet query reference must be preserved.'),{code});
const same=(a,b)=>a.dev===b.dev&&a.ino===b.ino&&a.uid===b.uid;
const uid=()=>process.getuid();
function validate(value){
 if(!value||Object.getPrototypeOf(value)!==Object.prototype||Object.keys(value).sort().join()!==[...FIELDS].sort().join()||!/^0x[a-f0-9]{40}$/.test(value.account)||!METHODS.has(value.method)||!HASH.test(value.requestPayloadSHA256)||!['pending','unknown','saved'].includes(value.state))throw fail('CONTRACT_REFERENCE_INVALID');
 for(const key of ['originalRequestKeyHash','transportHash','memberHash'])if(value[key]!==null&&!(key==='originalRequestKeyHash'?HASH:/^0x[a-f0-9]{64}$/).test(value[key]))throw fail('CONTRACT_REFERENCE_INVALID');
 if(value.operationId!==null&&(typeof value.operationId!=='string'||!/^[A-Za-z0-9:_-]{1,160}$/.test(value.operationId)))throw fail('CONTRACT_REFERENCE_INVALID');
 return structuredClone(value);
}
// This journal stores query coordinates only. Neither editable local files nor
// their digest can grant an identity, a project permission, a signature or send.
export async function openContractReferenceJournal({profile,projectId,owner,account}){
 if(!path.isAbsolute(profile)||!UUID.test(projectId)||typeof owner!=='string'||!owner||owner.length>512||typeof account!=='string'||!account||account.length>512)throw fail('CONTRACT_REFERENCE_BINDING');
 if(await fs.realpath(profile)!==profile)throw fail('CONTRACT_REFERENCE_BINDING');
 const base=await fs.lstat(profile);if(!base.isDirectory()||base.isSymbolicLink()||base.uid!==uid()||(base.mode&0o777)!==0o700)throw fail('CONTRACT_REFERENCE_BINDING');
 const digest=createHash('sha256').update(JSON.stringify({projectId,owner,account})).digest('hex');
 const directory=path.join(profile,'wallet-contract-query-references');await fs.mkdir(directory,{mode:0o700}).catch(e=>{if(e.code!=='EEXIST')throw e;});
 const captured=await fs.lstat(directory);if(!captured.isDirectory()||captured.isSymbolicLink()||captured.uid!==uid()||(captured.mode&0o777)!==0o700)throw fail('CONTRACT_REFERENCE_BINDING');
 function current(){const a=lstatSync(profile),b=lstatSync(directory);if(!a.isDirectory()||a.isSymbolicLink()||!same(a,base)||(a.mode&0o777)!==0o700||!b.isDirectory()||b.isSymbolicLink()||!same(b,captured)||(b.mode&0o777)!==0o700)throw fail('CONTRACT_REFERENCE_BINDING');}
 const file=id=>{if(!UUID.test(id))throw fail('CONTRACT_REFERENCE_INVALID');return path.join(directory,id+'.jsonl');};
 async function read(id){
  current();const target=file(id);let fd;try{fd=await fs.open(target,constants.O_RDONLY|constants.O_NOFOLLOW);}catch(e){if(e.code==='ENOENT')return null;throw e;}
  try{const before=await fd.stat();if(!before.isFile()||before.uid!==uid()||before.nlink!==1||(before.mode&0o777)!==0o600||before.size>128*1024)throw fail('CONTRACT_REFERENCE_INVALID');const raw=await fd.readFile('utf8'),after=await fd.stat();current();if(!same(before,after)||!same(lstatSync(target),after)||after.nlink!==1||(after.mode&0o777)!==0o600||before.size!==after.size||raw.length===0||!raw.endsWith('\n'))throw fail('CONTRACT_REFERENCE_UNKNOWN');let previous=null,revision=0;
   for(const line of raw.trimEnd().split('\n')){const row=JSON.parse(line);if(Object.keys(row).sort().join()!=='bindingHash,referenceId,revision,value'||row.bindingHash!==digest||row.referenceId!==id||row.revision!==revision++)throw fail('CONTRACT_REFERENCE_BINDING');const next=validate(row.value);if(previous)compatible(previous,next);previous=next;}
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
   fd=await fs.open(target,constants.O_APPEND|constants.O_WRONLY|constants.O_NOFOLLOW|(old?0:constants.O_CREAT|constants.O_EXCL),0o600);
   const stat=await fd.stat();if(!stat.isFile()||stat.uid!==uid()||stat.nlink!==1||(stat.mode&0o777)!==0o600)throw fail('CONTRACT_REFERENCE_INVALID');
   const row=JSON.stringify({bindingHash:digest,referenceId:id,revision:old?old.revision+1:0,value:next})+'\n';if(stat.size+Buffer.byteLength(row)>128*1024)throw fail('CONTRACT_REFERENCE_CAPACITY');
   current();if(!same(lstatSync(target),stat))throw fail('CONTRACT_REFERENCE_UNKNOWN');entered=true;const bytes=Buffer.from(row);let written=0;while(written<bytes.length){const count=writeSync(fd.fd,bytes,written,bytes.length-written);if(count<=0)throw fail('CONTRACT_REFERENCE_UNKNOWN');written+=count;}fsyncSync(fd.fd);current();if(!same(lstatSync(target),fstatSync(fd.fd)))throw fail('CONTRACT_REFERENCE_UNKNOWN');
   const dirfd=await fs.open(directory,constants.O_RDONLY|constants.O_NOFOLLOW);try{if(!same(await dirfd.stat(),captured))throw fail('CONTRACT_REFERENCE_BINDING');await dirfd.sync();}finally{await dirfd.close();}current();done=true;return await read(id);
  }finally{
   await fd?.close();await lock.close();if(!entered||done){const held=lstatSync(lockPath);if(same(held,lockIdentity))unlinkSync(lockPath);}
   // An uncertain write keeps its lock and original bytes. A later reader may
   // inspect them, but no stale-lock takeover or automatic resend is provided.
  }
 }
 return Object.freeze({read,append});
}
