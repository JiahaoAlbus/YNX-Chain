import {execFileSync} from 'node:child_process';
import {readFileSync,lstatSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
const manifestPath='apps/wallet-desktop/scripts/wallet-auth-runtime-dependencies.json';
const prefix='code/packages/wallet-auth/node_modules/';
const digest=b=>createHash('sha256').update(b).digest('hex');
const git=(cwd,...args)=>execFileSync('git',args,{cwd,maxBuffer:16*1024*1024});
/** Build-time only. The fixed source-owned manifest binds the SDK's declared
 * dependency versions. No install, download, ambient lookup or runtime loader. */
export function walletAuthDependencyPlan(cwd,sourceCommit){
 const root=git(cwd,'rev-parse','--show-toplevel').toString().trim();
 const bytes=git(root,'show',sourceCommit+':'+manifestPath),manifest=JSON.parse(bytes);
 const sdk=JSON.parse(git(root,'show',sourceCommit+':packages/wallet-auth/package.json'));
 if(manifest.schemaVersion!==1||manifest.files?.length!==211||manifest.versions?.['@noble/curves']!=='2.2.0'||manifest.versions?.['@noble/hashes']!=='2.2.0')throw Error('SDK_RUNTIME_DEPENDENCY_MANIFEST_INVALID');
 for(const [name,version] of Object.entries(manifest.versions))if(sdk.dependencies?.[name]!==version)throw Error('SDK_RUNTIME_DEPENDENCY_DECLARATION_CHANGED');
 const rows=[],contents=new Map(),seen=new Set();
 for(const entry of manifest.files){
  if(typeof entry.path!=='string'||!/^@noble\/(?:curves|hashes)\/[A-Za-z0-9_./-]+$/.test(entry.path)||entry.path!==path.posix.normalize(entry.path)||entry.path.split('/').some(s=>s==='.'||s==='..')||seen.has(entry.path)||!Number.isSafeInteger(entry.bytes)||entry.bytes<1||entry.bytes>8388608||!/^[a-f0-9]{64}$/.test(entry.sha256))throw Error('SDK_RUNTIME_DEPENDENCY_PIN_INVALID');
  seen.add(entry.path);const file=path.join(root,'packages/wallet-auth/node_modules',entry.path),stat=lstatSync(file);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size!==entry.bytes)throw Error('SDK_RUNTIME_DEPENDENCY_INPUT_REQUIRED:'+entry.path);
  const data=readFileSync(file);if(digest(data)!==entry.sha256)throw Error('SDK_RUNTIME_DEPENDENCY_INPUT_DIFFERS:'+entry.path);
  const name=prefix+entry.path;contents.set(name,data);rows.push({path:name,type:'file',unpacked:false,executable:false,physicalMode:null,bytes:data.length,sha256:entry.sha256});
 }
 for(const [name,version] of Object.entries(manifest.versions)){const meta=JSON.parse(contents.get(prefix+name+'/package.json'));if(meta.name!==name||meta.version!==version)throw Error('SDK_RUNTIME_DEPENDENCY_VERSION_DIFFERS');}
 return {rows,contents,public:{manifest:{path:manifestPath,bytes:bytes.length,sha256:digest(bytes)},versions:manifest.versions,files:manifest.files}};
}
export function verifyPackagedWalletAuthDependencies(asar,archive,plan,sdkMetadata){
 for(const row of plan.rows){const bytes=asar.extractFile(archive,row.path);if(bytes.length!==row.bytes||digest(bytes)!==row.sha256)throw Error('PACKAGED_SDK_DEPENDENCY_DIFFERS:'+row.path);}
 const resolved=[],members=new Set(asar.listPackage(archive).map(p=>p.replace(/^\//,'')));
 for(const [name,version] of Object.entries(sdkMetadata.dependencies??{})){
  const nested=prefix+name+'/package.json',shared='node_modules/'+name+'/package.json';let file;
  const packageDir=path.posix.dirname(nested);
  for(let parent=packageDir;parent!=='.';parent=path.posix.dirname(parent))if(members.has(parent)&&asar.statFile(archive,parent,false).link)throw Error('PACKAGED_SDK_DEPENDENCY_DIRECTORY_ALIAS_UNSUPPORTED:'+name);
  if(members.has(nested))file=nested;
  else if(members.has(packageDir))throw Error('PACKAGED_SDK_DEPENDENCY_METADATA_MISSING:'+name);
  else file=shared;
  const info=asar.statFile(archive,file,false);if(!info||info.files||info.link)throw Error('PACKAGED_SDK_DEPENDENCY_METADATA_NOT_REGULAR:'+name);
  const meta=JSON.parse(asar.extractFile(archive,file));if(meta.name!==name||meta.version!==version)throw Error('PACKAGED_SDK_DEPENDENCY_VERSION_DIFFERS:'+name);
  resolved.push({name,version,path:file});
 }
 return {manifest:plan.public.manifest,filesVerified:plan.rows.length,resolved,ambientRuntimeFallback:false};
}
