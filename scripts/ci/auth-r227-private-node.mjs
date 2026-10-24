// CI PUBLIC-fixture tooling ONLY. Not exported by wallet-auth or used by any
// production OriginalSourceVerifierConfig. Never chmod official toolcache.
import fs from'node:fs';import os from'node:os';import path from'node:path';import crypto from'node:crypto';import{spawnSync}from'node:child_process';
const sha=b=>crypto.createHash('sha256').update(b).digest('hex'),fail=c=>{throw Object.assign(Error(c),{code:c})},uid=()=>BigInt(process.getuid());
const stat=p=>fs.lstatSync(p,{bigint:true}),meta=s=>({device:String(s.dev),inode:String(s.ino),uid:String(s.uid),gid:String(s.gid),mode:(s.mode&0o777n).toString(8),links:String(s.nlink),bytes:String(s.size),type:s.isFile()?'file':s.isDirectory()?'directory':'other'});
const same=(a,b)=>JSON.stringify(meta(a))===JSON.stringify(meta(b));
function secureParents(home){if(!path.isAbsolute(home)||path.resolve(home)!==home||fs.realpathSync(home)!==home)fail('CI_HOME_CANONICAL');for(let p=home;;p=path.dirname(p)){const s=stat(p);if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==0n&&s.uid!==uid()||(s.mode&0o022n)!==0n)fail('CI_HOME_PARENT');if(p==='/')break}if(stat(home).uid!==uid())fail('CI_HOME_OWNER')}
function regular(s){return s.isFile()&&!s.isSymbolicLink()&&s.nlink===1n&&(s.uid===0n||s.uid===uid())&&(s.mode&0o022n)===0n&&s.size>0n&&s.size<=268435456n}
function checkRoot(r){secureParents(r.home);if(path.dirname(r.directory)!==r.home||!/^\.ynx-auth-go-ci-node-[A-Za-z0-9]+$/.test(path.basename(r.directory))||r.path!==path.join(r.directory,'node')||fs.realpathSync(r.directory)!==r.directory)fail('CI_COPY_PATH');const d=stat(r.directory);if(d.uid!==uid()||(d.mode&0o777n)!==0o700n||!d.isDirectory()||d.isSymbolicLink()||String(d.dev)!==r.directoryTuple.device||String(d.ino)!==r.directoryTuple.inode)fail('CI_COPY_DIRECTORY_CHANGED');return d}
export function preparePrivateCINode({source=process.execPath,home=os.homedir(),expectedVersion=process.version}={}){
 // Overrides exist solely for the small PUBLIC byte-copy fixture. SDK normal
 // CI invokes with process.execPath/os.homedir/process.version, no ENV selector.
 secureParents(home);if(!path.isAbsolute(source)||fs.realpathSync(source)!==source)fail('CI_SOURCE_CANONICAL');let sfd,wfd,receipt,answer,primary,present=false;
 try{
  sfd=fs.openSync(source,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);const before=fs.fstatSync(sfd,{bigint:true});if(!regular(before)||!same(before,stat(source)))fail('CI_SOURCE_FILE');
  const bytes=fs.readFileSync(sfd);if(BigInt(bytes.length)!==before.size)fail('CI_SOURCE_BYTES');
  const directory=fs.mkdtempSync(path.join(home,'.ynx-auth-go-ci-node-'));fs.chmodSync(directory,0o700);
  receipt={schema:'YNX-AUTH-GO-CI-PRIVATE-NODE/v1',ciOnly:true,home,directory,path:path.join(directory,'node'),directoryTuple:meta(stat(directory)),source:{path:source,tuple:meta(before),bytes:bytes.length,sha256:sha(bytes)},expectedVersion,ready:false};
  wfd=fs.openSync(receipt.path,fs.constants.O_RDWR|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o700);receipt.fileTuple=meta(fs.fstatSync(wfd,{bigint:true}));
  fs.writeFileSync(wfd,bytes);fs.fchmodSync(wfd,0o700);fs.fsyncSync(wfd);const written=fs.fstatSync(wfd,{bigint:true});receipt.fileTuple=meta(written);receipt.bytes=bytes.length;receipt.sha256=sha(bytes);
  const end=fs.fstatSync(sfd,{bigint:true});if(!same(before,end)||!same(before,stat(source))||before.mtimeNs!==end.mtimeNs||before.ctimeNs!==end.ctimeNs)fail('CI_SOURCE_CHANGED');
  checkRoot(receipt);const copy=stat(receipt.path);if(!same(copy,written)||copy.uid!==uid()||copy.nlink!==1n||(copy.mode&0o777n)!==0o700n||sha(fs.readFileSync(receipt.path))!==receipt.sha256)fail('CI_COPY_MISMATCH');
  // Linux refuses exec of an image still open for write (ETXTBSY). Close the
  // exact verified writer before exec; never relax identity/hash predicates.
  fs.closeSync(wfd);wfd=undefined;checkRoot(receipt);
  if(JSON.stringify(meta(stat(receipt.path)))!==JSON.stringify(receipt.fileTuple)||sha(fs.readFileSync(receipt.path))!==receipt.sha256)fail('CI_COPY_POST_CLOSE_CHANGED');
  const probe=spawnSync(receipt.path,['--version'],{cwd:directory,env:{},encoding:'utf8',timeout:5000,maxBuffer:4096});receipt.versionProbe={exit:probe.status,signal:probe.signal??null,errorCode:typeof probe.error?.code==='string'?probe.error.code:null,errorName:typeof probe.error?.name==='string'?probe.error.name:null,stdoutBytes:Buffer.byteLength(probe.stdout??''),stdoutSHA256:sha(probe.stdout??''),stderrBytes:Buffer.byteLength(probe.stderr??''),stderrSHA256:sha(probe.stderr??'')};
  if(probe.status!==0||probe.stdout.trim()!==expectedVersion||probe.stderr!=='')fail('CI_COPY_VERSION');receipt.ready=true;answer=receipt;
 }catch(error){primary=error;present=true;
  // Preserve a failed/partial owned copy only after FD/name/root identity
  // checks. Never infer cleanup authority over an unknown replacement.
  if(receipt&&wfd!==undefined)try{const s=fs.fstatSync(wfd,{bigint:true});checkRoot(receipt);if(String(s.dev)!==receipt.fileTuple.device||String(s.ino)!==receipt.fileTuple.inode||!same(s,stat(receipt.path))||s.size>268435456n)throw Error('partial changed');const b=Buffer.alloc(Number(s.size));let n=0;while(n<b.length){const got=fs.readSync(wfd,b,n,b.length-n,n);if(got<=0)throw Error('partial read');n+=got}receipt.fileTuple=meta(s);receipt.bytes=b.length;receipt.sha256=sha(b);receipt.partialCleanupBound=true}catch{receipt.partialCleanupBound=false}
  else if(receipt)try{checkRoot(receipt);if(JSON.stringify(meta(stat(receipt.path)))!==JSON.stringify(receipt.fileTuple)||sha(fs.readFileSync(receipt.path))!==receipt.sha256)throw Error('closed copy changed');receipt.partialCleanupBound=true}catch{receipt.partialCleanupBound=false}
 }finally{for(const fd of[wfd,sfd])if(fd!==undefined)try{fs.closeSync(fd)}catch(error){if(!present){primary=error;present=true}}}
 if(present){if(receipt&&primary&&typeof primary==='object')Object.assign(primary,{partial:receipt});throw primary}return answer;
}
export function cleanupPrivateCINode(receipt){
 if(receipt?.schema!=='YNX-AUTH-GO-CI-PRIVATE-NODE/v1'||receipt.ciOnly!==true||!receipt.fileTuple||!Number.isSafeInteger(receipt.bytes)||!/^[a-f0-9]{64}$/.test(receipt.sha256??''))fail('CI_CLEANUP_UNBOUND');
 checkRoot(receipt);const children=fs.readdirSync(receipt.directory);if(children.length!==1||children[0]!=='node')fail('CI_CLEANUP_FOREIGN_CHILD');
 const s=stat(receipt.path);if(JSON.stringify(meta(s))!==JSON.stringify(receipt.fileTuple)||s.uid!==uid()||s.nlink!==1n||!s.isFile()||s.isSymbolicLink()||(s.mode&0o777n)!==0o700n||Number(s.size)!==receipt.bytes||sha(fs.readFileSync(receipt.path))!==receipt.sha256)fail('CI_CLEANUP_SUBSTITUTED');
 // Immediate recheck, exact file only; never recurse or delete siblings.
 if(!same(s,stat(receipt.path)))fail('CI_CLEANUP_RACE');fs.unlinkSync(receipt.path);checkRoot(receipt);if(fs.readdirSync(receipt.directory).length!==0)fail('CI_CLEANUP_FOREIGN_CHILD');fs.rmdirSync(receipt.directory);
 return{fileAbsent:!fs.existsSync(receipt.path),directoryAbsent:!fs.existsSync(receipt.directory),ciOnly:true,productionMutation:false};
}
