import fs from'node:fs';import path from'node:path';import crypto from'node:crypto';import{spawnSync}from'node:child_process';import{fileURLToPath}from'node:url';
const digest=b=>crypto.createHash('sha256').update(b).digest('hex');
export function pinRegular(file){const s=fs.lstatSync(file);if(!s.isFile()||s.isSymbolicLink())throw Error('NATIVE_RUNTIME_REGULAR_FILE_REQUIRED');const b=fs.readFileSync(file);return{path:file,bytes:b.length,sha256:digest(b)};}
function checked(row){if(!row||!path.isAbsolute(row.path)||!Number.isSafeInteger(row.bytes)||row.bytes<1||row.bytes>128*1024*1024||!/^[a-f0-9]{64}$/.test(row.sha256))throw Error('NATIVE_RUNTIME_INPUT_SHAPE');const fd=fs.openSync(row.path,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);try{const a=fs.fstatSync(fd),named=fs.lstatSync(row.path);if(!a.isFile()||a.size!==row.bytes||a.dev!==named.dev||a.ino!==named.ino)throw Error('NATIVE_RUNTIME_INPUT_IDENTITY');const b=Buffer.alloc(row.bytes+1);let at=0;while(at<b.length){const n=fs.readSync(fd,b,at,b.length-at,at);if(n===0)break;at+=n;}const z=fs.fstatSync(fd),after=fs.lstatSync(row.path);if(at!==row.bytes||digest(b.subarray(0,at))!==row.sha256||a.dev!==z.dev||a.ino!==z.ino||a.size!==z.size||a.mtimeMs!==z.mtimeMs||a.ctimeMs!==z.ctimeMs||z.dev!==after.dev||z.ino!==after.ino)throw Error('NATIVE_RUNTIME_INPUT_CHANGED');return b.subarray(0,at);}finally{fs.closeSync(fd);}}
function existingParent(parent){for(let p=parent;;p=path.dirname(p)){const s=fs.lstatSync(p);if(!s.isDirectory()||s.isSymbolicLink())throw Error('NATIVE_RUNTIME_PARENT_NOT_REAL');if(path.dirname(p)===p)break;}}
function writeOwned(file,b,mode=0o755){const fd=fs.openSync(file,'wx',mode);try{fs.writeFileSync(fd,b);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
function tool(command,args){const r=spawnSync(command,args,{encoding:'utf8',maxBuffer:32*1024*1024});if(r.status!==0)throw Object.assign(Error('NATIVE_RUNTIME_TOOL_FAILED'),{command,args,status:r.status,output:(r.stdout??'')+(r.stderr??'')});return r.stdout;}
function identity(file){return tool('/usr/bin/otool',['-D',file]).split('\n').slice(1).map(s=>s.trim()).filter(Boolean)[0]??null;}
function deps(file){const own=identity(file);return tool('/usr/bin/otool',['-L',file]).split('\n').slice(1).map(s=>s.trim().split(' (compatibility version')[0]).filter(s=>s&&s!==own);}
const system=name=>name.startsWith('/System/Library/')||name.startsWith('/usr/lib/');
const names=['libssl.3.dylib','libcrypto.3.dylib','libuv.1.dylib'];
/** Build/pack DATA operation, not a Root/Source getter. Only fresh output is
 * written; no input image, old receipt, library or application is modified. */
function relocateImpl(plan,owned){
 if(process.platform!=='darwin'||plan?.version!==1||plan.adhocQA!==true||typeof plan.outputDirectory!=='string'||!path.isAbsolute(plan.outputDirectory)||path.normalize(plan.outputDirectory)!==plan.outputDirectory)throw Error('NATIVE_RUNTIME_PLAN_INVALID');
 if(!Array.isArray(plan.libraries)||plan.libraries.length!==3||plan.libraries.some((r,i)=>r.name!==names[i]))throw Error('NATIVE_RUNTIME_EXACT_THREE_REQUIRED');
 const input=checked(plan.inputModule),libraryBytes=plan.libraries.map(r=>checked(r.input));
 for(const r of plan.libraries)for(const license of r.licenses??[])checked(license.input);
 existingParent(path.dirname(plan.outputDirectory));fs.mkdirSync(plan.outputDirectory,{mode:0o755});owned.directory=plan.outputDirectory;
 const libraryDirectory=path.join(plan.outputDirectory,'original-auth-runtime-libs');fs.mkdirSync(libraryDirectory,{mode:0o755});
 const outputModule=path.join(plan.outputDirectory,'original-auth-identity.node');writeOwned(outputModule,input);
 const outputs=plan.libraries.map((r,i)=>{const file=path.join(libraryDirectory,r.name);writeOwned(file,libraryBytes[i]);return file;});
 const aliases=new Map();for(const[r,i]of plan.libraries.map((r,i)=>[r,i])){
  if(r.originalInput&&(r.originalInput.bytes!==r.input.bytes||r.originalInput.sha256!==r.input.sha256||!path.isAbsolute(r.originalInput.path)))throw Error('NATIVE_RUNTIME_ORIGINAL_INPUT_DIFFERS');
  for(const alias of[r.input.path,r.originalInput?.path,identity(r.input.path)])if(alias){if(aliases.has(alias)&&aliases.get(alias)!==i)throw Error('NATIVE_RUNTIME_ALIAS_COLLISION');aliases.set(alias,i);}
 }
 const edits=[];
 for(const[file,index]of[[outputModule,-1],...outputs.map((p,i)=>[p,i])]){
  const own=identity(file);if(own)tool('/usr/bin/install_name_tool',['-id',index<0?'@rpath/original-auth-identity.node':'@rpath/'+names[index],file]);
  for(const dependency of deps(file)){
   if(system(dependency))continue;
   const target=aliases.get(dependency);if(target===undefined)throw Error('NATIVE_RUNTIME_UNREGISTERED_DEPENDENCY:'+dependency);
   const replacement=index<0?'@loader_path/original-auth-runtime-libs/'+names[target]:'@loader_path/'+names[target];
   tool('/usr/bin/install_name_tool',['-change',dependency,replacement,file]);edits.push({file,from:dependency,to:replacement});
  }
 }
 const licenseFiles=[],licenseByName=new Map();
 for(const r of plan.libraries)for(const l of r.licenses??[]){
  if(typeof l.name!=='string'||!/^[A-Za-z0-9_.-]+$/.test(l.name))throw Error('NATIVE_RUNTIME_LICENSE_NAME');
  const file=path.join(libraryDirectory,l.name),previous=licenseByName.get(l.name);
  if(previous){if(previous.bytes!==l.input.bytes||previous.sha256!==l.input.sha256)throw Error('NATIVE_RUNTIME_LICENSE_COLLISION');continue;}
  writeOwned(file,checked(l.input),0o644);const p=pinRegular(file);licenseFiles.push(p);licenseByName.set(l.name,p);
 }
 // Restore invalidated linker/ad-hoc signatures only after all Mach-O edits.
 // This uses '-' and no certificate/private identity. Source signing stays off.
 for(const file of[...outputs,outputModule]){tool('/usr/bin/codesign',['--force','--sign','-','--timestamp=none',file]);tool('/usr/bin/codesign',['--verify','--strict',file]);}
 const readback=[];
 for(const[file,index]of[[outputModule,-1],...outputs.map((p,i)=>[p,i])]){
  const dependencies=deps(file);for(const dependency of dependencies){if(system(dependency))continue;const prefix=index<0?'@loader_path/original-auth-runtime-libs/':'@loader_path/';if(!dependency.startsWith(prefix)||!names.includes(dependency.slice(prefix.length)))throw Error('NATIVE_RUNTIME_NOT_PORTABLE:'+dependency);const resolved=path.resolve(path.dirname(file),dependency.slice('@loader_path/'.length));if(!outputs.includes(resolved))throw Error('NATIVE_RUNTIME_RELATIVE_ESCAPE');pinRegular(resolved);}
  readback.push({file:pinRegular(file),id:identity(file),dependencies,signature:'ad-hoc-verified'});
 }
 checked(plan.inputModule);for(const r of plan.libraries)checked(r.input);
 const result={version:1,state:'RELOCATED_ADHOC_QA_COMPONENT_NOT_ELECTRON_QUALIFIED',inputModule:plan.inputModule,outputModule:pinRegular(outputModule),libraries:readback.slice(1),readback,licenseFiles,sourceMapping:plan.libraries.map(r=>({name:r.name,input:r.input,source:r.source,licenses:r.licenses})),edits,adhocCodeSigned:true,productionCodeSigned:false,SourceSigned:false,RootAdmission:false,SourceAdmission:false,ElectronLoad:false,installed:false,recordMayNowBeGenerated:true,recordOrdering:'all relocation and nested dylib/Node code signing precede hashing/record/asar; any later nested re-sign requires new hashes, record, asar and outer signature'};
 writeOwned(path.join(plan.outputDirectory,'PORTABLE_RUNTIME_RESULT.json'),Buffer.from(JSON.stringify(result,null,2)+'\n'),0o644);return result;
}
export function relocateOriginalAuthRuntime(plan){
 const owned={directory:null};
 try{return relocateImpl(plan,owned);}catch(cause){
  if(owned.directory&&cause&&(typeof cause==='object'||typeof cause==='function'))Object.defineProperty(cause,'partial',{value:Object.freeze({directory:owned.directory,owned:true,recordMayNowBeGenerated:false,SourceAdmission:false}),enumerable:false});
  throw cause;
 }
}
if(process.argv[1]===fileURLToPath(import.meta.url)){if(process.argv.length!==3)throw Error('NATIVE_RUNTIME_ARGUMENTS');const plan=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));process.stdout.write(JSON.stringify(relocateOriginalAuthRuntime(plan),null,2)+'\n');}
