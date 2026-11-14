import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {packageDesktopEntry} from '../scripts/package-desktop-entry.mjs';
import {verifyPackagedLocalImports} from '../scripts/verify-packaged-local-imports.mjs';
import {fileURLToPath} from 'node:url';

test('relocated actual desktop entry resolves static imports before enforcing original provenance',async t=>{
 const root=await mkdtemp(join(tmpdir(),'ynx-entry-relocation-')),resources=join(root,'Resources');t.after(()=>rm(root,{recursive:true,force:true}));await mkdir(resources);
 // Reproduce the exact shipping copy first: import resolution fails before
 // even reaching the invalid-provenance guard. No user state/server is opened.
 const copied=join(resources,'copied.mjs');await writeFile(copied,await readFile(new URL('../desktop/code-server.mjs',import.meta.url)));
 await writeFile(join(resources,'build-provenance.json'),'{}');
 const red=spawnSync(process.execPath,[copied],{encoding:'utf8',timeout:10000});assert.equal(red.status,1);assert.match(red.stderr,/ERR_MODULE_NOT_FOUND/);assert.match(red.stderr,/session-key/);
 const developer=fileURLToPath(new URL('../',import.meta.url));
 await assert.rejects(verifyPackagedLocalImports(developer,{serverEntry:copied}),/session-key/);
 const output=join(resources,'server.mjs'),entry=await packageDesktopEntry(output);
 assert.ok(entry.staticSourceInputs.some(x=>x.path==='services/workspace-agent/src/session-key.mjs'));
 const verified=spawnSync(process.execPath,[output],{encoding:'utf8',timeout:10000});assert.equal(verified.status,1);assert.match(verified.stderr,/Desktop bundled build provenance is invalid/);assert.doesNotMatch(verified.stderr,/ERR_MODULE_NOT_FOUND/);
 assert.ok((await verifyPackagedLocalImports(developer,{serverEntry:output})).relativeModules>4);
 await assert.rejects(packageDesktopEntry(output),{code:'EEXIST'});
});

test('packaged import guard checks computed native tools and project mapping before launch',async t=>{
 const root=await mkdtemp(join(tmpdir(),'ynx-computed-startup-'));t.after(()=>rm(root,{recursive:true,force:true}));
 await mkdir(join(root,'desktop'));
 for(const name of ['local-workbench','wallet-admission-startup','local-go-selection','native-parent-control','native-tools-client','admitted-local-project'])await writeFile(join(root,'desktop',name+'.mjs'),'export const ready = true;\n');
 for(const name of ['native-tools-client','admitted-local-project']){
  await writeFile(join(root,'desktop',name+'.mjs'),"import './missing-original-owner.mjs';\n");
  await assert.rejects(verifyPackagedLocalImports(root),/missing-original-owner/);
  await writeFile(join(root,'desktop',name+'.mjs'),'export const ready = true;\n');
 }
 assert.equal((await verifyPackagedLocalImports(root)).relativeModules,6);
});
