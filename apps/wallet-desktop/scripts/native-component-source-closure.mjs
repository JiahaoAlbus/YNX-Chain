import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import path from 'node:path';
const RECORD='apps/wallet-desktop/native/original-auth-identity-build.json';
const fail=code=>{throw Object.assign(Error(code),{code});};
const relative=p=>typeof p==='string'&&p.length>0&&!p.startsWith('/')&&!p.includes('\\')&&!p.includes('\0')&&path.posix.normalize(p)===p&&!p.split('/').some(s=>s==='..'||s==='.'||!s);
const pin=b=>({bytes:b.length,sha256:createHash('sha256').update(b).digest('hex')});
/** Git-only source custody check, before costly packaging. A record pin or a
 * matching ignored disk file cannot replace its immutable source blob. This
 * does not regenerate records, compile, re-sign or qualify Native authority. */
export function inspectNativeComponentGitSourceClosure(root,commit,recordBytes){
 if(typeof root!=='string'||!path.isAbsolute(root)||path.normalize(root)!==root||typeof commit!=='string'||!/^[a-f0-9]{40}$/.test(commit)||!Buffer.isBuffer(recordBytes))fail('NATIVE_COMPONENT_GIT_CLOSURE_INPUT_INVALID');
 const git=(...args)=>execFileSync('git',['-C',root,...args],{maxBuffer:16<<20,stdio:['ignore','pipe','ignore']});
 let bound;try{bound=git('show',commit+':'+RECORD);}catch{fail('NATIVE_COMPONENT_GIT_RECORD_MISSING');}
 if(!bound.equals(recordBytes))fail('NATIVE_COMPONENT_GIT_RECORD_DIFFERS');
 let record;try{record=JSON.parse(recordBytes);}catch{fail('NATIVE_COMPONENT_GIT_RECORD_INVALID');}
 const rows=new Map(),counts={};
 for(const [role,input]of [['node',record.inputFiles],['helper',record.helperBuild?.inputFiles]]){
  if(!Array.isArray(input)||input.length===0)fail('NATIVE_COMPONENT_GIT_RECORD_INVALID');const seen=new Set();counts[role]=input.length;
  for(const row of input){
   if(!row||Object.keys(row).sort().join('|')!=='bytes|relative|sha256'||!relative(row.relative)||seen.has(row.relative)||!Number.isSafeInteger(row.bytes)||row.bytes<1||row.bytes>(16<<20)||!/^[a-f0-9]{64}$/.test(row.sha256))fail('NATIVE_COMPONENT_GIT_RECORD_INVALID');
   seen.add(row.relative);let current=rows.get(row.relative);
   if(current&&(current.bytes!==row.bytes||current.sha256!==row.sha256))fail('NATIVE_COMPONENT_GIT_ROLE_CONFLICT');
   if(!current){current={...row,roles:[]};rows.set(row.relative,current);}current.roles.push(role);
  }
 }
 const defects=[];
 for(const row of rows.values()){
  let bytes,entry;try{entry=git('ls-tree',commit,'--',row.relative).toString();bytes=git('show',commit+':'+row.relative);}catch{defects.push({...row,reason:'GIT_SOURCE_MISSING'});continue;}
  const actual=pin(bytes);
  if(!/^(100644|100755) blob [a-f0-9]{40}\t/.test(entry)||actual.bytes!==row.bytes||actual.sha256!==row.sha256)defects.push({...row,reason:'GIT_SOURCE_DIFFERS',actual});
 }
 return {kind:'YNX_NATIVE_COMPONENT_GIT_SOURCE_CLOSURE/v1',sourceCommit:commit,record:{path:RECORD,...pin(bound)},counts,unique:rows.size,complete:defects.length===0,defects,NativeCompiled:false,SourceQualified:false};
}
export function assertNativeComponentGitSourceClosure(root,commit,recordBytes){
 const result=inspectNativeComponentGitSourceClosure(root,commit,recordBytes);
 if(!result.complete)throw Object.assign(Error('NATIVE_COMPONENT_GIT_SOURCE_CLOSURE_DIFFERS'),{code:'NATIVE_COMPONENT_GIT_SOURCE_CLOSURE_DIFFERS',closure:result});
 return result;
}
