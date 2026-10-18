import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cppDebugCleanupPlugin, transformCppDebugCleanup, PIN } from './cpp-debug-cleanup-build.mjs';
const require = createRequire(new URL('../package.json', import.meta.url));
const { ProcessDebugAdapter } = require('@theia/debug/lib/node/stream-debug-adapter');
const cleanup = createRequire(import.meta.url)('../../ynx-workbench/lib/local-cpp-debug-cleanup');
const request = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const env = { YNX_WORKSPACE_MODE: 'local', YNX_LOCAL_WORKSPACE: '/TEST_ONLY/project',
  THEIA_APP_PROJECT_PATH: '/TEST_ONLY/core', TMPDIR: '/private/tmp/yi-501/01234567-aB1234' };
function fixture({ change = {}, environment = env, helper } = {}) {
  const child = Object.assign(new EventEmitter(), { pid: 12345, exitCode: null, signalCode: null,
    stdout: new PassThrough(), stdin: new PassThrough(), kill() { this.kills++; }, kills: 0 });
  const adapter = new ProcessDebugAdapter(child), nativeStop = adapter.stop;
  const calls = []; let creations = 0;
  class Creator { async createDebugAdapter() { creations++; return adapter; } }
  if (!process.env.YNX_CPP_CLEANUP_BASELINE) cleanup.install(Creator.prototype, { environment, platform: 'darwin', uid: 501, timeoutMs: 15,
    runHelper: (...args) => { calls.push(args); helper?.(...args); } });
  const session = { id: 'TEST_ONLY_SESSION', workspaceFolder: { uri: { fsPath: env.YNX_LOCAL_WORKSPACE } },
    configuration: { type: 'lldb-dap', request: 'launch', __ynxCppRunId: request,
      cwd: env.YNX_LOCAL_WORKSPACE, program: env.TMPDIR + '/cpp-' + request + '/program', ...change } };
  return { child, adapter, nativeStop, calls, session, creations: () => creations,
    create: () => new Creator().createDebugAdapter(session),
    close() { child.exitCode = 0; child.emit('close', 0, null); },
    ack() { const raw = JSON.stringify({ type: 'response', command: 'disconnect', success: true });
      child.stdout.write('Content-Length: ' + Buffer.byteLength(raw) + '\r\n\r\n' + raw); } };
}
test('actual Theia process adapter waits for owned helper AND close before its root-only stop', async () => {
  const f = fixture(), adapter = await f.create();
  const pending = adapter.stop(); assert.equal(adapter.stop(), pending);
  assert.equal(f.child.kills, 0); assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0][0], '/TEST_ONLY/core/lib/backend/ynx-process-tree');
  assert.deepEqual(f.calls[0][1], ['12345', '--force']);
  let done = false; pending.then(() => done = true);
  f.close(); await Promise.resolve(); assert.equal(done, false);
  f.calls[0][3](null); await pending; assert.equal(f.child.kills, 0);
});
test('helper success alone cannot claim that the adapter process exited', async () => {
  const f = fixture(), adapter = await f.create(); const pending = adapter.stop();
  f.calls[0][3](null); await Promise.resolve(); assert.equal(f.child.kills, 0);
  f.close(); await pending; assert.equal(f.child.kills, 0);
});
test('retained close notification cannot remove the session before helper cleanup is confirmed', async () => {
  const f = fixture(), adapter = await f.create(); let notifications = 0;
  adapter.onClose(() => notifications++);
  const pending = adapter.stop(); f.child.stdout.emit('close'); f.close();
  assert.equal(notifications, 0, 'Theia would retire the session before its owned cleanup result');
  f.calls[0][3](null); await pending; assert.equal(notifications, 1);
});
test('failed helper after stream close retains UNKNOWN instead of emitting a successful close', async () => {
  const f = fixture(), adapter = await f.create(); let notifications = 0;
  adapter.onClose(() => notifications++);
  const pending = adapter.stop(); f.child.stdout.emit('close'); f.close();
  const error = Error('TEST_ONLY_INCOMPLETE_TREE'); f.calls[0][3](error);
  await assert.rejects(pending, value => value === error); assert.equal(notifications, 0);
  await assert.rejects(adapter.stop(), /before owned cleanup was confirmed/);
  assert.equal(f.calls.length, 1); assert.equal(notifications, 0);
});
test('late successful helper requires a new explicit stop before publishing held close', async () => {
  const f = fixture(), adapter = await f.create(); let notifications = 0;
  adapter.onClose(() => notifications++);
  const pending = adapter.stop(); f.child.stdout.emit('close'); f.close();
  await assert.rejects(pending, /exit was not confirmed/); f.calls[0][3](null);
  await Promise.resolve(); assert.equal(notifications, 0); assert.equal(f.child.kills, 0);
  await adapter.stop(); assert.equal(notifications, 1); assert.equal(f.calls.length, 1);
});
test('helper failure retains exact cause and live adapter for an explicit same-handle retry', async () => {
  const error = Error('TEST_ONLY_HELPER_FAILURE'), f = fixture(), adapter = await f.create();
  const first = adapter.stop(); f.calls[0][3](error); await assert.rejects(first, value => value === error);
  assert.equal(f.child.kills, 0);
  const retry = adapter.stop(); assert.equal(f.calls.length, 2);
  f.calls[1][3](null); f.close(); await retry; assert.equal(f.child.kills, 0);
});
test('falsy synchronous helper failures are not converted into successful cleanup', async () => {
  for (const cause of [undefined, null, false, 0, '']) {
    const f = fixture({ helper() { throw cause; } }), adapter = await f.create(); let rejected = false;
    try { await adapter.stop(); } catch (error) { rejected = true; assert.equal(error, cause); }
    assert.equal(rejected, true); assert.equal(f.child.kills, 0);
  }
});
test('cleanup timeout and late callback cannot invoke the old root-only stop', async () => {
  const f = fixture(), adapter = await f.create(), pending = adapter.stop();
  f.close(); await assert.rejects(pending, /exit was not confirmed/);
  assert.equal(adapter.stop(), pending, 'a timeout must not dispatch another helper while the first helper is still in flight');
  assert.equal(f.calls.length, 1);
  f.calls[0][3](null); await Promise.resolve(); assert.equal(f.child.kills, 0);
});
test('exited unacknowledged handle is UNKNOWN and never re-used as a PID command', async () => {
  const f = fixture(), adapter = await f.create(); f.close();
  await assert.rejects(adapter.stop(), /before owned cleanup was confirmed/);
  assert.equal(f.calls.length, 0); assert.equal(f.child.kills, 0);
});
test('already exited acknowledged normal session keeps its original stop', async () => {
  const f = fixture(), adapter = await f.create(); f.ack(); f.close(); await adapter.stop();
  assert.equal(f.calls.length, 0); assert.equal(f.child.kills, 0);
});
test('an acknowledged exit still waits for its actual stream close without signalling a PID', async () => {
  const f = fixture(), adapter = await f.create(); f.ack(); f.child.exitCode = 0;
  let completed = false; const pending = adapter.stop().then(() => completed = true);
  await Promise.resolve(); assert.equal(completed, false); assert.equal(f.calls.length, 0);
  f.child.emit('close', 0, null); await pending; assert.equal(f.child.kills, 0);
});
test('attach, foreign project, wrong nonce and nonprivate program retain original adapter behavior', async () => {
  for (const change of [{ request: 'attach' }, { __ynxCppRunId: 'bad' }, { program: '/TEST_ONLY/project/main' }, { cwd: '/OTHER/project' }]) {
    const f = fixture({ change }), adapter = await f.create();
    assert.equal(adapter.stop, f.nativeStop); assert.equal(f.calls.length, 0);
  }
  const f = fixture(); f.session.workspaceFolder.uri.fsPath = '/OTHER/project';
  assert.equal((await f.create()).stop, f.nativeStop);
});
test('invalid original runtime refuses before spawning any generated adapter', async () => {
  const f = fixture({ environment: { ...env, THEIA_APP_PROJECT_PATH: '' } });
  await assert.rejects(f.create(), /original private runtime/); assert.equal(f.creations(), 0);
});
test('pinned production creator actually compiles with adjacent helper and rejects changed vendor bytes', async () => {
  const source = await readFile(require.resolve('@theia/plugin-ext/lib/plugin/node/debug/plugin-node-debug-adapter-creator'), 'utf8');
  assert.match(transformCppDebugCleanup(source), /require\("\.\/local-cpp-debug-cleanup"\)\.install\(NodeDebugAdapterCreator.prototype\)/);
  assert.throws(() => transformCppDebugCleanup(source + '\n'), /source changed/);
  assert.equal(PIN.length, 64);
  const esbuild = require('esbuild'), root = await mkdtemp(join(tmpdir(), 'ynx-cpp-cleanup-build-'));
  try {
    const outdir = join(root, 'lib/backend'); await mkdir(outdir, { recursive: true });
    const result = await esbuild.build({ entryPoints: [require.resolve('@theia/plugin-ext/lib/plugin/node/debug/plugin-node-debug-adapter-creator')],
      platform: 'node', bundle: true, write: false, outdir, plugins: [cppDebugCleanupPlugin()], external: ['*.node'], logLevel: 'silent' });
    assert.ok(Object.values(result.metafile.outputs).some(row => row.imports.some(value => value.external && value.path === './local-cpp-debug-cleanup')));
    assert.ok(result.outputFiles.some(row => row.text.includes('local-cpp-debug-cleanup')));
    const seal = await readFile(new URL('./sync-owned-workbench.mjs', import.meta.url), 'utf8');
    assert.ok(seal.includes("'local-cpp-debug-cleanup.js'"), 'normal production seal must carry the actual external helper');
  } finally { await rm(root, { recursive: true, force: true }); }
});
