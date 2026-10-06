import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const directory = process.platform==='darwin' ? mkdtempSync(join(tmpdir(),'ynx-process-helper-current-')) : '';
const helper = join(directory,'ynx-process-tree');
if(process.platform==='darwin'){const result=spawnSync('/Library/Developer/CommandLineTools/usr/bin/clang',['-isysroot','/Library/Developer/CommandLineTools/SDKs/MacOSX.sdk',fileURLToPath(new URL('../../ynx-workbench/native/process-tree.c',import.meta.url)),'-o',helper],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);}
const exists = pid => { try { process.kill(pid, 0); return true; } catch (error) { if (error.code === 'ESRCH') return false; throw error; } };
test('real native cleanup refuses parent/current-owner targets and terminates an owned child tree', { skip: process.platform !== 'darwin' }, async () => {
  for (const pid of [process.pid, process.ppid]) {
    const result = spawnSync(helper, [String(pid)], { encoding: 'utf8' });
    assert.equal(result.status, 77, result.stderr);
    assert.ok(exists(pid));
  }
  const childCode = `const cp=require('node:child_process');const child=cp.spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});process.send(child.pid);process.on('message',()=>{child.kill();process.exit(0)});setInterval(()=>{},1000);`;
  const child = spawn(process.execPath, ['-e', childCode], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  const exited = new Promise(resolve => child.once('exit', resolve));
  const grandchild = await new Promise((resolve, reject) => { child.once('message', resolve); child.once('error', reject); });
  try {
    assert.ok(exists(child.pid)); assert.ok(exists(grandchild));
    const result = spawnSync(helper, [String(child.pid)], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    await exited;
    for (let attempt = 0; attempt < 100 && exists(grandchild); attempt++) await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(exists(grandchild), false);
    assert.ok(exists(process.pid));
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.send('cleanup');
  }
});
test('already reaped owned child cleanup is idempotent without weakening live-owner refusal', { skip: process.platform !== 'darwin' }, async () => {
  const child = spawn(process.execPath, ['-e', 'process.exit(0)'], { stdio: 'ignore' });
  await new Promise((resolve, reject) => { child.once('exit', resolve); child.once('error', reject); });
  assert.equal(exists(child.pid), false);
  const result = spawnSync(helper, [String(child.pid)], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.ok(exists(process.pid));
  assert.equal(result.stdout, '');
  const graceful = spawnSync(helper, [String(child.pid), '--graceful-root'], { encoding: 'utf8' });
  assert.equal(graceful.status, 0); assert.equal(graceful.stdout, '');
});

test('force keeps actual owner/foreign guards and reaps a live owned group ignoring TERM', {skip:process.platform!=='darwin'},async()=>{
 for(const pid of [process.pid,process.ppid]){const result=spawnSync(helper,[String(pid),'--force'],{encoding:'utf8'});assert.equal(result.status,77,result.stderr);assert.ok(exists(pid));}
 const code=`const cp=require('node:child_process');process.on('SIGTERM',()=>{});const child=cp.spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"],{stdio:'ignore'});setTimeout(()=>process.send(child.pid),100);setInterval(()=>{},1000);`;
 const child=spawn(process.execPath,['-e',code],{detached:true,stdio:['ignore','ignore','ignore','ipc']});const closed=new Promise(ok=>child.once('exit',ok));const grandchild=await new Promise(ok=>child.once('message',ok));
 try{assert.equal(spawnSync(helper,[String(child.pid)],{encoding:'utf8'}).status,0);await new Promise(ok=>setTimeout(ok,100));assert.ok(exists(child.pid));assert.ok(exists(grandchild));const result=spawnSync(helper,[String(child.pid),'--force'],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);await closed;for(let i=0;i<100&&exists(grandchild);i++)await new Promise(ok=>setTimeout(ok,20));assert.equal(exists(grandchild),false);assert.ok(exists(process.pid));}
 finally{if(exists(child.pid))process.kill(-child.pid,'SIGKILL');}
});

test('one force snapshot reaps a detached TERM-resistant worker after its intermediate parent exits', {skip:process.platform!=='darwin'},async()=>{
 const workerCode="process.on('SIGTERM',()=>{});process.send('ready');setInterval(()=>{},1000);";
 const mainCode=`const cp=require('node:child_process');const worker=cp.spawn(process.execPath,['-e',${JSON.stringify(workerCode)}],{detached:true,stdio:['ignore','ignore','ignore','ipc']});worker.once('message',()=>process.send(worker.pid));setInterval(()=>{},1000);`;
 const code=`const cp=require('node:child_process');process.on('SIGTERM',()=>{});const child=cp.spawn(process.execPath,['-e',${JSON.stringify(mainCode)}],{stdio:['ignore','ignore','ignore','ipc']});child.once('message',pid=>process.send(pid));setInterval(()=>{},1000);`;
 const root=spawn(process.execPath,['-e',code],{detached:true,stdio:['ignore','ignore','ignore','ipc']});const closed=new Promise(ok=>root.once('exit',ok));const worker=await new Promise((ok,bad)=>{root.once('message',ok);root.once('error',bad);root.once('exit',()=>bad(Error('Fixture exited before worker ready')));});
 try{const result=spawnSync(helper,[String(root.pid),'--force'],{encoding:'utf8',timeout:5000});assert.equal(result.status,0,result.stderr);await closed;for(let i=0;i<100&&exists(worker);i++)await new Promise(ok=>setTimeout(ok,20));assert.equal(exists(worker),false);assert.ok(exists(process.pid));}
 finally{if(exists(root.pid))process.kill(-root.pid,'SIGKILL');if(exists(worker))process.kill(worker,'SIGKILL');}
});

test('graceful root runs its stop hook first, captures detached orphans, and preserves an unrelated project', {skip:process.platform!=='darwin'},async()=>{
 for(const pid of [process.pid,process.ppid]){const result=spawnSync(helper,[String(pid),'--graceful-root'],{encoding:'utf8'});assert.equal(result.status,77,result.stderr);}
 const marker=join(directory,'graceful-hook');
 const workerCode="process.on('SIGTERM',()=>{});process.send('ready');setInterval(()=>{},1000);";
 const code=`const cp=require('node:child_process'),fs=require('node:fs');const child=cp.spawn(process.execPath,['-e',${JSON.stringify(workerCode)}],{detached:true,stdio:['ignore','ignore','ignore','ipc']});child.once('message',()=>process.send(child.pid));process.on('SIGTERM',()=>{fs.writeFileSync(${JSON.stringify(marker)},'saved');process.exit(0);});setInterval(()=>{},1000);`;
 const root=spawn(process.execPath,['-e',code],{detached:true,stdio:['ignore','ignore','ignore','ipc']}),unrelated=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});
 const closed=onceExit(root),otherClosed=onceExit(unrelated),worker=await new Promise(ok=>root.once('message',ok));
 try{const result=spawnSync(helper,[String(root.pid),'--graceful-root'],{encoding:'utf8',timeout:15000});assert.equal(result.status,0,result.stderr);await closed;assert.equal(root.exitCode,0);assert.equal(result.stdout,"YNX_PROCESS_TREE_CLEANUP_VERIFIED\n");assert.ok(existsSync(marker));for(let i=0;i<100&&exists(worker);i++)await new Promise(ok=>setTimeout(ok,20));assert.equal(exists(worker),false);assert.ok(exists(unrelated.pid));}
 finally{unrelated.kill();await otherClosed;if(root.exitCode===null&&root.signalCode===null)root.kill('SIGKILL');if(exists(worker))process.kill(worker,'SIGKILL');}
});
test('graceful root deadline still reaps an unresponsive original tree', {skip:process.platform!=='darwin',timeout:18000},async()=>{
 const root=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});process.send('ready');setInterval(()=>{},1000);"],{detached:true,stdio:['ignore','ignore','ignore','ipc']}),closed=onceExit(root);
 await new Promise(ok=>root.once('message',ok));try{const start=Date.now(),result=spawnSync(helper,[String(root.pid),'--graceful-root'],{encoding:'utf8',timeout:15000});assert.equal(result.status,0,result.stderr);await closed;assert.ok(Date.now()-start>=10000);assert.equal(root.signalCode,'SIGKILL');assert.ok(exists(process.pid));}finally{if(exists(root.pid))root.kill('SIGKILL');}
});
function onceExit(child){return new Promise(resolve=>child.once('exit',resolve));}
