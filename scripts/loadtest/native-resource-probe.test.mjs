import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
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
