import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,mkdir,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {verifyPackagedLocalImports} from './verify-packaged-local-imports.mjs';
// Run the real normal producer copy sequence on an empty resource tree. A
// warmed r12 fixture can conceal missing mkdir/order defects in a fresh App.
test('fresh normal App resource copying creates channel parents before first copy',async t=>{
 const temp=await mkdtemp(join(tmpdir(),'ynx normal resource '));t.after(()=>rm(temp,{recursive:true,force:true}));
 const developer=fileURLToPath(new URL('../',import.meta.url)),app=join(temp,'QA App.app');
 await mkdir(join(app,'Contents/Resources/code/apps/developer/desktop'),{recursive:true});
 await mkdir(join(app,'Contents/Resources/runtime'),{recursive:true});
 const script=await readFile(new URL('./package-local-macos.sh',import.meta.url),'utf8');
 const lines=script.split('\n'),start=lines.findIndex(l=>l.startsWith('cp desktop/local-workbench.mjs ')),end=lines.findIndex(l=>l.startsWith('node scripts/package-identity-admission-source.mjs '));
 assert.ok(start>0&&end>start);const commands=lines.slice(start,end);
 assert.ok(commands.every(l=>l.startsWith('cp ')||l.startsWith('mkdir -p ')));
 execFileSync('/bin/bash',['-e','-c',commands.join('\n')],{cwd:developer,env:{...process.env,app},stdio:'pipe'});
 for(const rel of ['desktop/runtime-cache-budget.mjs','desktop/bundled-execution-runtime.mjs','desktop/identity-sdk-loader.mjs','desktop/wallet-admission-startup.mjs','desktop/project-services-host.mjs','runtime/ynx-workbench/lib/project-services-channel.js'])assert.ok((await readFile(join(app,'Contents/Resources/code/apps/developer',rel))).length>0);
 // Resolve the copied tree, not the warm checkout. Include the actual normal
 // producer's remaining desktop/channel and service copy commands.
 const restStart=lines.findIndex(l=>l.startsWith('cp runtime/ynx-workbench/package.json '));
 const restEnd=lines.findIndex((l,i)=>i>restStart&&l==='fi');
 const copies=lines.slice(restStart,restEnd).filter(l=>l.trim().startsWith('cp '));
 const services=lines.find(l=>l.startsWith('cp -R services '));assert.ok(services&&restStart>0&&restEnd>restStart);
 execFileSync('/bin/bash',['-e','-c',[services,...copies].join('\n')],{cwd:developer,env:{...process.env,app},stdio:'pipe'});
 const graph=await verifyPackagedLocalImports(join(app,'Contents/Resources/code/apps/developer'));
 assert.ok(graph.relativeModules>0,'Actual staged local execution closure must resolve.');
 t.diagnostic(`Actual copied local execution graph resolved: ${graph.relativeModules} modules.`);
});
