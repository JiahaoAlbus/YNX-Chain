import {readFileSync,mkdirSync,writeFileSync,existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {resolve,isAbsolute,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
const repo=resolve(dirname(fileURLToPath(import.meta.url)),'../../../..');
const manifest=JSON.parse(readFileSync(new URL('../testdata/pay-original-operation-source.json',import.meta.url)));
const target=process.argv[2];
if(!target||!isAbsolute(target)||existsSync(target)||!/^[0-9a-f]{40}$/.test(manifest.sourceCommit)||manifest.source.length!==9)throw Error('Exact new test source directory and pinned input required');
try{execFileSync('git',['cat-file','-e',`${manifest.sourceCommit}^{commit}`],{cwd:repo,stdio:'ignore'});}catch{execFileSync('git',['fetch','--no-tags','--depth=1','origin',manifest.sourceCommit],{cwd:repo,stdio:'inherit'});}
const seen=new Set(),content=[];
for(const file of manifest.source){
 if(!/^apps\/pay\/native\/r6\/[a-z][a-z0-9-]*\.mjs$/.test(file.relative)||seen.has(file.relative))throw Error('Unexpected source path');
 seen.add(file.relative);const bytes=execFileSync('git',['show',`${manifest.sourceCommit}:${file.relative}`],{cwd:repo});
 if(bytes.length!==file.bytes||createHash('sha256').update(bytes).digest('hex')!==file.sha256)throw Error('Original supplier source drift');
 content.push([file.relative,bytes]);
}
mkdirSync(target);
for(const [relative,bytes] of content){const path=join(target,relative);mkdirSync(dirname(path),{recursive:true});writeFileSync(path,bytes,{flag:'wx'});}
process.stdout.write('Pinned nine original Pay modules for controlled tests only\n');
