import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const helper = fileURLToPath(new URL('../lib/backend/ynx-process-tree', import.meta.url));
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
});
