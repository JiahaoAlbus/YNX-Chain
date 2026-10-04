import test from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { compilerReadiness, COMPILER_SHA256, COMPILER_VERSION } from './compiler-pin.mjs';

const source = '// SPDX-License-Identifier: MIT\npragma solidity 0.8.24; contract PinCheck { function ping() external pure returns(uint256) { return 1; } }';
test('the real local compiler worker cannot label an unreviewed compiler as 0.8.24', async t => {
  const state = compilerReadiness();
  const worker = new Worker(new URL('./compiler-worker.mjs', import.meta.url), { workerData: { name: 'PinCheck', source } });
  t.after(() => worker.terminate());
  const value = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { worker.terminate(); reject(Error('Compiler worker deadline exceeded')); }, 20000);
    worker.once('message', value => { clearTimeout(timer); resolve(value); });
    worker.once('error', error => { clearTimeout(timer); reject(error); });
    worker.once('exit', () => { clearTimeout(timer); reject(Error('Compiler exited before returning an artifact')); });
  });
  if (state.available) {
    assert.equal(value.ok, true);
    assert.equal(value.compiler.version, COMPILER_VERSION);
    assert.equal(value.compiler.artifactSha256, COMPILER_SHA256);
    assert.match(value.bytecode, /^0x[0-9a-f]+$/);
  } else {
    assert.equal(value.ok, false); assert.equal(value.status, 503); assert.equal(value.code, state.code);
    assert.equal(value.bytecode, undefined); assert.equal(value.artifactHash, undefined);
    assert.equal(value.compiler.pinned, false);
    assert.equal(value.compiler.installedVersion, state.installedVersion);
  }
});

test('the real HTTP compiler advertises measured readiness and refuses mismatched artifacts before dispatch', async t => {
  const reservation = createServer(); await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const port = reservation.address().port; await new Promise(resolve => reservation.close(resolve));
  const child = spawn(process.execPath, [fileURLToPath(new URL('./server.mjs', import.meta.url))], { env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
  const ended = new Promise(resolve => child.once('exit', resolve));
  t.after(async () => { if (child.exitCode === null) child.kill('SIGTERM'); await ended; });
  let startup = ''; child.stdout.on('data', chunk => startup += chunk); child.stderr.on('data', chunk => startup += chunk);
  await new Promise((resolve, reject) => {
    const deadline = setTimeout(() => { clearInterval(timer); reject(Error('Compiler server did not start: ' + startup)); }, 5000);
    const timer = setInterval(() => { if (startup.includes('YNX Developer Web')) { clearTimeout(deadline); clearInterval(timer); resolve(); } }, 20);
  });
  const base = `http://127.0.0.1:${port}`, state = compilerReadiness();
  const response = await fetch(base + '/compiler/compiler'), info = await response.json();
  assert.equal(response.status, state.available ? 200 : 503);
  assert.equal(info.productionCompilerEnabled, state.available); assert.equal(info.pinned, state.available);
  assert.equal(info.artifactSha256, state.artifactSha256); assert.equal(info.installedVersion, state.installedVersion);
  assert.equal(info.version, state.available ? COMPILER_VERSION : undefined);
  const compiled = await fetch(base + '/compiler/compile', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'PinCheck', source }) });
  const value = await compiled.json();
  assert.equal(compiled.status, state.available ? 200 : 503); assert.equal(value.ok, state.available);
  if (!state.available) {
    assert.equal(value.code, state.code); assert.equal(value.bytecode, undefined); assert.equal(value.artifactHash, undefined);
    const after = await (await fetch(base + '/compiler/compiler')).json();
    assert.equal(after.activeCompilers, 0); assert.equal(after.queuedCompilers, 0);
  }
});
