// PUBLIC test/build harness only. Never a production installer or permission.
// Select actual strict Auth closure AND original WC recipe dependencies; npm's
// developer .bin aliases are not normal prefix inputs. App316 is NOT verified.
import fs from'node:fs';import path from'node:path';import{createHash}from'node:crypto';
import{generateAuthRuntimeClosure}from'../../scripts/auth-runtime-closure.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
const equal=(a,b)=>['dev','ino','size','mtimeMs','ctimeMs','nlink','mode'].every(k=>a[k]===b[k]);
export function copyActualNormalDependencySelection(pkg,target,recipe){
 const source=path.resolve(pkg),out=path.resolve(target);if(source===out||out.startsWith(source+path.sep))throw Error('PUBLIC_DEPENDENCY_OUTPUT_OVERLAP');
 const graph=generateAuthRuntimeClosure(source,{entries:recipe.entries});
 const selected=new Set([...recipe.walletConnect.files,...graph.manifest.files].filter(r=>r.path.startsWith('node_modules/')).map(r=>r.path));
 if(recipe.walletConnect.installedLock)selected.add(recipe.walletConnect.installedLock.path);
 const rows=[];for(const relative of[...selected].sort()){
  if(relative.includes('\\')||!relative.startsWith('node_modules/')||relative.split('/').some(x=>!x||x==='.'||x==='..')||relative.startsWith('node_modules/.bin/'))throw Error('PUBLIC_DEPENDENCY_SELECTION_PATH');
  const from=path.join(source,relative),to=path.join(out,relative),before=fs.lstatSync(from);
  if(!before.isFile()||before.isSymbolicLink()||before.nlink!==1||fs.realpathSync(from)!==from)throw Error('PUBLIC_DEPENDENCY_ALIAS');
  const fd=fs.openSync(from,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);let raw;
  try{if(!equal(before,fs.fstatSync(fd)))throw Error('PUBLIC_DEPENDENCY_CHANGED');raw=fs.readFileSync(fd);if(!equal(before,fs.fstatSync(fd))||!equal(before,fs.lstatSync(from)))throw Error('PUBLIC_DEPENDENCY_CHANGED');}finally{fs.closeSync(fd);}
  fs.mkdirSync(path.dirname(to),{recursive:true});fs.writeFileSync(to,raw,{flag:'wx',mode:before.mode&0o777});if(!fs.readFileSync(to).equals(raw))throw Error('PUBLIC_DEPENDENCY_COPY_BYTES');
  rows.push({path:relative,bytes:raw.length,sha256:sha(raw)});
 }
 if(!rows.some(r=>r.path.startsWith('node_modules/typescript/')))throw Error('PUBLIC_TYPESCRIPT_NOT_SELECTED');
 return Object.freeze({rows,selectedActualFiles:rows.length,strictAuthFiles:graph.manifest.files.length,strictAuthEdges:graph.report.edges.length,installedLockIncluded:!!recipe.walletConnect.installedLock,sourceDeveloperBinObserved:fs.existsSync(source+'/node_modules/.bin'),developerBinCopied:false,App316Verified:false,RootAdmission:false,SourceAdmission:false});
}
