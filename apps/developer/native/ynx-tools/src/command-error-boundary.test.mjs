import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
const source = await readFile(new URL('./extension.cjs', import.meta.url), 'utf8');
const start = source.indexOf('  const register = '), end = source.indexOf("  register('ynx.chainProject'", start);
assert.ok(start >= 0 && end > start);
const actualRegistrar = source.slice(start, end);
const chinese = JSON.parse(await readFile(new URL('../l10n/bundle.l10n.zh-cn.json', import.meta.url)));
const fallback = 'The command failed. Check the project configuration and retry.';
function fixture(notify = () => undefined, localized = false) {
  const callbacks = new Map(), messages = [], subscriptions = [], disposable = { dispose() {} }, module = { exports: {} };
  vm.runInNewContext(actualRegistrar + '\nmodule.exports = register;', {
    module, context: { subscriptions }, t: message => localized ? chinese[message] || message : message,
    vscode: { commands: { registerCommand(name, callback) { callbacks.set(name, callback); return disposable; } },
      window: { showErrorMessage(message) { messages.push(message); return notify(); } } },
  });
  return { register: module.exports, callbacks, messages, subscriptions, disposable };
}
for (const value of [false, undefined, null, 0, '', 'PUBLIC raw rejection']) {
  test(`actual command boundary presents failure for ${String(value)} without secondary rejection`, async () => {
    const f = fixture(); f.register('PUBLIC.run', () => Promise.reject(value));
    assert.equal(await f.callbacks.get('PUBLIC.run')(), undefined);
    assert.deepEqual(f.messages, [fallback]);
    assert.equal(f.subscriptions[0], f.disposable);
  });
}
test('ordinary and frozen original errors retain their message without mutating the first cause', async () => {
  for (const error of [Error('PUBLIC compiler problem'), Object.freeze(Error('PUBLIC frozen problem'))]) {
    const f = fixture(); f.register('PUBLIC.run', () => Promise.reject(error));
    await f.callbacks.get('PUBLIC.run')(); assert.deepEqual(f.messages, [error.message]);
    assert.equal(Object.hasOwn(error, 'cleanupError'), false);
  }
});
test('throwing message accessor uses the safe failure notice', async () => {
  const f = fixture(), error = Object.defineProperty({}, 'message', { get() { throw Error('getter unavailable'); } });
  f.register('PUBLIC.run', () => { throw error; }); await f.callbacks.get('PUBLIC.run')();
  assert.deepEqual(f.messages, [fallback]);
});
test('pending failure notification does not keep the failed command running', async () => {
  const f = fixture(() => new Promise(() => {}));
  f.register('PUBLIC.run', () => { throw null; });
  const pending = Symbol('notification blocks command');
  const result = await Promise.race([f.callbacks.get('PUBLIC.run')(), new Promise(resolve => setImmediate(() => resolve(pending)))]);
  assert.notEqual(result, pending); assert.deepEqual(f.messages, [fallback]);
});
test('notification rejection is observed and does not escape the command boundary', async () => {
  const f = fixture(() => Promise.reject(Error('notification retired')));
  f.register('PUBLIC.run', () => { throw Error('PUBLIC operation failure'); });
  await f.callbacks.get('PUBLIC.run')(); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(f.messages, ['PUBLIC operation failure']);
});
test('synchronous notification failure does not replace the original command failure', async () => {
  const f = fixture(() => { throw Error('notification disposed'); });
  f.register('PUBLIC.run', () => { throw Error('PUBLIC original problem'); });
  await f.callbacks.get('PUBLIC.run')(); assert.deepEqual(f.messages, ['PUBLIC original problem']);
});
test('successful command executes exactly once without reporting failure', async () => {
  const f = fixture(); let calls = 0;
  f.register('PUBLIC.run', async () => { calls++; });
  assert.equal(await f.callbacks.get('PUBLIC.run')(), undefined);
  assert.equal(calls, 1); assert.deepEqual(f.messages, []);
});
test('unknown command failure has an actual owned Chinese translation', async () => {
  const f = fixture(undefined, true);
  f.register('PUBLIC.run', () => { throw false; }); await f.callbacks.get('PUBLIC.run')();
  assert.equal(f.messages[0], '命令未能完成。请检查项目配置后重试。');
});

