import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
test('actual Native decision journal uses create-only protected reservations and retains UNKNOWN',{skip:process.platform!=='darwin'},async()=>{
 const root=fileURLToPath(new URL('..',import.meta.url)),temp=await fs.mkdtemp(path.join(os.tmpdir(),'ynx-control-journal-public-'));
 try{
  const binary=path.join(temp,'public-journal');
  const build=spawnSync('/usr/bin/clang++',['-std=c++17','-fobjc-arc','-DYNX_CONTROL_JOURNAL_PUBLIC_TEST=1','-framework','Foundation','-framework','Security','-framework','LocalAuthentication',path.join(root,'native/original-project-control-journal.mm'),path.join(root,'test/native/project-control-journal-public.mm'),'-o',binary],{encoding:'utf8',timeout:30000});
  assert.equal(build.status,0,build.stderr);const run=spawnSync(binary,[],{encoding:'utf8',timeout:10000});assert.equal(run.status,0,run.stderr);
  assert.deepEqual(JSON.parse(run.stdout),{cases:10,systemKeychainCalls:0,SourceQualified:false,signing:false});
 }finally{await fs.rm(temp,{recursive:true,force:true});}
});
