import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const fields=['projectId','version','contentDigest','publishPurpose','targetEnvironment','byteSize'];
const hashes=['manifestSHA256','approvalSHA256'];
const scopeKeys=['owner','workspaceOwner','account','generation','identityReference','localProjectId','workspace','launch','sessionId'];
const failure=code=>Object.assign(Error('Preserve the original publication request and query it only.'),{code});
const same=(a,b)=>a.dev===b.dev&&a.ino===b.ino&&a.uid===b.uid;
async function readBounded(fd){const bytes=Buffer.alloc(16385);let length=0;while(length<bytes.length){const read=await fd.read(bytes,length,bytes.length-length,null);if(!read.bytesRead)break;length+=read.bytesRead;}if(length>16384)throw failure('IDE_PUBLICATION_REFERENCE_INVALID');return new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(0,length));}
function expectedData(input,projectId){
 const value=structuredClone(input);
 if(!value||Object.keys(value).sort().join()!=='approvalSHA256,binding,manifestSHA256,publisherId,resourceId'||!value.binding||Object.keys(value.binding).sort().join()!==[...fields].sort().join()||value.binding.projectId!==projectId)throw failure('IDE_PUBLICATION_REFERENCE_INVALID');
 for(const key of fields)if(key==='byteSize'?!Number.isSafeInteger(value.binding[key])||value.binding[key]<1||value.binding[key]>67108864:typeof value.binding[key]!=='string'||!value.binding[key]||Buffer.byteLength(value.binding[key])>256)throw failure('IDE_PUBLICATION_REFERENCE_INVALID');
 for(const key of hashes)if(!/^[a-f0-9]{64}$/.test(value[key]))throw failure('IDE_PUBLICATION_REFERENCE_INVALID');
 if(!/^[a-f0-9]{64}$/.test(value.binding.contentDigest)||['publisherId','resourceId'].some(key=>typeof value[key]!=='string'||!value[key]||Buffer.byteLength(value[key])>256))throw failure('IDE_PUBLICATION_REFERENCE_INVALID');
 return value;
}
// Owns only durable query coordinates. There is deliberately no submit,
// re-sign, retry, deploy cancellation, or trusted-publisher grant here.
export async function openPublicationObservation({context,admittedProject,endpoint,getDeploymentRequestHeaders,CloudClient,observeIDEDeployment,now=Date.now}){
 if(!context?.profile||!path.isAbsolute(context.profile)||!UUID.test(context.id||'')||typeof admittedProject?.assertCurrent!=='function'||typeof getDeploymentRequestHeaders!=='function'||typeof CloudClient!=='function'||typeof observeIDEDeployment!=='function')throw failure('IDE_PUBLICATION_NOT_SUPPLIED');
 let captured,deadline,closed=false;const active=new Set();
 async function current(){if(closed)throw failure('IDE_PUBLICATION_RETIRED');const state=await admittedProject.assertCurrent();if(closed||!state||scopeKeys.some(key=>state[key]===undefined)||state.workspace!==context.workspace||!Number.isSafeInteger(state.generation)||state.generation<0||!Number.isFinite(state.expiresAt)||state.expiresAt<=now())throw failure('IDE_PUBLICATION_RETIRED');if(captured&&(scopeKeys.some(key=>captured[key]!==state[key])||state.expiresAt<deadline||now()>=deadline))throw failure('IDE_PUBLICATION_RETIRED');if(!captured){captured=Object.freeze({...state});deadline=state.expiresAt;}return state;}
 await current();
 const profile=context.profile;if(await fs.realpath(profile)!==profile)throw failure('IDE_PUBLICATION_REFERENCE_INVALID');const profileStat=await fs.lstat(profile);
 if(!profileStat.isDirectory()||profileStat.isSymbolicLink()||profileStat.uid!==process.getuid()||(profileStat.mode&0o777)!==0o700)throw failure('IDE_PUBLICATION_REFERENCE_INVALID');
 const directory=path.join(profile,'artifact-publication-queries');await fs.mkdir(directory,{mode:0o700}).catch(error=>{if(error.code!=='EEXIST')throw error;});const directoryStat=await fs.lstat(directory);
 if(!directoryStat.isDirectory()||directoryStat.isSymbolicLink()||directoryStat.uid!==process.getuid()||(directoryStat.mode&0o777)!==0o700)throw failure('IDE_PUBLICATION_REFERENCE_INVALID');
 const bindingHash=createHash('sha256').update(JSON.stringify({project:context.id,owner:captured.owner,account:captured.account})).digest('hex');
 async function localCurrent(){await current();for(const [name,stat]of[[profile,profileStat],[directory,directoryStat]]){const next=await fs.lstat(name);if(!next.isDirectory()||next.isSymbolicLink()||!same(next,stat)||(next.mode&0o777)!==0o700)throw failure('IDE_PUBLICATION_REFERENCE_INVALID');}}
 const file=requestId=>{if(!UUID.test(requestId||''))throw failure('IDE_PUBLICATION_REFERENCE_INVALID');return path.join(directory,requestId+'.json');};
 async function read(requestId){await localCurrent();const target=file(requestId);let fd;try{fd=await fs.open(target,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);}catch(error){if(error.code==='ENOENT')return null;throw error;}try{const before=await fd.stat();if(!before.isFile()||before.uid!==process.getuid()||before.nlink!==1||(before.mode&0o777)!==0o600||before.size>16384)throw failure('IDE_PUBLICATION_REFERENCE_INVALID');const raw=await readBounded(fd),after=await fd.stat();await localCurrent();const named=await fs.lstat(target);if(!same(before,after)||before.size!==after.size||before.mtimeMs!==after.mtimeMs||before.ctimeMs!==after.ctimeMs||!same(after,named)||after.size!==named.size||after.mtimeMs!==named.mtimeMs||after.ctimeMs!==named.ctimeMs||named.nlink!==1||(named.mode&0o777)!==0o600||!raw.endsWith('\n'))throw failure('IDE_PUBLICATION_REFERENCE_UNKNOWN');const row=JSON.parse(raw);if(Object.keys(row).sort().join()!=='bindingHash,expected,requestId'||row.bindingHash!==bindingHash||row.requestId!==requestId)throw failure('IDE_PUBLICATION_REFERENCE_INVALID');return Object.freeze({requestId,expected:expectedData(row.expected,captured.localProjectId),queryOnly:true,replayAllowed:false});}finally{await fd.close();}}
 // The original SDK obtains fresh original proof headers for every status/log
 // GET. A project change during a header acquisition fences that same GET.
 const cloud=new CloudClient({endpoint,product:'cloud',maxRetries:0,getDeploymentRequestHeaders:async request=>{await current();const headers=await getDeploymentRequestHeaders(request);await current();return headers;}});
 return Object.freeze({
  async retain(requestId,expected){await localCurrent();const target=file(requestId),value=expectedData(expected,captured.localProjectId);if((await fs.readdir(directory)).length>=128)throw failure('IDE_PUBLICATION_REFERENCE_CAPACITY');let fd;try{fd=await fs.open(target,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW|constants.O_NONBLOCK,0o600);const stat=await fd.stat();const bytes=Buffer.from(JSON.stringify({bindingHash,requestId,expected:value})+'\n');if(bytes.length>16384)throw failure('IDE_PUBLICATION_REFERENCE_INVALID');await fd.writeFile(bytes);await fd.sync();await localCurrent();if(!same(stat,await fs.lstat(target)))throw failure('IDE_PUBLICATION_REFERENCE_UNKNOWN');const dir=await fs.open(directory,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW|constants.O_NONBLOCK);try{if(!same(await dir.stat(),directoryStat))throw failure('IDE_PUBLICATION_REFERENCE_UNKNOWN');await dir.sync();}finally{await dir.close();}return await read(requestId);}finally{await fd?.close();}},
  read,
  async resume(requestId,{signal}={}){const reference=await read(requestId);if(!reference)throw failure('IDE_PUBLICATION_REFERENCE_MISSING');const controller=new AbortController(),abort=()=>controller.abort(signal.reason);signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();active.add(controller);try{await current();const result=await observeIDEDeployment(cloud,{requestId,expected:reference.expected,signal:controller.signal});await current();return result;}finally{active.delete(controller);signal?.removeEventListener('abort',abort);}},
  close(){closed=true;for(const controller of active)controller.abort(failure('IDE_PUBLICATION_RETIRED'));active.clear();},
 });
}
