import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createNativeResourceProbe } from './native-resource-probe.mjs';

 test('successful probe retains kernel-output bytes and terminal identity', async () => {
  const probe = createNativeResourceProbe(process.execPath);
  const result = await probe.run(['-e', 'process.stdout.write(JSON.stringify({rss:123}))']);
  assert.deepEqual(JSON.parse(result.stdout), {rss:123});
  assert.ok(result.pid > 0);
  assert.equal(result.command,process.execPath);
  assert.equal(result.launcherPID,process.pid);
  assert.deepEqual(result.runtime,{platform:process.platform,arch:process.arch,node:process.version});
  assert.ok(Date.parse(result.spawnedAt)>=Date.parse(result.spawnRequestedAt));
  assert.ok(result.spawnElapsedMs>=0&&result.spawnElapsedMs<result.elapsedMs);
  assert.equal(result.status, 0);
  assert.equal(result.exited, true);
  assert.equal(result.groupGone, true);
  await probe.stop();
  await assert.rejects(probe.run([]), /stopped/);
});

test('hung probe leaves event loop responsive, rejects overlap and fails closed', async () => {
  const probe = createNativeResourceProbe(process.execPath, {timeoutMs:150});
  const result = probe.run(['-e', 'setInterval(()=>{},1000)']);
  const rejection = assert.rejects(result, /ETIMEDOUT|deadline exceeded/);
  await assert.rejects(probe.run([]), /overlap/);
  await delay(25);
  assert.equal(probe.busy, true);
  await rejection;
  assert.equal(probe.records.length, 1);
  assert.equal(probe.records[0].signal, 'SIGKILL');
  assert.equal(probe.records[0].groupGone, true);
  assert.equal(probe.busy, false);
});

test('shutdown cancels and reaps original probe without starting replacement', async () => {
  const probe = createNativeResourceProbe(process.execPath);
  const pending = probe.run(['-e', 'setInterval(()=>{},1000)']);
  const rejection = assert.rejects(pending, /cancelled/);
  await delay(25);
  await probe.stop();
  await rejection;
  assert.equal(probe.records.length, 1);
  assert.equal(probe.records[0].groupGone, true);
});

test('spawn failure and output flood remain errors', async () => {
  const missing = createNativeResourceProbe('/nonexistent/ynx-probe');
  await assert.rejects(missing.run([]), /ENOENT/);
  assert.equal(missing.records[0].exited, true);
  const flood = createNativeResourceProbe(process.execPath, {maxBytes:1024});
  await assert.rejects(flood.run(['-e', 'process.stdout.write("x".repeat(100000))']), /output limit/);
  assert.equal(flood.records[0].groupGone, true);
  assert.ok(Buffer.byteLength(flood.records[0].stdout) <= 65536);
});

test('valid output above diagnostic prefix stays complete for JSON decoding', async () => {
  const probe = createNativeResourceProbe(process.execPath);
  const result = await probe.run(['-e', 'process.stdout.write(JSON.stringify({value:"x".repeat(100000)}))']);
  assert.equal(JSON.parse(result.stdout).value.length, 100000);
  assert.ok(Buffer.byteLength(probe.records[0].stdout) <= 65536);
  assert.equal(probe.records[0].groupGone, true);
});

function serverFixture(t,behavior='ok') {
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'ynx-native-server-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const file=path.join(root,'server');
 fs.writeFileSync(file,`#!${process.execPath}
const readline=require('node:readline');
if(process.argv[2]!=='--serve')process.exit(2);
let count=0;
readline.createInterface({input:process.stdin}).on('line',line=>{
 const [id,...args]=line.split(' ');
 if(id==='STOP'){process.stdout.write(JSON.stringify({stoppedAfter:Number(args[0])})+'\\n',()=>process.exit(0));return;}
 count++;
 const mode=${JSON.stringify(behavior)};
 if(mode==='hang')return;
 if(mode==='exit'){process.exit(0);return;}
 if(mode==='invalid'){process.stdout.write('not-json\\n');return;}
 if(mode==='flood'){process.stdout.write('x'.repeat(200000));return;}
 const result=JSON.stringify({requestId:mode==='stale'?Number(id)-1:Number(id),sample:{serverPID:process.pid,count,args}})+'\\n';
 process.stdout.write(mode==='duplicate'?result+result:result,()=>{if(mode==='exit-after-response')process.exit(0)});
});
`,{mode:0o700});return file;
}

test('persistent probe reuses one real transport PID and retains distinct complete requests',async t=>{
 const probe=createNativeResourceProbe(serverFixture(t),{persistent:true});
 const a=await probe.run(['--full',String(process.pid)]),b=await probe.run([String(process.pid)]);
 assert.equal(a.pid,b.pid);assert.deepEqual(JSON.parse(a.stdout).args,['--full',String(process.pid)]);assert.equal(JSON.parse(b.stdout).count,2);
 assert.equal(probe.records.length,1);assert.equal(probe.records[0].requests.length,2);assert.equal(probe.records[0].exited,false);
 await probe.stop();assert.equal(probe.records[0].status,0);assert.equal(probe.records[0].exited,true);assert.equal(probe.records[0].groupGone,true);
 await assert.rejects(probe.run([String(process.pid)]),/stopped/);
});

test('persistent probe rejects overlap and timeout without replacing its process',async t=>{
 const probe=createNativeResourceProbe(serverFixture(t,'hang'),{persistent:true,timeoutMs:150});
 const pending=probe.run([String(process.pid)]);const rejected=assert.rejects(pending,/ETIMEDOUT|deadline/);
 await assert.rejects(probe.run([String(process.pid)]),/overlap/);await rejected;
 await assert.rejects(probe.stop(),/ETIMEDOUT|deadline/);assert.equal(probe.records.length,1);assert.equal(probe.records[0].groupGone,true);
});

test('persistent probe fails closed on stale duplicate invalid and early-exit responses',async t=>{
 for(const mode of ['stale','duplicate','invalid','exit','flood']){
  const probe=createNativeResourceProbe(serverFixture(t,mode),{persistent:true,maxBytes:65536});
  await assert.rejects(probe.run([String(process.pid)]));await assert.rejects(probe.stop());
  assert.equal(probe.records.length,1);assert.equal(probe.records[0].groupGone,true);await assert.rejects(probe.run([String(process.pid)]));
 }
});

test('persistent probe bounds requests and refuses argument injection or unsupported launch',async t=>{
 const probe=createNativeResourceProbe(serverFixture(t),{persistent:true,maxRequests:1});await probe.run([String(process.pid)]);
 await assert.rejects(probe.run([String(process.pid)]),/request bound/);await assert.rejects(probe.stop());assert.equal(probe.records[0].groupGone,true);
 const injected=createNativeResourceProbe(serverFixture(t),{persistent:true});await assert.rejects(injected.run(['1\n2']),/argument/);await assert.rejects(injected.stop());assert.equal(injected.records.length,0);
 const missing=createNativeResourceProbe('/nonexistent/ynx-persistent-probe',{persistent:true});await assert.rejects(missing.run(['1']),/ENOENT/);await assert.rejects(missing.stop());assert.equal(missing.records[0].groupGone,true);
});

test('persistent probe rejects successful response followed by unacknowledged exit',async t=>{
 const probe=createNativeResourceProbe(serverFixture(t,'exit-after-response'),{persistent:true});
 await probe.run([String(process.pid)]);await assert.rejects(probe.stop());
 assert.equal(probe.records[0].groupGone,true);
});
