import {readFile,writeFile,mkdir,copyFile,realpath,readdir,lstat,chmod} from 'node:fs/promises';
import {dirname,join,resolve,basename,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const developer=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const sha=b=>createHash('sha256').update(b).digest('hex');
const exec=(command,args)=>execFileSync(command,args,{encoding:'utf8',maxBuffer:16*1024*1024,env:{PATH:'/usr/bin:/bin:/usr/sbin:/sbin'}});
const dependencies=path=>exec('/usr/bin/otool',['-L',path]).split('\n').slice(1).map(line=>line.trim().split(' (')[0]).filter(Boolean);
const rpaths=path=>[...exec('/usr/bin/otool',['-l',path]).matchAll(/cmd LC_RPATH\n\s+cmdsize \d+\n\s+path (.+?) \(offset/g)].map(match=>match[1]);
const system=path=>path.startsWith('/usr/lib/')||path.startsWith('/System/');
export async function bundleLocalNodeRuntime(input,outputArg) {
 if(process.platform!=='darwin')throw Error('macOS runtime input required.');
 const source=await realpath(input),output=resolve(outputArg);
 if(!source.startsWith('/opt/homebrew/Cellar/node/'))throw Error('Use the retained local Node input.');
 if(!output.startsWith(join(developer,'.ynx-developer-candidates')+'/'))throw Error('Use a fresh owned candidate output.');
 const version=exec(source,['--version']).trim();if(!/^v26\./.test(version))throw Error('Node 26 is required.');
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
  await copyFile(path,destination);await chmod(destination,0o755);
  const formula=path.slice('/opt/homebrew/Cellar/'.length).split('/').slice(0,2).join('/');packages.set(formula,join('/opt/homebrew/Cellar',formula));
  for(const dependency of dependencies(path)){const resolved=await resolveDependency(dependency,path);entry.dependencies.push({original:dependency,resolved});if(resolved)await visit(resolved);}
 }
 await visit(source,true);
 const notices=[];
 async function retainNotices(root,formula,folder=root,depth=0) {
  if(depth>8)return;
  for(const name of await readdir(folder)){if(['node_modules','.git','bin','lib','include','pkgconfig'].includes(name))continue;const from=join(folder,name),stat=await lstat(from);if(stat.isDirectory())await retainNotices(root,formula,from,depth+1);else if(stat.isFile()&&(/^(licen[cs]e|copying|notice|copyright)/i.test(name)||name.endsWith('.rb')&&basename(folder)==='.brew'||name==='INSTALL_RECEIPT.json')){const dest=join(output,'notices',formula,relative(root,from));await mkdir(dirname(dest),{recursive:true});await copyFile(from,dest);notices.push({path:relative(output,dest),sha256:sha(await readFile(dest))});}}
 }
 for(const [formula,root]of packages)await retainNotices(root,formula);
 for(const entry of selected.values()) {
  const target=join(output,entry.path);
  for(const dependency of entry.dependencies)if(dependency.resolved){const replacement=(entry.path==='node'?'@loader_path/lib/':'@loader_path/')+basename(dependency.resolved);exec('/usr/bin/install_name_tool',['-change',dependency.original,replacement,target]);dependency.bundled=replacement;}
  for(const path of rpaths(target))exec('/usr/bin/install_name_tool',['-delete_rpath',path,target]);
  if(entry.path!=='node')exec('/usr/bin/install_name_tool',['-id','@rpath/'+basename(target),target]);
  exec('/usr/bin/codesign',['--force','--sign','-',target]);
  const actual=dependencies(target);
  if(actual.some(path=>!system(path)&&!path.startsWith('@loader_path/')&&path!=='@rpath/'+basename(target)))throw Error('Runtime retains a nonportable library reference.');
  const commands=exec('/usr/bin/otool',['-l',target]),minimumOS=commands.match(/cmd LC_BUILD_VERSION\n\s+cmdsize \d+\n\s+platform 1\n\s+minos ([\d.]+)/)?.[1];
  if(!minimumOS||exec('/usr/bin/lipo',['-archs',target]).trim()!==process.arch)throw Error('Runtime architecture or macOS deployment target is invalid.');
  entry.minimumOS=minimumOS;entry.bundledSha256=sha(await readFile(target));entry.loadCommandsSha256=sha(commands);
 }
 const measured=exec(join(output,'node'),['--version']).trim();if(measured!==version)throw Error('Bundled runtime does not execute the retained version.');
 const compare=(a,b)=>{const x=a.split('.').map(Number),y=b.split('.').map(Number);for(let i=0;i<Math.max(x.length,y.length);i++){const d=(x[i]||0)-(y[i]||0);if(d)return d;}return 0;};
 const minimumOS=[...selected.values()].map(entry=>entry.minimumOS).sort(compare).at(-1);
 const record={schemaVersion:1,version,architecture:process.arch,minimumOS,source,sourceSha256:sha(await readFile(source)),signingClass:'adhoc-no-team-id',downloaded:false,lifecycleScriptsExecuted:false,files:[...selected.values()],notices,executionVerified:true};
 await writeFile(join(output,'distribution.json'),JSON.stringify(record,null,2)+'\n',{flag:'wx'});return record;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){const r=await bundleLocalNodeRuntime(process.argv[2],process.argv[3]);console.log(JSON.stringify({output:resolve(process.argv[3]),version:r.version,minimumOS:r.minimumOS,files:r.files.length,notices:r.notices.length,executionVerified:r.executionVerified}));}
