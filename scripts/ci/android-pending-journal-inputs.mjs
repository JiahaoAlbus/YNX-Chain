import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
export const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
export const roleRelative='packages/wallet-auth/native/android-pending-producer-role';
export const role=path.join(root,roleRelative);
export const fixture=path.join(root,'packages/wallet-auth/test/fixtures/android-pending-journal-ci');
const sha=b=>createHash('sha256').update(b).digest('hex');
export function verifyJournalInputs(fileRoot=root){
 const baseline=JSON.parse(fs.readFileSync(path.join(role,'BASELINE.json'),'utf8'));
 const intake=JSON.parse(fs.readFileSync(path.join(role,'JOURNAL_INTAKE.json'),'utf8'));
 if(intake.CAS.length!==6||intake.CAS.filter(x=>x.operation==='MOD').length!==4||intake.CAS.filter(x=>x.operation==='ADD').length!==2||intake.production.length!==37||baseline.source.length!==35)throw Error('SIX_CAS_REQUIRED');
 const expected=new Map(baseline.source.map(x=>[x.logical,x]));
 for(const x of intake.CAS){
  const old=expected.get(x.logical);
  if(x.operation==='MOD'){
   if(!old||old.sha256!==x.before.sha256||old.bytes!==x.before.bytes)throw Error('CAS_BEFORE_ROLE');
   const b=execFileSync('git',['show',intake.baselineCommit+':'+old.path],{cwd:root,maxBuffer:1024*1024});
   if(b.length!==x.before.bytes||sha(b)!==x.before.sha256)throw Error('CAS_GIT_BEFORE');
  }else if(old||x.before!==null)throw Error('CAS_ADD_PRESENT');
  expected.set(x.logical,{path:x.path,...x.after});
 }
 for(const x of intake.production){const e=expected.get(x.logical);if(!e||e.path!==x.path||e.sha256!==x.sha256||e.bytes!==x.bytes)throw Error('RETAINED_SOURCE_CHANGED');}
 for(const x of [...intake.production,...intake.controls]){
  const p=path.resolve(fileRoot,x.path);if(!p.startsWith(path.resolve(fileRoot)+path.sep)||!fs.lstatSync(p).isFile())throw Error('JOURNAL_INPUT_PATH');
  const b=fs.readFileSync(p);if(b.length!==x.bytes||sha(b)!==x.sha256)throw Error('JOURNAL_INPUT_BYTES:'+x.path);
 }
 return intake;
}
export function assertStrongJournalExport(text,name){
 const rows=text.split('\n').filter(x=>x.trim().split(/\s+/).at(-1)===name);
 if(rows.length!==1||rows[0].trim().split(/\s+/).at(-2)!=='T')throw Error('JOURNAL_STRONG_EXPORT');
}
