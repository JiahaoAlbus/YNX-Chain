import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, copyFile, readFile, writeFile, cp } from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildProcessHelper, verifyProcessHelper } from './process-helper-build.mjs';
test('current source builds a copied package helper that executes graceful stop; stale source and binary cannot pass packaging', {skip:process.platform!=='darwin'}, async()=>{
 const directory=await mkdtemp('/private/tmp/ynx-helper-build-'),source=join(directory,'process-tree.c'),output=join(directory,'lib/backend/ynx-process-tree');
 await copyFile(fileURLToPath(new URL('../../ynx-workbench/native/process-tree.c',import.meta.url)),source);
 await buildProcessHelper({source,output});
 const packaged=join(directory,'packaged');await cp(join(directory,'lib'),packaged,{recursive:true});
 const helper=join(packaged,'backend/ynx-process-tree');await verifyProcessHelper({source,output:helper});
 assert.equal(spawnSync(helper,[String(process.pid),'--graceful-root']).status,77,'final copied helper must recognize graceful mode and reject the owner');
 const child=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>process.exit(0));process.send('ready');setInterval(()=>{},1000)"],{stdio:['ignore','ignore','ignore','ipc']});
 const exited=new Promise(resolve=>child.once('exit',resolve));await new Promise(resolve=>child.once('message',resolve));
 try {const result=spawnSync(helper,[String(child.pid),'--graceful-root'],{encoding:'utf8',timeout:15000});assert.equal(result.status,0,result.stderr);await exited;assert.equal(child.exitCode,0);} finally {if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');}
 const original=await readFile(source);await writeFile(source,Buffer.concat([original,Buffer.from('\n// changed\n')]));await assert.rejects(verifyProcessHelper({source,output:helper}),/source is stale/);
 await writeFile(source,original);await writeFile(helper,'stale binary');await assert.rejects(verifyProcessHelper({source,output:helper}),/binary differs/);
});
