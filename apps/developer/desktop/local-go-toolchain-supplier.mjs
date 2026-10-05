import fs from 'node:fs/promises';
import {inspectWorkspacePathIdentity,assertWorkspacePathIdentity} from './workspace-path-identity.mjs';
import { constants } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { execFile as callbackExecFile } from 'node:child_process';
const execFile=promisify(callbackExecFile),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
// Darwin's public fcntl.h flag prevents following *any* path component. Final
// O_NOFOLLOW alone would not protect a replaced ancestor during the scan.
// O_NOFOLLOW and O_NOFOLLOW_ANY are mutually exclusive on Darwin.
const NOFOLLOW=0x20000000;
const id=s=>({dev:String(s.dev),ino:String(s.ino),uid:String(s.uid),mode:Number(s.mode)&0o777});
const fileIdentity=s=>({...id(s),size:String(s.size),mtime:String(s.mtimeNs),ctime:String(s.ctimeNs),nlink:String(s.nlink)});
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const order=(a,b)=>a.path<b.path?-1:a.path>b.path?1:0;
const check=signal=>signal?.throwIfAborted();
async function ancestors(item){
 const rows=[];for(let current=item;;current=path.dirname(current)){const s=await fs.lstat(current,{bigint:true});if(!s.isDirectory()||s.isSymbolicLink()||await fs.realpath(current)!==current)throw Error('Go path has a noncanonical directory ancestor.');rows.push({path:current,...id(s)});if(current==='/')return rows;}
}
async function rootProof(item,privateRoot=false){
 if(!path.isAbsolute(item||'')||await fs.realpath(item)!==item)throw Error('Choose a canonical Go installation and App support directory.');
 const rows=await ancestors(item),s=await fs.lstat(item,{bigint:true});
 if(privateRoot && rows.some(row=>![String(process.getuid()),'0'].includes(row.uid)||(row.mode&0o022)))throw Error('Private Go snapshot ancestors are writable by another user.');
 if(privateRoot && (s.uid!==BigInt(process.getuid())||(Number(s.mode)&0o777)!==0o700))throw Error('Go snapshot support must be a private directory owned by this user.');
 return {path:item,private:privateRoot,identity:id(s),ancestors:rows};
}
async function assertProof(proof){if(!equal(await rootProof(proof.path,proof.private),proof))throw Error('Go path identity or ancestors changed.');}
async function readRegular(item,signal){
 check(signal);const handle=await fs.open(item,constants.O_RDONLY|NOFOLLOW);
 try{const before=await handle.stat({bigint:true});if(!before.isFile()||before.nlink!==1n||![0n,BigInt(process.getuid())].includes(before.uid)||(Number(before.mode)&0o022)||before.size>128n*1024n*1024n)throw Error('Go source requires bounded, regular, privately owned files without links.');
  const bytes=await handle.readFile();check(signal);const after=await handle.stat({bigint:true}),current=await fs.lstat(item,{bigint:true});
  if(!equal(fileIdentity(before),fileIdentity(after))||!equal(fileIdentity(before),fileIdentity(current)))throw Error('Go source changed during reading.');
  return {bytes,identity:fileIdentity(before),sha256:sha(bytes)};
 }finally{await handle.close();}
}
async function scan(root,signal){
 const rows=[];let total=0;
 async function visit(relative){check(signal);const item=path.join(root,relative),s=await fs.lstat(item,{bigint:true});
  if(await fs.realpath(item)!==item||s.isSymbolicLink()||![0n,BigInt(process.getuid())].includes(s.uid)||(Number(s.mode)&0o022)||rows.length>=50000)throw Error('Go closure contains an unsafe path or exceeds its bound.');
  if(s.isDirectory()){const identity=fileIdentity(s);rows.push({path:relative,kind:'directory',identity});for(const name of(await fs.readdir(item)).sort())await visit(relative?relative+'/'+name:name);if(!equal(identity,fileIdentity(await fs.lstat(item,{bigint:true}))))throw Error('Go directory changed during inventory.');}
  else {const file=await readRegular(item,signal);total+=file.bytes.length;if(total>512*1024*1024)throw Error('Go closure exceeds 512 MiB.');rows.push({path:relative,kind:'file',identity:file.identity,sha256:file.sha256});}
 }
 await visit('');return rows;
}
async function writeOwned(item,bytes,mode){
 const handle=await fs.open(item,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|NOFOLLOW,mode);
 try{await handle.chmod(mode);await handle.writeFile(bytes);}finally{await handle.close();}
}
async function privateChild(parent,name){
 const item=path.join(parent,name);try{await fs.mkdir(item,{mode:0o700});}catch(error){if(error.code!=='EEXIST')throw error;}
 await rootProof(item,true);return item;
}
async function sourceLicense(root,signal){
 let item=path.join(root,'LICENSE');try{return {path:item,...await readRegular(item,signal)};}catch(error){if(error.code!=='ENOENT')throw error;}
 if(path.basename(root)!=='libexec')throw Error('The selected Go installation has no matching LICENSE.');
 item=path.join(path.dirname(root),'LICENSE');return {path:item,...await readRegular(item,signal)};
}
async function version(root,signal,pathIdentityHelper){
 check(signal);const entry=path.join(root,'bin/go');const file=await readRegular(entry,signal);
 if(file.bytes.readUInt32LE(0)!==0xfeedfacf||file.bytes.readUInt32LE(4)!==0x100000c)throw Error('This supplier supports the selected macOS ARM64 Go executable only.');
 const proof=await inspectWorkspacePathIdentity({helper:pathIdentityHelper,path:root});
 const env={GOTELEMETRY:'off',HOME:root,PATH:'/usr/bin:/bin',GOROOT:root,GOTOOLCHAIN:'local',GOENV:'off',GOPROXY:'off',GOSUMDB:'off'};
 // Version checks are product checks, not unrestricted host execution. No
 // source installation is executed, and no project/profile/home read grant is
 // added. literal / is required by dyld; it does not grant descendant reads.
 const quote=value=>JSON.stringify(value);
 const policy=['(version 1)','(deny default)','(deny network*)','(allow process*)','(allow sysctl-read)',
  `(allow file-read* (literal "/") (subpath "/System") (subpath "/usr/lib") (literal "/dev/null") (literal "/dev/urandom") ${proof.paths.map(p=>`(subpath ${quote(p)})`).join(" ")})`,
 ...proof.ancestors.map(p=>`(allow file-read-metadata (literal ${quote(p)}))`)].join('\n');
 const run=async args=>{await assertWorkspacePathIdentity(proof);return(await execFile('/usr/bin/sandbox-exec',['-p',policy,entry,...args],{env,signal,cwd:root,timeout:5000,maxBuffer:16384})).stdout.trim();};
 const actual=await run(['version']);
 if(!/^go version go1\.\d+(?:\.\d+)? darwin\/arm64$/.test(actual))throw Error('The private Go executable returned an unsupported version.');
 if((await run(['env','GOROOT']))!==root)throw Error('Private Go returned a different GOROOT.');
 return {entry,root,version:actual,sha:file.sha256};
}
function content(rows){return rows.map(r=>({path:r.path,kind:r.kind,mode:r.kind==='directory'?0o700:r.identity.mode,...(r.kind==='file'?{sha256:r.sha256,size:r.identity.size}:{})})).sort(order);}
async function validateSnapshot(directory,expected,signal,pathIdentityHelper){
 await rootProof(directory,true);const goroot=path.join(directory,'goroot');await rootProof(goroot,true);
 const actual=content(await scan(goroot,signal));if(!equal(actual,expected))throw Error('The retained Go snapshot is incomplete or changed. Existing data was preserved.');
 let distribution;try{distribution=await readRegular(path.join(directory,'distribution.json'),signal);}catch(error){if(error.code==='ENOENT')throw Error('The retained Go snapshot metadata is missing. Existing data was preserved.',{cause:error});throw error;}const data=JSON.parse(distribution.bytes);
 if(data.schemaVersion!==1||data.kind!=='ynx-private-go-toolchain'||!equal(data.files,expected)||data.treeSha256!==sha(JSON.stringify(expected)))throw Error('The retained Go distribution does not bind its actual contents.');
 const result=await version(goroot,signal,pathIdentityHelper);if(result.version!==data.version||result.sha!==data.binarySha256)throw Error('Private Go version differs from its distribution.');
 return {...result,distributionPath:path.join(directory,'distribution.json'),distributionSha:distribution.sha256};
}
export async function prepareLocalGoToolchain({selectedRoot,supportRoot,writableRoots,signal,onProgress,pathIdentityHelper}={}){
 if(process.platform!=='darwin'||process.arch!=='arm64')throw Error('The private Go supplier is currently verified for macOS ARM64 only.');
 if(!pathIdentityHelper)throw Error('A sealed native path identity helper is required for controlled Go version checks.');
 if(!Array.isArray(writableRoots)||!writableRoots.length)throw Error('Supply the real project/profile/temporary writable roots.');
 check(signal);const support=await rootProof(supportRoot,true),source=await rootProof(selectedRoot),writes=await Promise.all(writableRoots.map(item=>rootProof(item)));
 const outside=async directory=>{const destination=await rootProof(directory,true);for(const write of writes){await assertProof(write);const key=r=>r.dev+':'+r.ino;
  if(destination.ancestors.some(r=>key(r)===key(write.identity))||write.ancestors.some(r=>key(r)===key(destination.identity)))throw Error('Private Go snapshots must remain outside all project, profile and temporary writable roots.');}await assertProof(support);return destination;};
 // Check support itself before creating children, then check the exact output
 // root using directory vnode ancestry, including alternate volume spellings.
 for(const write of writes)if(support.ancestors.some(r=>r.dev===write.identity.dev&&r.ino===write.identity.ino))throw Error('App support is covered by a project writable root.');
 const toolchains=await privateChild(supportRoot,'toolchains'),parent=await privateChild(toolchains,'go');const parentProof=await outside(parent);
 const plan=await scan(selectedRoot,signal),license=await sourceLicense(selectedRoot,signal);await assertProof(source);check(signal);
 for(const name of ['bin/go','src/runtime/runtime.go','src/fmt/print.go',`pkg/tool/darwin_arm64/compile`,`pkg/tool/darwin_arm64/link`])if(!plan.some(row=>row.path===name&&row.kind==='file'))throw Error('Choose a complete installed macOS ARM64 Go toolchain.');
 const expected=content(plan);if(!expected.some(row=>row.path==='LICENSE'))expected.push({path:'LICENSE',kind:'file',mode:license.identity.mode,sha256:license.sha256,size:license.identity.size});expected.sort((a,b)=>order(a,b));
 const treeSha256=sha(JSON.stringify(expected)),destination=path.join(parent,treeSha256);
 await onProgress?.({phase:'source-scanned',files:plan.length});check(signal);
 // Sorting is independent of filesystem enumeration and receipt parsing.
 const verifyContents=async directory=>{const rows=content(await scan(directory,signal));if(!equal(rows,expected))throw Error('Go copied closure does not match its selected source.');};
 let existing=false;try{await fs.lstat(destination);existing=true;}catch(error){if(error.code!=='ENOENT')throw error;}
 if(existing){await assertProof(source);if(!equal(await scan(selectedRoot,signal),plan)||!equal((await readRegular(license.path,signal)).identity,license.identity)||(await readRegular(license.path,signal)).sha256!==license.sha256)throw Error('Go source inventory or LICENSE changed.');await assertProof(parentProof);
  return await validateSnapshot(destination,expected,signal,pathIdentityHelper);
 }
 const staging=await fs.mkdtemp(path.join(parent,'.pending-'));await fs.chmod(staging,0o700);const stageProof=await rootProof(staging,true),goroot=await privateChild(staging,'goroot');let claim,published=false;
 const owned=new Map();
 const remember=async item=>{const stat=await fs.lstat(item,{bigint:true});owned.set(item,stat.isDirectory()?id(stat):fileIdentity(stat));};
 await remember(staging);await remember(goroot);
 const cleanup=async proof=>{if(!proof)return;await assertProof(proof);
  const remove=async item=>{const current=await fs.lstat(item,{bigint:true}),identity=current.isDirectory()?id(current):fileIdentity(current);
   if(!equal(identity,owned.get(item))||current.isSymbolicLink())throw Error('Unpublished Go data changed; retained for recovery.');
   await ancestors(path.dirname(item));
   if(current.isDirectory()){const names=await fs.readdir(item);if(names.some(name=>!owned.has(path.join(item,name))))throw Error('Unknown unpublished Go data retained for recovery.');for(const name of names)await remove(path.join(item,name));if(!equal(id(await fs.lstat(item,{bigint:true})),identity))throw Error('Cleanup directory identity changed.');await fs.rmdir(item);}
   else{if(!equal(fileIdentity(await fs.lstat(item,{bigint:true})),identity))throw Error('Cleanup file identity changed.');await fs.unlink(item);}
  };await remove(proof.path);
 };
 try{
  for(const row of plan){check(signal);const target=path.join(goroot,row.path);
   if(row.kind==='directory'){if(row.path){await fs.mkdir(target,{mode:0o700});await remember(target);}}
   else{const current=await readRegular(path.join(selectedRoot,row.path),signal);if(!equal(current.identity,row.identity)||current.sha256!==row.sha256)throw Error('Go source changed during copying.');await writeOwned(target,current.bytes,row.identity.mode);await remember(target);}
  }
  if(!plan.some(row=>row.path==='LICENSE')){await writeOwned(path.join(goroot,'LICENSE'),license.bytes,license.identity.mode);await remember(path.join(goroot,'LICENSE'));}
  await onProgress?.({phase:'copied'});check(signal);await assertProof(source);
  if(!equal(await scan(selectedRoot,signal),plan)||!equal((await readRegular(license.path,signal)).identity,license.identity)||(await readRegular(license.path,signal)).sha256!==license.sha256)throw Error('Go source inventory or LICENSE changed during copying.');
  await verifyContents(goroot);const actual=await version(goroot,signal,pathIdentityHelper);await verifyContents(goroot);check(signal);await assertProof(parentProof);await outside(parent);
  await onProgress?.({phase:'before-publish'});check(signal);await assertProof(parentProof);await assertProof(source);
  if(!equal(await scan(selectedRoot,signal),plan)||!equal((await readRegular(license.path,signal)).identity,license.identity)||(await readRegular(license.path,signal)).sha256!==license.sha256)throw Error('Go source inventory or LICENSE changed before publication.');
  await verifyContents(goroot);await outside(parent);
  // mkdir is the no-replace claim. Another invocation's directory is never
  // overwritten by rename, including a failed or incomplete prior claim.
  await fs.mkdir(destination,{mode:0o700});claim=await rootProof(destination,true);await remember(destination);await fs.rename(goroot,path.join(destination,'goroot'));for(const [item,identity]of [...owned])if(item===goroot||item.startsWith(goroot+'/')){owned.delete(item);owned.set(path.join(destination,'goroot')+item.slice(goroot.length),identity);}await assertProof(claim);
  const data={schemaVersion:1,kind:'ynx-private-go-toolchain',source,sourceInventory:plan,license:{source:license.path,identity:license.identity,sha256:license.sha256},treeSha256,version:actual.version,binarySha256:actual.sha,files:expected};
  check(signal);await fs.writeFile(path.join(destination,'distribution.json'),JSON.stringify(data,null,2)+'\n',{flag:'wx',mode:0o600});published=true;
  await onProgress?.({phase:'published',root:path.join(destination,'goroot')});
  // Cancellation after this publication barrier must not delete valid data.
  const result=await validateSnapshot(destination,expected,undefined,pathIdentityHelper);await cleanup(stageProof);return result;
 }catch(error){
  try{await cleanup(stageProof);if(claim&&!published)await cleanup(claim);}catch(cleanupError){error.recoveryPath=claim?.path||staging;error.cleanupError=cleanupError.message;}
  throw error;
 }
}
