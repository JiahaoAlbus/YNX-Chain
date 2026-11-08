// Private normal-producer filesystem DATA only. No Native load, build or grant.
import fs from'node:fs';import path from'node:path';import{createHash}from'node:crypto';
const fail=c=>{throw Object.assign(Error(c),{code:c})},sha=b=>createHash('sha256').update(b).digest('hex');
export const TASK_GRANT_LEXICAL_DEPENDENCY_ROOTS=Object.freeze(['/Volumes/西部数据/YNX-large-work/original-a-builds/native49-e966-normal-20261107/source-3c9']);
function canonical(p){return typeof p==='string'&&path.isAbsolute(p)&&path.normalize(p)===p&&!p.includes('\0')}
function directories(p,observed=[]){let current=path.parse(p).root;for(const part of p.slice(current.length).split('/').filter(Boolean)){current=path.join(current,part);const s=fs.lstatSync(current,{bigint:true});if(!s.isDirectory()||s.isSymbolicLink())fail('TASK_GRANT_DEPENDENCY_SYMLINK');observed.push({path:current,stat:s});}return fs.lstatSync(p,{bigint:true})}
function stable(a,b){return['dev','ino','uid','gid','size','mode','nlink','mtimeNs','ctimeNs'].every(k=>a[k]===b[k])}
function pinnedFile(p,pin){const fd=fs.openSync(p,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);try{const before=fs.fstatSync(fd,{bigint:true});if(!before.isFile()||before.nlink!==1n||before.size>268435456n||(before.mode&0o022n))fail('TASK_GRANT_DEPENDENCY_FILE');const bytes=fs.readFileSync(fd),after=fs.fstatSync(fd,{bigint:true}),named=fs.lstatSync(p,{bigint:true});if(!stable(before,after)||!stable(before,named)||named.isSymbolicLink())fail('TASK_GRANT_DEPENDENCY_DRIFT');if(bytes.length!==pin.bytes||sha(bytes)!==pin.sha256)fail('TASK_GRANT_DEPENDENCY_PIN');return{stat:before,bytes}}finally{fs.closeSync(fd)}}
export function readTaskGrantPinnedOriginalFileDATA(pin){if(!pin||!canonical(pin.path)||!Number.isSafeInteger(pin.bytes)||pin.bytes<0||pin.bytes>268435456||!/^[a-f0-9]{64}$/.test(pin.sha256))fail('TASK_GRANT_DEPENDENCY_SELECTED_PIN');directories(path.dirname(pin.path));return pinnedFile(pin.path,pin).bytes}
function alias(raw,pin,roots){
 const normalized=path.normalize(raw),root=roots.filter(r=>canonical(r)&&normalized.startsWith(r+'/')).sort((a,b)=>b.length-a.length)[0];
 if(!root||!raw.startsWith(root+'/'))fail('TASK_GRANT_DEPENDENCY_CROSS_ROOT');
 const observed=[],owner=directories(root,observed),parts=raw.slice(root.length+1).split('/');if(!parts.includes('..')||parts.some(x=>!x||x==='.')||normalized!==pin.path)fail('TASK_GRANT_DEPENDENCY_LEXICAL_ALIAS');
 let current=root,depth=0;
 for(let i=0;i<parts.length;i++){const part=parts[i];if(part==='..'){if(depth===0)fail('TASK_GRANT_DEPENDENCY_CROSS_ROOT');current=path.dirname(current);depth--;continue}current+='/'+part;depth++;const s=fs.lstatSync(current,{bigint:true});if(s.isSymbolicLink()||(i<parts.length-1&&!s.isDirectory()))fail('TASK_GRANT_DEPENDENCY_SYMLINK');if(s.uid!==owner.uid||s.gid!==owner.gid||(s.mode&0o022n))fail('TASK_GRANT_DEPENDENCY_OWNER');observed.push({path:current,stat:s});}
 if(current!==normalized)fail('TASK_GRANT_DEPENDENCY_LEXICAL_ALIAS');
 directories(path.dirname(pin.path),observed);if(fs.realpathSync(raw)!==pin.path||fs.realpathSync(pin.path)!==pin.path)fail('TASK_GRANT_DEPENDENCY_REALPATH');
 const selected=pinnedFile(pin.path,pin),actual=pinnedFile(raw,pin);if(!stable(selected.stat,actual.stat)||!selected.bytes.equals(actual.bytes))fail('TASK_GRANT_DEPENDENCY_IDENTITY');for(const item of observed){const now=fs.lstatSync(item.path,{bigint:true});if(now.isSymbolicLink()||['dev','ino','uid','gid','mode'].some(k=>now[k]!==item.stat[k]))fail('TASK_GRANT_DEPENDENCY_PATH_DRIFT');}if(fs.realpathSync(raw)!==pin.path||fs.realpathSync(pin.path)!==pin.path)fail('TASK_GRANT_DEPENDENCY_REALPATH');
 return Object.freeze({raw,canonicalPath:pin.path,bytes:pin.bytes,sha256:pin.sha256,dev:selected.stat.dev.toString(),ino:selected.stat.ino.toString(),uid:selected.stat.uid.toString(),gid:selected.stat.gid.toString(),sameFile:true});
}
function tokens(text){const out=[];let word='';for(let i=0;i<text.length;i++){const c=text[i];if(c==='\\'){const n=text[++i];if(n==='\n')continue;if(n==='\r'&&text[i+1]==='\n'){i++;continue}if(n===undefined)fail('TASK_GRANT_DEPENDENCY_MAKEFILE');word+=n}else if(/\s/.test(c)){if(word){out.push(word);word=''}}else word+=c}if(word)out.push(word);return out}
/** Caller is the exact fixed-profile gate. roots are reviewed producer DATA,
 * not a Source selector; normal entry always uses the finite constant above. */
export function inspectPinnedTaskGrantMakeDependenciesDATA(text,{source,output,inputPins,aliasRoots=TASK_GRANT_LEXICAL_DEPENDENCY_ROOTS,compileCwd=process.cwd()}){
 if(typeof text!=='string'||Buffer.byteLength(text)>2097152||!canonical(source)||!canonical(output)||!canonical(compileCwd)||fs.realpathSync(compileCwd)!==compileCwd)fail('TASK_GRANT_DEPENDENCY_BOUND');
 const colon=text.indexOf(':'),target=colon<0?[]:tokens(text.slice(0,colon));if(target.length!==1||target[0]!==output)fail('TASK_GRANT_DEPENDENCY_TARGET');
 const pins=new Map();for(const r of inputPins){if(!canonical(r.path)||!Number.isSafeInteger(r.bytes)||r.bytes<0||!/^[a-f0-9]{64}$/.test(r.sha256)||pins.has(r.path))fail('TASK_GRANT_DEPENDENCY_SELECTED_PIN');pins.set(r.path,r)}
 const resolved=new Map(),readbacks=[];
 for(const raw of new Set(tokens(text.slice(colon+1)))){
  if(!path.isAbsolute(raw)||raw.includes('\0'))fail('TASK_GRANT_DEPENDENCY_UNPINNED_OR_FOREIGN');const normalized=path.normalize(raw),pin=pins.get(normalized);if(!pin)fail('TASK_GRANT_DEPENDENCY_UNPINNED_OR_FOREIGN');
  if(raw!==normalized)readbacks.push(alias(raw,pin,aliasRoots));resolved.set(normalized,{...pin});
 }
 if(!resolved.has(source))fail('TASK_GRANT_DEPENDENCY_UNPINNED_OR_FOREIGN');
 return{source,output,resolvedInputs:[...resolved.values()],dependencyPathReadbacks:readbacks};
}
