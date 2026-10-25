import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
const { createSolidityBuild } = createRequire(import.meta.url)('./solidity-build.cjs');

// Wrapper orchestration only. The existing real compiler/Worker suite remains
// mandatory; this suite cannot establish successful Solidity compilation.
async function fixture(t, notify = () => new Promise(() => {})) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'ynx-solidity-notice-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const uri = fsPath => ({ scheme: 'file', fsPath });
  const document = { uri: uri(join(root, 'Main.sol')), isClosed: false };
  const folder = { uri: uri(root) }, calls = [], notices = [];
  let saved, reached;
  const notificationReached = new Promise(resolve => { reached = resolve; });
  const result = { ok: true, contractName: 'Main' };
  const api = {
    ConfigurationTarget: { WorkspaceFolder: 3 },
    window: { activeTextEditor: { document }, showInformationMessage(message) {
      notices.push(message); reached(); return notify();
    } },
    workspace: { isTrusted: true, workspaceFolders: [folder], getConfiguration() {
      return { inspect: () => ({ workspaceFolderValue: saved }), async update(key, value, target) {
        assert.equal(key, 'build'); assert.equal(target, 3); saved = value;
      } };
    } },
  };
  const env = { YNX_WORKSPACE_MODE: 'local', YNX_LOCAL_WORKSPACE: root,
    YNX_LOCAL_PROJECT_ID: 'cccccccc-cccc-cccc-cccc-cccccccccccc' };
  const h = { api, env, calls, notices, notificationReached, result,
    saved: () => saved, setSaved: value => { saved = value; } };
  const language = { async compileProject(options) {
    calls.push(options); await h.beforeChoose?.();
    if (h.cancelled) return undefined;
    if (h.failure) throw h.failure;
    await options.onContractChosen({ entryPath: 'Main.sol', contractName: 'Main' }, async () => {});
    await h.afterCompile?.(); return result;
  }, cancelCompileProject: () => false };
  h.build = createSolidityBuild(api, language, env);
  return h;
}
async function completesWithoutDismissal(h, action) {
  const running = action();
  await h.notificationReached;
  const pending = Symbol('notification incorrectly gates completion');
  // Observe at the notification boundary, rather than guessing compiler time.
  const outcome = await Promise.race([running, new Promise(resolve => setImmediate(() => resolve(pending)))]);
  assert.notEqual(outcome, pending, 'an ordinary completion notice must not keep the command pending');
  return outcome;
}
test('compile returns without dismissing its notice and the next run reuses saved project configuration', async t => {
  const h = await fixture(t);
  assert.equal(await completesWithoutDismissal(h, () => h.build.compile()), h.result);
  assert.deepEqual(h.saved(), { entryPath: 'Main.sol', contractName: 'Main' });
  assert.equal(await h.build.compile(), h.result);
  assert.equal(h.calls.length, 2);
  assert.equal(h.calls[1].contractName, 'Main');
  assert.equal(h.notices.length, 2);
});
test('configure returns after saving without requiring notification dismissal', async t => {
  const h = await fixture(t);
  assert.equal(await completesWithoutDismissal(h, () => h.build.configure()), h.result);
  assert.equal(h.calls[0].configureOnly, true);
  assert.deepEqual(h.saved(), { entryPath: 'Main.sol', contractName: 'Main' });
});
test('rejected notification transport does not turn a completed compile into failure', async t => {
  const h = await fixture(t, () => Promise.reject(Error('notification retired')));
  assert.equal(await h.build.compile(), h.result);
});
test('synchronous notification failure does not discard successful configuration', async t => {
  const h = await fixture(t, () => { throw Error('notification disposed'); });
  assert.equal(await h.build.configure(), h.result);
  assert.deepEqual(h.saved(), { entryPath: 'Main.sol', contractName: 'Main' });
});
test('cancelled compiler produces no successful completion notice or configuration', async t => {
  const h = await fixture(t); h.cancelled = true;
  assert.equal(await h.build.compile(), undefined);
  assert.equal(h.saved(), undefined); assert.equal(h.notices.length, 0);
});
test('compiler failure preserves its exact cause and produces no success notice', async t => {
  const h = await fixture(t); h.failure = Error('actual compiler failure');
  await assert.rejects(h.build.compile(), error => error === h.failure);
  assert.equal(h.notices.length, 0);
});
test('project retirement after compilation still refuses success and does not notify', async t => {
  const h = await fixture(t);
  h.afterCompile = () => { h.env.YNX_LOCAL_PROJECT_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'; };
  await assert.rejects(h.build.compile(), /trusted local Solidity project/);
  assert.equal(h.notices.length, 0);
});
test('file switch during selection cannot persist stale configuration', async t => {
  const h = await fixture(t);
  h.beforeChoose = () => { h.api.window.activeTextEditor = { document: { ...h.api.window.activeTextEditor.document } }; };
  await assert.rejects(h.build.compile(), /trusted local Solidity project/);
  assert.equal(h.saved(), undefined); assert.equal(h.notices.length, 0);
});
test('invalid saved configuration is still refused before entering the compiler', async t => {
  const h = await fixture(t); h.setSaved({ entryPath: '../Other.sol', contractName: 'Main' });
  await assert.rejects(h.build.compile(), /configuration is invalid/);
  assert.equal(h.calls.length, 0); assert.equal(h.notices.length, 0);
});
