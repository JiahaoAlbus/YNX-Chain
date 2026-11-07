import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const root=path.resolve(import.meta.dirname,'../..');
const pkg=path.join(root,'packages/wallet-auth');
const out=path.join(root,'social-f06-directory-data-controls');
fs.mkdirSync(path.join(out,'empty-type-roots'),{recursive:true});
const commands=[['--test','test/social-f06-directory-readonly-data.test.mjs'],[path.join(pkg,'node_modules/typescript/bin/tsc'),'--noEmit','--strict','--module','NodeNext','--target','ES2022','--typeRoots',path.join(out,'empty-type-roots'),'test/social-f06-directory-readonly-data.types.mts']];
const results=[];
for(let i=0;i<commands.length;i++){
 const r=spawnSync(process.execPath,commands[i],{cwd:pkg,encoding:'utf8'});
 fs.writeFileSync(path.join(out,`${i}.stdout`),r.stdout??'');fs.writeFileSync(path.join(out,`${i}.stderr`),r.stderr??'');
 results.push({argv:[process.execPath,...commands[i]],status:r.status,signal:r.signal,error:r.error?.message??null});
 fs.writeFileSync(path.join(out,'RESULT.json'),JSON.stringify({results,rootQualified:false,sourceQualified:false,directoryReadExecuted:false},null,2)+'\n');
 if(r.status!==0||r.signal||r.error)throw Error(`SOCIAL_F06_DIRECTORY_DATA_CONTROL_FAILED:${i}`);
}
console.log('Social F06 private Node DATA: seven new controls and strict declarations PASS; no Native/Root read.');
