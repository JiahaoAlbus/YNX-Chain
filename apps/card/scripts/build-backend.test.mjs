import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,symlink,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {buildCardBackend} from './build-backend.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
test('fresh CJS envelope resolves registry and locked dependencies before the original protected refusal',async t=>{
 const parent=await mkdtemp(join(tmpdir(),'card-backend-packaging-'));t.after(()=>rm(parent,{recursive:true,force:true}));
 const output=join(parent,'candidate'),manifest=await buildCardBackend(output);
 assert.equal(manifest.entry,'server/main.cjs');assert.equal(manifest.format,'commonjs');
 assert.equal(manifest.dependencyMode,'EXTERNAL_LOCKED_INSTALL_REQUIRED');assert.equal(manifest.privateRuntimeReady,false);
 for(const file of manifest.files){const bytes=await readFile(join(output,file.path));assert.equal(bytes.length,file.bytes);assert.equal(createHash('sha256').update(bytes).digest('hex'),file.sha256)}
 // Reuse installed locked dependencies only in this disposable test environment.
 await symlink(join(root,'node_modules'),join(output,'node_modules'),'dir');
 const result=spawnSync(process.execPath,[join(output,manifest.entry)],{cwd:output,encoding:'utf8',timeout:5000,env:{PATH:process.env.PATH??'',YNX_CARD_AUTH_ADAPTER_MODULE:join(output,'server/sharedWalletAuth.ts')}});
 assert.equal(result.error,undefined);assert.equal(result.signal,null);assert.equal(result.status,1);
 assert.match(result.stderr,/CARD_PROTECTED_RUNTIME_SOURCE_UNAVAILABLE\s*$/);
 assert.doesNotMatch(result.stderr,/ERR_MODULE_NOT_FOUND|__dirname is not defined/);
 assert.equal(result.stdout,'');
 await assert.rejects(buildCardBackend(output),error=>error.code==='EEXIST');
 assert.equal(JSON.parse(await readFile(join(output,'backend-files.json'),'utf8')).sourceCommit,manifest.sourceCommit);
});