// Join the actual TypeScript runner with the actual user-command callback.
// Only editor/task APIs are fixtures. Paths/admission use real temporary
// project files. As in the existing TS lifecycle suite, the packaged compiler
// availability check is inert here; these failure cases must never compile.
async function typeScriptFixture(t) {
  const f = fixture(), root = await fs.realpath(await fs.mkdtemp(path.join(tmpdir(), 'ynx-command-ts-')));
  const file = path.join(root, 'hello.ts'); await fs.writeFile(file, 'export {};\n');
  const document = { uri: { scheme: 'file', fsPath: file }, languageId: 'typescript', version: 1, isDirty: false, save: async () => true };
  const folder = { uri: { scheme: 'file', fsPath: root } }, entered = [], handlers = new Map();
  const event = name => callback => { handlers.set(name, callback); return { dispose() { handlers.delete(name); } }; };
  const api = { window: { activeTextEditor: { document } }, workspace: { isTrusted: true, getWorkspaceFolder: () => folder },
    extensions: { getExtension: () => ({ activate: async () => {} }) },
    tasks: { onDidEndTaskProcess: event('process'), onDidEndTask: event('task'), executeTask: async () => { entered.push('compile'); throw Error('Unexpected compile'); } },
    debug: { onDidStartDebugSession: event('start'), onDidTerminateDebugSession: event('end'),
      startDebugging: async () => { entered.push('debug'); throw Error('Unexpected debug'); } },
    ProcessExecution: class {}, Task: class {}, TaskRevealKind: { Always: 1 }, TaskPanelKind: { Shared: 1 } };
  const filename = fileURLToPath(new URL('./ts-current-file.cjs', import.meta.url));
  const require = createRequire(filename), module = { exports: {} };
  vm.runInNewContext(await readFile(filename, 'utf8'), { module, process, __dirname: path.dirname(filename),
    require: id => id === 'node:fs/promises' ? { ...fs, access: name => name.includes('/runtime/typescript/') ? Promise.resolve() : fs.access(name) } : require(id) });
  const runner = module.exports.createTsCurrentFile(api, { subscriptions: f.subscriptions }, { YNX_WORKSPACE_MODE: 'local', YNX_LOCAL_WORKSPACE: root });
  f.register('PUBLIC.ts.run', () => runner.start(true));
  t.after(async () => { for (const item of f.subscriptions) item.dispose(); await fs.rm(root, { recursive: true, force: true }); });
  return { ...f, api, runner, document, entered };
}
for (const stage of ['save', 'activation']) for (const reason of [false, undefined, null, 0, '', 'PUBLIC raw rejection', Error('PUBLIC original problem')]) {
  test(`actual TS ${stage} rejection ${String(reason)} reaches command notice and permits retry`, async t => {
    const f = await typeScriptFixture(t);
    if (stage === 'save') f.document.save = () => Promise.reject(reason);
    else f.api.extensions.getExtension = () => ({ activate: () => Promise.reject(reason) });
    await f.callbacks.get('PUBLIC.ts.run')();
    assert.deepEqual(f.messages, [reason instanceof Error ? reason.message : fallback]);
    assert.deepEqual(f.entered, [], 'the whole command path must not compile or launch after rejection');
    let saves = 0; f.document.save = async () => { saves++; return false; };
    await f.callbacks.get('PUBLIC.ts.run')();
    assert.equal(saves, 1, 'the next command must enter instead of silently retaining Running');
    assert.equal(f.messages.length, 1); assert.deepEqual(f.entered, []);
  });
}
for (const late of ['resolve', 'reject']) {
  test(`whole command cancellation releases activation and ignores its late ${late}`, async t => {
    const f = await typeScriptFixture(t); let reached, resolveActivation, rejectActivation;
    const entered = new Promise(resolve => { reached = resolve; });
    f.api.extensions.getExtension = () => ({ activate: () => new Promise((resolve, reject) => {
      resolveActivation = resolve; rejectActivation = reject; reached();
    }) });
    const running = f.callbacks.get('PUBLIC.ts.run')(); await entered;
    try {
      f.runner.cancel(); const pending = Symbol('failed to release command');
      const result = await Promise.race([running, new Promise(resolve => setImmediate(() => resolve(pending)))]);
      assert.notEqual(result, pending);
      assert.deepEqual(f.messages, ['TypeScript run was cancelled.']);
      let saves = 0; f.document.save = async () => { saves++; return false; };
      await f.callbacks.get('PUBLIC.ts.run')(); assert.equal(saves, 1);
      if (late === 'resolve') resolveActivation(); else rejectActivation(Error('PUBLIC late activation failure'));
      await running; await new Promise(resolve => setImmediate(resolve));
      assert.deepEqual(f.entered, []); assert.equal(f.messages.length, 1);
    } finally { resolveActivation(); await running; }
  });
}
