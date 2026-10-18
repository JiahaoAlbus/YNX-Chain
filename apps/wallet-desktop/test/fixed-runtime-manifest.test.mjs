import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fixedSDKRuntimeManifestSources} from '../scripts/release-provenance.mjs';
const root=process.env.WALLET_SDK330_COMPOSED_SOURCE;
const selected='c092470c27f3698af9161af15b45b31748017b67';
const name='packages/wallet-auth/native/original-ide-auth-runtime-manifest.json';
const original=root?execFileSync('git',['show',`${selected}:${name}`],{cwd:root}):Buffer.from('{}');
function fixture(version,bytes,run){
 const dir=mkdtempSync(path.join(tmpdir(),'wallet-fixed-manifest-'));
 try{
  mkdirSync(path.join(dir,'packages/wallet-auth/native'),{recursive:true});
  writeFileSync(path.join(dir,'packages/wallet-auth/package.json'),JSON.stringify({version}));
  if(bytes)writeFileSync(path.join(dir,name),bytes);
  const git=(...args)=>execFileSync('git',args,{cwd:dir,stdio:'pipe'});
  git('init','-q');git('add','.');git('-c','user.name=QA','-c','user.email=qa@example.invalid','commit','-qm','fixture');
  run(dir);
 }finally{rmSync(dir,{recursive:true,force:true});}
}
test('actual composed SDK330 selects only its independent fixed manifest',{skip:!root&&'requires independently composed SDK330 source'},()=>{
 assert.deepEqual(fixedSDKRuntimeManifestSources(root,selected),[name]);
});
test('same SDK version cannot admit changed, empty or missing manifest',()=>{
 for(const bytes of [Buffer.concat([original,Buffer.from('\n')]),Buffer.from('{}'),null])
  fixture('1.3.0-pq.3.30-auth.1',bytes,dir=>assert.throws(()=>fixedSDKRuntimeManifestSources(dir,'HEAD'),/runtime manifest/));
});
test('unknown SDK cannot inherit manifest permission; legacy without manifest stays unchanged',()=>{
 fixture('1.3.0-pq.3.999-auth.1',original,dir=>assert.throws(()=>fixedSDKRuntimeManifestSources(dir,'HEAD'),/runtime manifest/));
 fixture('1.3.0-pq.3.18',null,dir=>assert.deepEqual(fixedSDKRuntimeManifestSources(dir,'HEAD'),[]));
});
