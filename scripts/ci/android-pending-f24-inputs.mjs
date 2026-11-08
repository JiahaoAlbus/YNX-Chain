import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {root,role,fixture} from './android-pending-journal-inputs.mjs';
export {root,role,fixture};
export const f24Fixture=path.join(root,'packages/wallet-auth/test/fixtures/android-pending-f24-ci');
const sha=b=>createHash('sha256').update(b).digest('hex');
export function verifyF24Inputs(fileRoot=root){
 const intake=JSON.parse(fs.readFileSync(path.join(role,'JOURNAL_INTAKE.json'),'utf8'));
 const f=JSON.parse(fs.readFileSync(path.join(role,'F24_SUCCESSOR.json'),'utf8'));
 if(f.beforeCommit!=='f8cf3f88f42cf171adf8d024436606cacd914179'||f.productionMOD!==1||f.logical!=='source/PendingProducer.cpp')throw Error('F24_ONE_MOD_REQUIRED');
 const previous=intake.production.find(x=>x.path===f.path);
 if(!previous||previous.bytes!==f.before.bytes||previous.sha256!==f.before.sha256)throw Error('F24_BEFORE_ROLE');
 const before=execFileSync('git',['show',f.beforeCommit+':'+f.path],{cwd:root,maxBuffer:1024*1024});
 if(before.length!==f.before.bytes||sha(before)!==f.before.sha256)throw Error('F24_GIT_BEFORE');
 for(const x of [...intake.production,...intake.controls,f.controls]){
  const expected=x.path===f.path?{...x,...f.after}:x,p=path.resolve(fileRoot,x.path);
  if(!p.startsWith(path.resolve(fileRoot)+path.sep)||!fs.lstatSync(p).isFile())throw Error('F24_INPUT_PATH');
  const b=fs.readFileSync(p);if(b.length!==expected.bytes||sha(b)!==expected.sha256)throw Error('F24_INPUT_BYTES:'+x.path);
 }
 return{intake,successor:f};
}
