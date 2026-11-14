import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
const exec=promisify(execFile);
test('normal Finder launch resolves an isolated stable QA profile without environment or user migration',{skip:process.platform!=='darwin',timeout:60000},async t=>{
 const dir=await mkdtemp(join(tmpdir(),'ynx-qa-profile-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const binary=join(dir,'profile-proof');
 await exec('/usr/bin/clang',['-fobjc-arc',`-fmodules-cache-path=${dir}/module-cache`,fileURLToPath(new URL('./fixtures/macos-qa-profile.m',import.meta.url)),'-o',binary,'-framework','Foundation'],{timeout:45000});
 const result=await exec(binary,[]);assert.match(result.stdout,/native default QA isolation/);
});
