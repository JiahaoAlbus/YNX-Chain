import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { fileURLToPath } from 'node:url';
const require = createRequire(new URL('../package.json', import.meta.url));
require('reflect-metadata');
const pty = require('node-pty');
const { ProcessTask } = require('@theia/task/lib/node/process/process-task');
const { install } = require('../ynx-workbench/lib/local-task-cancellation');
const { TaskServerImpl } = require('@theia/task/lib/node/task-server');
const originalKill = ProcessTask.prototype.kill;
const root = mkdtempSync(join(tmpdir(), 'ynx-task-cancel-'));
test.after(() => rmSync(root, { recursive: true, force: true }));
const backend = join(root, 'lib/backend'); mkdirSync(backend, { recursive: true });
if (process.platform === 'darwin') {
  const result = spawnSync('/Library/Developer/CommandLineTools/usr/bin/clang', ['-isysroot', '/Library/Developer/CommandLineTools/SDKs/MacOSX.sdk', fileURLToPath(new URL('../../ynx-workbench/native/process-tree.c', import.meta.url)), '-o', join(backend, 'ynx-process-tree')], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
}
const sleep = ms => new Promise(ok => setTimeout(ok, ms));
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
const resistant = "process.on('SIGHUP',()=>{});process.on('SIGTERM',()=>{});console.log('READY');setInterval(()=>{},1000);";
function launch(code = resistant) {
  const child = pty.spawn(process.execPath, ['-e', code], { cwd: root, env: process.env, cols: 80, rows: 24, name: 'xterm' });
  const events = new EventEmitter(), outputStream = new PassThrough();
  let killed = false, output = '';
  const taskProcess = { pid: child.pid, id: child.pid, outputStream, get killed() { return killed; },
    onClose(cb) { events.on('close', cb); return { dispose: () => events.off('close', cb) }; }, kill: signal => child.kill(signal) };
  const closed = new Promise(ok => child.onExit(e => { killed = true; events.emit('close', e); ok(e); }));
  const ready = new Promise(ok => child.onData(data => { output += data; outputStream.write(data); if (output.includes('READY')) ok(); }));
  const task = new ProcessTask({ register: () => child.pid, unregister() {} }, { info() {}, error() {} }, { process: taskProcess, config: {}, context: root });
  return { child, task, closed, ready, get output() { return output; }, async dispose() { if (!killed) child.kill('SIGKILL'); await closed; } };
}
test('actual Theia default kill remains pending for a real PTY ignoring SIGHUP', { skip: process.platform !== 'darwin' }, async () => {
  const fixture = launch();
  try { await fixture.ready; let settled = false; const pending = originalKill.call(fixture.task).then(() => settled = true);
    await sleep(150); assert.equal(alive(fixture.child.pid), true); assert.equal(settled, false);
    await fixture.dispose(); await pending;
  } finally { await fixture.dispose(); }
});
test('owned tree cancellation waits for real close, is idempotent and preserves sibling project', { skip: process.platform !== 'darwin' }, async () => {
  const prototype = Object.create(ProcessTask.prototype); install(prototype, { mode: 'local', platform: 'darwin', applicationPath: root });
  const worker = "process.on('SIGHUP',()=>{});process.on('SIGTERM',()=>{});process.send('ready');setInterval(()=>{},1000)";
  const fixture = launch(`process.on('SIGHUP',()=>{});process.on('SIGTERM',()=>{});const c=require('child_process').spawn(process.execPath,['-e',${JSON.stringify(worker)}],{stdio:['ignore','ignore','ignore','ipc']});c.once('message',()=>console.log('READY '+c.pid));setInterval(()=>{},1000);`), sibling = launch();
  try {
    await Promise.all([fixture.ready, sibling.ready]); Object.setPrototypeOf(fixture.task, prototype);
    const childPid = Number(/READY (\d+)/.exec(fixture.output)[1]);
    const first = fixture.task.kill(); assert.equal(fixture.task.kill(), first);
    assert.equal(fixture.task.process.killed, false); await first;
    assert.equal(fixture.task.process.killed, true); assert.equal(alive(fixture.child.pid), false);
    for (let i = 0; i < 100 && alive(childPid); i++) await sleep(20);
    assert.equal(alive(childPid), false); assert.equal(alive(sibling.child.pid), true);
    await fixture.task.kill();
    const retry = launch("console.log('Hello Go retry 42');");
    try { assert.equal((await retry.closed).exitCode, 0); assert.match(retry.output, /Hello Go retry 42/); } finally { await retry.dispose(); }
  } finally { await fixture.dispose(); await sibling.dispose(); }
});
test('helper error rejects without a fake exit and can be retried', { skip: process.platform !== 'darwin' }, async () => {
  const prototype = Object.create(ProcessTask.prototype); install(prototype, { mode: 'local', platform: 'darwin', applicationPath: join(root, 'missing') });
  const fixture = launch();
  try { await fixture.ready; Object.setPrototypeOf(fixture.task, prototype);
    const server = { taskManager: { get: () => fixture.task }, logger: { info() {} } };
    await assert.rejects(TaskServerImpl.prototype.kill.call(server, fixture.task.id), /cleanup failed/); assert.equal(fixture.task.process.killed, false); assert.equal(alive(fixture.child.pid), true);
    await assert.rejects(fixture.task.kill(), /cleanup failed/);
  } finally { await fixture.dispose(); }
});
test('nonlocal and other platforms retain Theia behavior; closed tasks never invoke a helper', async () => {
  for (const options of [{ platform: 'linux', mode: 'local' }, { platform: 'darwin', mode: 'hosted' }]) {
    const prototype = { kill: originalKill }; install(prototype, options); assert.equal(prototype.kill, originalKill);
  }
  const prototype = { kill: originalKill }; install(prototype, { platform: 'darwin', mode: 'local' });
  await prototype.kill.call({ process: { killed: true, get pid() { throw Error('closed PID read'); } } });
});

test('helper timeout and missing close reject without ending the real task, allowing retry', { skip: process.platform !== 'darwin' }, async () => {
  for (const [name, script, pattern] of [['hang', '#!/bin/sh\nexec /bin/sleep 10\n', /cleanup failed/], ['no-close', '#!/bin/sh\nexit 0\n', /exit was not confirmed/]]) {
    const app = join(root, name); mkdirSync(join(app, 'lib/backend'), { recursive: true });
    writeFileSync(join(app, 'lib/backend/ynx-process-tree'), script, { mode: 0o755 });
    const prototype = Object.create(ProcessTask.prototype); install(prototype, { mode: 'local', platform: 'darwin', applicationPath: app, timeoutMs: 300, helperTimeoutMs: 100 });
    const fixture = launch();
    try { await fixture.ready; Object.setPrototypeOf(fixture.task, prototype);
      await assert.rejects(fixture.task.kill(), pattern); assert.equal(fixture.task.process.killed, false); assert.equal(alive(fixture.child.pid), true);
      await assert.rejects(fixture.task.kill(), pattern);
    } finally { await fixture.dispose(); }
  }
});
