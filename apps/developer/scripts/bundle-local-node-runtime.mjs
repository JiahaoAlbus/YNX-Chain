import {readFile,writeFile,mkdir,copyFile,realpath,readdir,lstat,chmod} from 'node:fs/promises';
import {dirname,join,resolve,basename,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync,spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const developer=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const machoArch=process.arch==='arm64'?'arm64':'x86_64';
const sha=b=>createHash('sha256').update(b).digest('hex');
const exec=(command,args)=>execFileSync(command,args,{encoding:'utf8',maxBuffer:16*1024*1024,env:{PATH:'/usr/bin:/bin:/usr/sbin:/sbin'}});
const dependencies=(path,architecture=machoArch)=>exec('/usr/bin/otool',['-arch',architecture,'-L',path]).split('\n').slice(1).map(line=>line.trim().split(' (')[0]).filter(Boolean);
const rpaths=path=>[...exec('/usr/bin/otool',['-l',path]).matchAll(/cmd LC_RPATH\n\s+cmdsize \d+\n\s+path (.+?) \(offset/g)].map(match=>match[1]);
const system=path=>path.startsWith('/usr/lib/')||path.startsWith('/System/');
// These are individually reviewed macOS inputs, not a general version range or
// permission to select arbitrary installed runtimes on other platforms.
export const reviewedNodeInputs=Object.freeze({
 '/opt/homebrew/Cellar/node/26.7.0/bin/node':Object.freeze({version:'v26.7.0',sha256:'1ef99ea25fe70c9b67e7efe768ef8ee22148d3cabc703db6131b57aeb617d040',kind:'retained-homebrew'}),
 '/usr/local/bin/node':Object.freeze({version:'v24.19.0',sha256:'1f08f0e5b8d9a0136c6219f4cea4d3b4fb8ffa4d96e0ff64869ce0dda6dd6a35',kind:'official-node-installer',license:Object.freeze({path:join(developer,'runtime/legal/node-v24.19.0-LICENSE'),sha256:'148eacf7863ef4329224a29398623077200a27194aa075569faf4a0a85566ca5'})})
});
export async function validateReviewedNodeLicense(license) {
 if(!license)throw Error('Reviewed Node 24.19.0 full LICENSE input is missing; offline distribution is not admitted.');
 if(await realpath(license.path)!==license.path||!(await lstat(license.path)).isFile()||sha(await readFile(license.path))!==license.sha256)throw Error('Reviewed Node 24 legal input changed.');
 return license;
}
export function reviewedMacNodeVersion(version){return version==='v24.19.0'||version==='v26.7.0';}
export async function inspectReviewedNodeInput(input) {
 if(process.platform!=='darwin')throw Error('macOS runtime input required.');
 const source=await realpath(input),review=reviewedNodeInputs[source];
 if(source!==input||!review||!(await lstat(source)).isFile())throw Error('Use an exact reviewed retained macOS Node input.');
 if(sha(await readFile(source))!==review.sha256)throw Error('Reviewed Node source bytes changed.');
 if(exec(source,['--version']).trim()!==review.version)throw Error('Reviewed Node version changed.');
 if(review.kind!=='official-node-installer')return {source,...review};
 exec('/usr/bin/codesign',['--verify','--strict','-R','=anchor apple generic and identifier "node" and certificate leaf[subject.OU] = "HX7739G8FX"',source]);
 const signature=spawnSync('/usr/bin/codesign',['-dv','--verbose=4',source],{encoding:'utf8'});
 if(signature.status!==0)throw Error('Original Node signature metadata is unavailable.');
 const receipt=exec('/usr/sbin/pkgutil',['--pkg-info-plist','org.nodejs.node.pkg']);
 if(!receipt.includes('<string>v24.19.0</string>'))throw Error('Official Node installer receipt version changed.');
 const architectures=exec('/usr/bin/lipo',['-archs',source]).trim().split(/\s+/);
 if(!architectures.includes(machoArch)||architectures.some(arch=>dependencies(source,arch).some(p=>!system(p))))throw Error('Official Node source architecture or system-only closure changed.');
 return {source,...review,originalSignature:signature.stderr,installerReceipt:receipt,originalArchitectures:architectures};
}
export async function bundleLocalNodeRuntime(input,outputArg) {
 if(process.platform!=='darwin')throw Error('macOS runtime input required.');
 const reviewed=await inspectReviewedNodeInput(input),source=reviewed.source,output=resolve(outputArg);
 if(!output.startsWith(join(developer,'.ynx-developer-candidates')+'/'))throw Error('Use a fresh owned candidate output.');
 const version=reviewed.version;
 // Validate the supplied unmodified upstream version-specific full license
 // before creating output; never substitute another runtime's notices.
 if(reviewed.kind==='official-node-installer')await validateReviewedNodeLicense(reviewed.license);
 await mkdir(output);await mkdir(join(output,'lib'));await mkdir(join(output,'notices'));
 const selected=new Map(),names=new Map(),packages=new Map();
 async function resolveDependency(dependency,owner) {
  if(system(dependency))return null;
  const expand=path=>path.replace(/^@loader_path/,dirname(owner)).replace(/^@executable_path/,dirname(source));
  const options=dependency.startsWith('@rpath/')?rpaths(owner).map(path=>join(expand(path),dependency.slice(7))):[expand(dependency)];
  for(const option of options)try{const found=await realpath(option);if(!found.startsWith('/opt/homebrew/Cellar/'))throw Error('Unreviewed non-system runtime library.');return found;}catch(error){if(error.code!=='ENOENT')throw error;}
  throw Error('Retained runtime dependency is unavailable: '+dependency);
 }
 async function visit(path,isNode=false) {
  if(selected.has(path))return;
  const name=isNode?'node':basename(path);if(names.has(name)&&names.get(name)!==path)throw Error('Conflicting library filenames.');names.set(name,path);
  const destination=join(output,isNode?'node':'lib/'+name),bytes=await readFile(path);
  const entry={input:path,path:isNode?'node':'lib/'+name,inputSha256:sha(bytes),dependencies:[]};selected.set(path,entry);
  if(isNode&&reviewed.kind==='official-node-installer')exec('/usr/bin/lipo',[path,'-thin',machoArch,'-output',destination]);else await copyFile(path,destination);await chmod(destination,0o755);
  if(reviewed.kind==='retained-homebrew'){const formula=path.slice('/opt/homebrew/Cellar/'.length).split('/').slice(0,2).join('/');packages.set(formula,join('/opt/homebrew/Cellar',formula));}
  for(const dependency of dependencies(path)){const resolved=await resolveDependency(dependency,path);entry.dependencies.push({original:dependency,resolved});if(resolved)await visit(resolved);}
 }
 await visit(source,true);
 const notices=[];
 async function retainNotices(root,formula,folder=root,depth=0) {
  if(depth>8)return;
  for(const name of await readdir(folder)){if(['node_modules','.git','bin','lib','include','pkgconfig'].includes(name))continue;const from=join(folder,name),stat=await lstat(from);if(stat.isDirectory())await retainNotices(root,formula,from,depth+1);else if(stat.isFile()&&(/^(licen[cs]e|copying|notice|copyright)/i.test(name)||name.endsWith('.rb')&&basename(folder)==='.brew'||name==='INSTALL_RECEIPT.json')){const dest=join(output,'notices',formula,relative(root,from));await mkdir(dirname(dest),{recursive:true});await copyFile(from,dest);notices.push({path:relative(output,dest),sha256:sha(await readFile(dest))});}}
 }
 for(const [formula,root]of packages)await retainNotices(root,formula);
 if(reviewed.kind==='official-node-installer'){
  const license=await validateReviewedNodeLicense(reviewed.license);
  for(const [name,bytes]of [['NODE-LICENSE.txt',await readFile(license.path)],['original-signature.txt',reviewed.originalSignature],['installer-receipt.plist',reviewed.installerReceipt]]){const path='notices/node24/'+name;await mkdir(dirname(join(output,path)),{recursive:true});await writeFile(join(output,path),bytes,{flag:'wx'});notices.push({path,sha256:sha(bytes)});}
 }
 for(const entry of selected.values()) {
  const target=join(output,entry.path);
  for(const dependency of entry.dependencies)if(dependency.resolved){const replacement=(entry.path==='node'?'@loader_path/lib/':'@loader_path/')+basename(dependency.resolved);exec('/usr/bin/install_name_tool',['-change',dependency.original,replacement,target]);dependency.bundled=replacement;}
  for(const path of rpaths(target))exec('/usr/bin/install_name_tool',['-delete_rpath',path,target]);
  if(entry.path!=='node')exec('/usr/bin/install_name_tool',['-id','@rpath/'+basename(target),target]);
  exec('/usr/bin/codesign',['--force','--sign','-',target]);
  const actual=dependencies(target);
  if(actual.some(path=>!system(path)&&!path.startsWith('@loader_path/')&&path!=='@rpath/'+basename(target)))throw Error('Runtime retains a nonportable library reference.');
  const commands=exec('/usr/bin/otool',['-l',target]),minimumOS=commands.match(/cmd LC_BUILD_VERSION\n\s+cmdsize \d+\n\s+platform 1\n\s+minos ([\d.]+)/)?.[1];
  if(!minimumOS||exec('/usr/bin/lipo',['-archs',target]).trim()!==machoArch)throw Error('Runtime architecture or macOS deployment target is invalid.');
  entry.minimumOS=minimumOS;entry.bundledSha256=sha(await readFile(target));entry.loadCommandsSha256=sha(commands);
 }
 const measured=exec(join(output,'node'),['--version']).trim();if(measured!==version)throw Error('Bundled runtime does not execute the retained version.');
 // The retained debugger respects its public watchdog execPath only when the
 // target's process.execPath does not use Node's conventional basename. This
 // entry is the exact already-linked and signed Node bytes, not another runtime.
 const nodeEntry=selected.get(source),aliasPath=join(output,'ynx-js-node');
 await copyFile(join(output,'node'),aliasPath);await chmod(aliasPath,0o755);
 if(sha(await readFile(aliasPath))!==nodeEntry.bundledSha256||exec(aliasPath,['--version']).trim()!==version)throw Error('JavaScript debug Node entry differs from the sealed runtime.');
 exec('/usr/bin/codesign',['--verify','--strict',aliasPath]);
 const aliasEntry={...nodeEntry,path:'ynx-js-node',derivedFrom:'node',dependencies:nodeEntry.dependencies.map(dependency=>({...dependency})),loadCommandsSha256:sha(exec('/usr/bin/otool',['-l',aliasPath]))};
 const compare=(a,b)=>{const x=a.split('.').map(Number),y=b.split('.').map(Number);for(let i=0;i<Math.max(x.length,y.length);i++){const d=(x[i]||0)-(y[i]||0);if(d)return d;}return 0;};
 const minimumOS=[...selected.values()].map(entry=>entry.minimumOS).sort(compare).at(-1);
 const record={schemaVersion:1,version,architecture:process.arch,minimumOS,source,sourceSha256:sha(await readFile(source)),sourceKind:reviewed.kind,...reviewed.originalSignature?{originalSignature:reviewed.originalSignature,originalArchitectures:reviewed.originalArchitectures,architectureDerivation:`lipo -thin ${process.arch}; original signed universal input is retained unchanged`,originalSigningClass:'developer-id-nodejs-foundation',licenseVerified:true}:{},signingClass:'adhoc-no-team-id',downloaded:false,lifecycleScriptsExecuted:false,files:[...selected.values(),aliasEntry],notices,executionVerified:true};
 await writeFile(join(output,'distribution.json'),JSON.stringify(record,null,2)+'\n',{flag:'wx'});return record;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){const r=await bundleLocalNodeRuntime(process.argv[2],process.argv[3]);console.log(JSON.stringify({output:resolve(process.argv[3]),version:r.version,minimumOS:r.minimumOS,files:r.files.length,notices:r.notices.length,executionVerified:r.executionVerified}));}
