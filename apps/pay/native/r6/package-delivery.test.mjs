import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {snapshotApplication,verifyApplication} from '../scripts/package-integrity.mjs';
const here=path.dirname(fileURLToPath(import.meta.url));

test('r6 delivery includes the complete actual successor and original-order CLI, without changing the frozen r5 inputs',async()=>{
 const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'pay-r6-delivery-'));
 try{
  const output=path.join(temporary,'new-cut'),builder=path.resolve(here,'../scripts/build-qa.mjs');
  const legacy=await fs.readFile(path.resolve(here,'../pay-business-client.mjs'));
  const built=spawnSync(process.execPath,[builder,'--r6',output],{encoding:'utf8'});
  assert.equal(built.status,0,built.stderr);
  const manifest=JSON.parse(await fs.readFile(path.join(output,'BUILD.json'),'utf8'));
  assert.equal(manifest.nativeClientGeneration,'r6');
  assert.equal(manifest.runtimeModules.length,9);
  for(const name of manifest.runtimeModules)assert.deepEqual(await fs.readFile(path.join(output,'lib',name)),await fs.readFile(path.join(here,name)));
  assert(manifest.runtimeModules.includes('archive-receipt.mjs'));
  const invokedAlias=path.join(temporary,'invoked-alias');await fs.symlink(output,invokedAlias,'dir');
  const help=spawnSync(path.join(output,'bin/node'),[path.join(invokedAlias,'lib/cli.mjs'),'--help'],{encoding:'utf8'});
  assert.equal(help.status,0,help.stderr);
  for(const command of ['order-invoice','order-terms-review','order-pay-review','order-refund-review','order-reconcile-operation','recover-archive'])assert(help.stdout.includes(command),`${command} missing from packaged CLI: ${help.stdout}`);
  const desktop=spawnSync(path.join(output,'bin/node'),[path.join(output,'lib/desktop-entry.mjs')],{input:'{"action":"status"}',encoding:'utf8'});
  assert.equal(desktop.status,2);
  assert.equal(JSON.parse(desktop.stdout).code,'NATIVE_PAY_NORMAL_MAIN_SOURCE_NOT_SUPPLIED');
  await fs.writeFile(path.join(output,'retained-canary'),'preserve');
  const repeated=spawnSync(process.execPath,[builder,'--r6',output],{encoding:'utf8'});
  assert.notEqual(repeated.status,0);
  assert.equal(await fs.readFile(path.join(output,'retained-canary'),'utf8'),'preserve');
  assert.deepEqual(await fs.readFile(path.resolve(here,'../pay-business-client.mjs')),legacy);
 }finally{await fs.rm(temporary,{recursive:true,force:true});}
});

test('same-source installation checks resources, missing/extra paths and symlinks independently of the executable or source-head label',async()=>{
 const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'pay-app-inventory-'));
 try{
  const app=path.join(temporary,'Pay.app'),resources=path.join(app,'Contents/Resources');
  await fs.mkdir(path.join(app,'Contents/MacOS'),{recursive:true});await fs.mkdir(resources);
  await fs.writeFile(path.join(app,'Contents/MacOS/Pay'),'PUBLIC executable unchanged');
  await fs.writeFile(path.join(resources,'main-entry.mjs'),'PUBLIC original runtime');
  await fs.writeFile(path.join(resources,'SOURCE.json'),'{"head":"PUBLIC-same-label"}');
  const original=await snapshotApplication(app);
  assert.equal((await verifyApplication(app,original)).length,3);
  await fs.writeFile(path.join(resources,'main-entry.mjs'),'PUBLIC changed runtime');
  await assert.rejects(verifyApplication(app,original));
  await fs.writeFile(path.join(resources,'main-entry.mjs'),'PUBLIC original runtime');
  await fs.writeFile(path.join(resources,'extra.mjs'),'PUBLIC extra source');
  await assert.rejects(verifyApplication(app,original));
  await fs.unlink(path.join(resources,'extra.mjs'));
  await fs.unlink(path.join(resources,'main-entry.mjs'));
  await assert.rejects(verifyApplication(app,original));
  await fs.symlink(path.join(resources,'SOURCE.json'),path.join(resources,'main-entry.mjs'));
  await assert.rejects(verifyApplication(app,original));
  await assert.rejects(verifyApplication(app,[...original,original[0]]));
 }finally{await fs.rm(temporary,{recursive:true,force:true});}
});
