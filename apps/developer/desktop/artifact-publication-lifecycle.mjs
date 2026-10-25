import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const fields=['projectId','version','contentDigest','publishPurpose','targetEnvironment','byteSize'];
const hashes=['manifestSHA256','approvalSHA256'];
const principalKeys=['account','deviceId','sessionRef','currentRef','accountGeneration','sessionGeneration'];
const projectKeys=['projectId','ownerAccount','currentReference','projectRevision','catalogRevision'];
const publisherKeys=['account','projectId','publisherId','keyRole','publicOriginal','publicSHA256','registrationRef','revision'];
const text=value=>typeof value==='string'&&value.length>0&&Buffer.byteLength(value)<=32768;
const failure=code=>Object.assign(Error('Preserve the original publication request and query it only.'),{code});
const same=(a,b)=>a.dev===b.dev&&a.ino===b.ino&&a.uid===b.uid;
async function readBounded(fd){const bytes=Buffer.alloc(16385);let length=0;while(length<bytes.length){const read=await fd.read(bytes,length,bytes.length-length,null);if(!read.bytesRead)break;length+=read.bytesRead;}if(length>16384)throw failure('IDE_PUBLICATION_REFERENCE_INVALID');return new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(0,length));}
function expectedData(input,projectId,publisherId){
 const value=structuredClone(input);
 if(!value||Object.keys(value).sort().join()!=='approvalSHA256,binding,manifestSHA256,publisherId,resourceId'||!value.binding||Object.keys(value.binding).sort().join()!==[...fields].sort().join()||value.binding.projectId!==projectId||value.publisherId!==publisherId)throw failure('IDE_PUBLICATION_REFERENCE_INVALID');
 for(const key of fields)if(key==='byteSize'?!Number.isSafeInteger(value.binding[key])||value.binding[key]<1||value.binding[key]>67108864:typeof value.binding[key]!=='string'||!value.binding[key]||Buffer.byteLength(value.binding[key])>256)throw failure('IDE_PUBLICATION_REFERENCE_INVALID');
 for(const key of hashes)if(!/^[a-f0-9]{64}$/.test(value[key]))throw failure('IDE_PUBLICATION_REFERENCE_INVALID');
 if(!/^[a-f0-9]{64}$/.test(value.binding.contentDigest)||['publisherId','resourceId'].some(key=>typeof value[key]!=='string'||!value[key]||Buffer.byteLength(value[key])>256))throw failure('IDE_PUBLICATION_REFERENCE_INVALID');
 return value;
}
// Cancellation settles the UI owner even if a read-only SDK ignores its
// signal. Both outcomes remain observed; no retry or replacement is started.
function observeUntilCancelled(signal,observe){
 return new Promise((resolve,reject)=>{
  let settled=false;
  const finish=(failed,value)=>{if(settled)return;settled=true;signal.removeEventListener('abort',abort);if(failed)reject(value);else resolve(value);};
  const abort=()=>finish(true,signal.reason);
  signal.addEventListener('abort',abort,{once:true});
  if(signal.aborted){abort();return;}
  Promise.resolve().then(()=>{signal.throwIfAborted();return observe();}).then(value=>finish(false,value),cause=>finish(true,cause));
 });
}
// Owns only durable query coordinates. There is deliberately no submit,
// re-sign, retry, deploy cancellation, or trusted-publisher grant here.
export async function openPublicationObservation({context,publicationProject,endpoint,fetch:fetchImpl,getDeploymentRequestHeaders,CloudClient,observeIDEDeployment,now=Date.now}){
 if(!context?.profile||!path.isAbsolute(context.profile)||!UUID.test(context.id||'')||typeof publicationProject?.readObservationScope!=='function'||typeof getDeploymentRequestHeaders!=='function'||typeof fetchImpl!=='function'||typeof CloudClient!=='function'||typeof observeIDEDeployment!=='function')throw failure('IDE_PUBLICATION_NOT_SUPPLIED');
 let captured,deadline,fingerprint,closed=false;const active=new Set();
 const local=Object.freeze({id:context.id,workspace:context.workspace,profile:context.profile});
 async function current(){
  if(closed||Object.keys(local).some(key=>context[key]!==local[key]))throw failure('IDE_PUBLICATION_RETIRED');
  const state=await publicationProject.readObservationScope();
  if(closed||Object.keys(local).some(key=>context[key]!==local[key])||!state||principalKeys.some(key=>!text(state.principal?.[key]))||projectKeys.some(key=>!text(state.project?.[key]))||publisherKeys.some(key=>!text(state.publisher?.[key]))||state.project.read!==true||state.publisher.account!==state.principal.account||state.publisher.projectId!==state.project.projectId||state.publisher.keyRole!=='ide-artifact-publisher'||!Number.isSafeInteger(state.expiresMS)||state.expiresMS<=now())throw failure('IDE_PUBLICATION_RETIRED');
  const selected={principal:Object.fromEntries(principalKeys.map(key=>[key,state.principal[key]])),project:Object.fromEntries([...projectKeys,'read','publish','runtime','runtimeOrigin'].map(key=>[key,state.project[key]])),publisher:Object.fromEntries(publisherKeys.map(key=>[key,state.publisher[key]]))};
  const next=JSON.stringify(selected);
  if(captured&&(fingerprint!==next||state.expiresMS<deadline||now()>=deadline))throw failure('IDE_PUBLICATION_RETIRED');
  if(!captured){captured=selected;fingerprint=next;deadline=state.expiresMS;}
  return selected;
 }
 await current();
 const profile=context.profile;if(await fs.realpath(profile)!==profile)throw failure('IDE_PUBLICATION_REFERENCE_INVALID');const profileStat=await fs.lstat(profile);
 if(!profileStat.isDirectory()||profileStat.isSymbolicLink()||profileStat.uid!==process.getuid()||(profileStat.mode&0o777)!==0o700)throw failure('IDE_PUBLICATION_REFERENCE_INVALID');
 const directory=path.join(profile,'artifact-publication-queries');await fs.mkdir(directory,{mode:0o700}).catch(error=>{if(error.code!=='EEXIST')throw error;});const directoryStat=await fs.lstat(directory);
 if(!directoryStat.isDirectory()||directoryStat.isSymbolicLink()||directoryStat.uid!==process.getuid()||(directoryStat.mode&0o777)!==0o700)throw failure('IDE_PUBLICATION_REFERENCE_INVALID');
 const bindingHash=createHash('sha256').update(JSON.stringify({project:captured.project.projectId,localProject:local.id,owner:captured.project.ownerAccount,account:captured.principal.account})).digest('hex');
 async function localCurrent(){await current();for(const [name,stat]of[[profile,profileStat],[directory,directoryStat]]){const next=await fs.lstat(name);if(!next.isDirectory()||next.isSymbolicLink()||!same(next,stat)||(next.mode&0o777)!==0o700)throw failure('IDE_PUBLICATION_REFERENCE_INVALID');}}
 const file=requestId=>{if(!UUID.test(requestId||''))throw failure('IDE_PUBLICATION_REFERENCE_INVALID');return path.join(directory,requestId+'.json');};
 async function read(requestId){await localCurrent();const target=file(requestId);let fd;try{fd=await fs.open(target,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);}catch(error){if(error.code==='ENOENT')return null;throw error;}try{const before=await fd.stat();if(!before.isFile()||before.uid!==process.getuid()||before.nlink!==1||(before.mode&0o777)!==0o600||before.size>16384)throw failure('IDE_PUBLICATION_REFERENCE_INVALID');const raw=await readBounded(fd),after=await fd.stat();await localCurrent();const named=await fs.lstat(target);if(!same(before,after)||before.size!==after.size||before.mtimeMs!==after.mtimeMs||before.ctimeMs!==after.ctimeMs||!same(after,named)||after.size!==named.size||after.mtimeMs!==named.mtimeMs||after.ctimeMs!==named.ctimeMs||named.nlink!==1||(named.mode&0o777)!==0o600||!raw.endsWith('\n'))throw failure('IDE_PUBLICATION_REFERENCE_UNKNOWN');const row=JSON.parse(raw);if(Object.keys(row).sort().join()!=='bindingHash,expected,requestId'||row.bindingHash!==bindingHash||row.requestId!==requestId)throw failure('IDE_PUBLICATION_REFERENCE_INVALID');return Object.freeze({requestId,expected:expectedData(row.expected,captured.project.projectId,captured.publisher.publisherId),queryOnly:true,replayAllowed:false});}finally{await fd.close();}}
 return Object.freeze({
  async retain(requestId,expected){await localCurrent();const target=file(requestId),value=expectedData(expected,captured.project.projectId,captured.publisher.publisherId);if((await fs.readdir(directory)).length>=128)throw failure('IDE_PUBLICATION_REFERENCE_CAPACITY');let fd;try{fd=await fs.open(target,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW|constants.O_NONBLOCK,0o600);const stat=await fd.stat();const bytes=Buffer.from(JSON.stringify({bindingHash,requestId,expected:value})+'\n');if(bytes.length>16384)throw failure('IDE_PUBLICATION_REFERENCE_INVALID');await fd.writeFile(bytes);await fd.sync();await localCurrent();if(!same(stat,await fs.lstat(target)))throw failure('IDE_PUBLICATION_REFERENCE_UNKNOWN');const dir=await fs.open(directory,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW|constants.O_NONBLOCK);try{if(!same(await dir.stat(),directoryStat))throw failure('IDE_PUBLICATION_REFERENCE_UNKNOWN');await dir.sync();}finally{await dir.close();}return await read(requestId);}finally{await fd?.close();}},
  read,
  async resume(requestId,{signal}={}){
   const reference=await read(requestId);if(!reference)throw failure('IDE_PUBLICATION_REFERENCE_MISSING');
   const controller=new AbortController(),abort=()=>controller.abort(signal.reason);
   signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();active.add(controller);
   const requestCurrent=async()=>{controller.signal.throwIfAborted();await current();controller.signal.throwIfAborted();};
   try{
    await requestCurrent();
    // Bind each original SDK client to this query's cancellation. A late SDK
    // callback cannot obtain proof headers or start the following log GET.
    const cloud=new CloudClient({endpoint,product:'cloud',maxRetries:0,fetch:async(url,request)=>{
     await requestCurrent();const response=await fetchImpl(url,request);await requestCurrent();return response;
    },getDeploymentRequestHeaders:async request=>{
     await requestCurrent();const headers=await getDeploymentRequestHeaders(request);await requestCurrent();return headers;
    }});
    const result=await observeUntilCancelled(controller.signal,()=>observeIDEDeployment(cloud,{requestId,expected:reference.expected,signal:controller.signal}));
    await requestCurrent();return result;
   }finally{active.delete(controller);signal?.removeEventListener('abort',abort);}
  },
  close(){closed=true;for(const controller of active)controller.abort(failure('IDE_PUBLICATION_RETIRED'));active.clear();},
 });
}
