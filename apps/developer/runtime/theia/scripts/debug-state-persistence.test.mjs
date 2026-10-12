import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { mkdtemp, mkdir, writeFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import vm from 'node:vm';
const require = createRequire(new URL('../package.json', import.meta.url));
require('reflect-metadata');
const { trackLoad, persistDebugState } = require('../ynx-workbench/lib/debug-state-persistence');
const { LocalWorkbenchStorageStore } = require('../ynx-workbench/lib/local-workbench-storage-store');
const { LocalWorkbenchStorage } = require('../ynx-workbench/lib/local-workbench-storage');
const { DebugWatchManager } = require('@theia/debug/lib/browser/debug-watch-manager');
const module = { exports: {} };
vm.runInNewContext(readFileSync(new URL('../../ynx-workbench/lib/native-window-close.js', import.meta.url), 'utf8'), { module, require });
const { NativeWindowClose } = module.exports;
const target = messages => ({ webkit: { messageHandlers: { ynxLocalWorkbench: { postMessage: value => messages.push(value) } } } });
const requestId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

test('real Theia Watch and breakpoint serialization survive native close and a fresh storage instance', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'ynx-debug-save-')));
  try {
    const workspace = join(root, 'project'), profile = join(root, 'profile'), projectId = randomUUID();
    await mkdir(workspace, { mode: 0o700 }); await mkdir(profile, { mode: 0o700 });
    await writeFile(join(profile, 'ynx-local-project.json'), JSON.stringify({ schemaVersion: 1, workspace, profile, projectId }), { mode: 0o600 });
    const env = { YNX_WORKSPACE_MODE: 'local', YNX_LOCAL_WORKSPACE: workspace, YNX_LOCAL_PROFILE: profile, YNX_LOCAL_PROJECT_ID: projectId, THEIA_CONFIG_DIR: profile };
    const messages = [], ui = target(messages), api = new LocalWorkbenchStorageStore(env);
    const storage = new LocalWorkbenchStorage({}, api, { error: assert.fail }, ui);
    // Execute the installed Theia manager's actual persistence methods, without
    // importing its browser-only widget graph into the Node test process.
    const source = readFileSync(require.resolve('@theia/debug/lib/browser/breakpoint/breakpoint-manager'), 'utf8');
    const methods = source.slice(source.indexOf('    async load() {'), source.indexOf('\n};\nexports.BreakpointManager'));
    const persistence = vm.runInNewContext('({' + methods.replace('    save() {', ', save() {') + '})', { uri_1: { default: require('@theia/core/lib/common/uri').default } });
    class Breakpoints {
      constructor() { this.storage = storage; this.sourceBreakpoints = new Map(); this.functionBreakpoints = []; this.exceptionBreakpoints = []; this.instructionBreakpoints = []; this.dataBreakpoints = []; }
      getUris() { return this.sourceBreakpoints.keys(); }
      setBreakpoints(uri, origins) { this.sourceBreakpoints.set(String(uri), origins.map(origin => ({ origin }))); }
    }
    Object.assign(Breakpoints.prototype, persistence); trackLoad(Breakpoints.prototype); trackLoad(DebugWatchManager.prototype);
    const breakpoints = new Breakpoints(), watch = new DebugWatchManager(); watch.storage = storage;
    await Promise.all([breakpoints.load(), watch.load()]);
    breakpoints.setBreakpoints('file:///project/hello.cpp', [{ id: 'cpp', enabled: true, raw: { line: 4 } }]);
    breakpoints.setBreakpoints('file:///project/hello.py', [{ id: 'python', enabled: true, raw: { line: 2 } }]);
    watch.addWatchExpression('value');
    const close = new NativeWindowClose({ isSafeToShutDown: async () => true }, ui, undefined, storage, () => persistDebugState([breakpoints, watch])); close.onStart({});
    await ui.__ynxLocalWorkbenchClose(requestId); assert.equal(messages[0].accepted, true);
    const reopened = new LocalWorkbenchStorage({}, new LocalWorkbenchStorageStore(env), { error: assert.fail }, ui);
    const next = new Breakpoints(); next.storage = reopened; const nextWatch = new DebugWatchManager(); nextWatch.storage = reopened;
    await Promise.all([next.load(), nextWatch.load()]);
    assert.equal(next.sourceBreakpoints.get('file:///project/hello.cpp')[0].origin.raw.line, 4);
    assert.equal(next.sourceBreakpoints.get('file:///project/hello.py')[0].origin.raw.line, 2);
    assert.deepEqual([...nextWatch.watchExpressions].map(([, value]) => value), ['value']);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('load barrier prevents empty overwrite, cancellation saves nothing, flush failure vetoes close, concurrent close shares work', async () => {
  let finishLoad, saves = 0, flushes = 0, veto = true;
  class State { load() { return new Promise(resolve => { finishLoad = resolve; }); } save() { saves++; } }
  trackLoad(State.prototype); const state = new State(); const loading = state.load();
  const messages = [], ui = target(messages), storage = { flush: async () => { flushes++; } };
  const close = new NativeWindowClose({ isSafeToShutDown: async () => !veto }, ui, undefined, storage, () => persistDebugState([state])); close.onStart({});
  await ui.__ynxLocalWorkbenchClose(requestId); assert.equal(messages.pop().accepted, false); assert.equal(saves, 0);
  veto = false;
  const first = ui.__ynxLocalWorkbenchClose(requestId), duplicate = ui.__ynxLocalWorkbenchClose(requestId);
  await new Promise(resolve => setImmediate(resolve)); assert.equal(saves, 0); assert.equal(messages.length, 0);
  finishLoad(); await loading; await Promise.all([first, duplicate]); assert.equal(saves, 1); assert.ok(messages.every(m => m.accepted));
  storage.flush = async () => { throw Error('disk unavailable'); };
  await ui.__ynxLocalWorkbenchClose(requestId); assert.equal(messages.at(-1).accepted, false); assert.equal(saves, 1);
  assert.ok(flushes >= 3);
  const beforeStart = new State(); await persistDebugState([beforeStart]); assert.equal(saves, 1);
});

test('failed initial restore cannot be overwritten by a fresh default snapshot', async () => {
  class Failed { async load() { throw Error('invalid saved state'); } save() { assert.fail('must preserve previous state'); } }
  trackLoad(Failed.prototype); const state = new Failed(); await assert.rejects(state.load(), /invalid saved state/);
  await assert.rejects(persistDebugState([state]), /invalid saved state/);
});

test('real DefaultWindowService restores dirty-editor veto after approved close fails persistence or final flush', async () => {
  const path = require.resolve('@theia/core/lib/browser/window/default-window-service');
  const localRequire = createRequire(path), upstream = { exports: {} };
  // Only the unused confirm-exit dialog UI is substituted; the complete actual
  // DefaultWindowService class, veto collection and shutdown method execute.
  vm.runInNewContext(readFileSync(path, 'utf8'), {
    exports: upstream.exports,
    require: name => name === '../dialogs' ? { confirmExit: () => assert.fail('unexpected generic dialog') } : localRequire(name),
  });
  const { DefaultWindowService } = upstream.exports;
  for (const failure of ['persist', 'flush']) {
    const windows = new DefaultWindowService(); let prompts = 0, persistCalls = 0, flushCalls = 0;
    windows.corePreferences = { 'application.confirmExit': 'ifRequired' };
    windows.logger = { debug() {}, error() {} };
    windows.contributions = { getContributions: () => [{ onWillStop: () => ({ reason: 'dirty-editor', action: async () => ++prompts === 1 }) }] };
    const messages = [], ui = target(messages);
    const storage = { flush: async () => { if (++flushCalls === 2 && failure === 'flush') throw Error('final disk flush failed'); } };
    const close = new NativeWindowClose(windows, ui, undefined, storage, async () => {
      persistCalls++; if (failure === 'persist') throw Error('debug state save failed');
    }); close.onStart({});
    await ui.__ynxLocalWorkbenchClose(requestId);
    assert.equal(messages[0].accepted, false); assert.equal(prompts, 1);
    assert.equal(windows.allowVetoes, true, 'failed close must restore ordinary editor protection');
    // User continues editing and chooses Cancel at the next dirty prompt.
    await ui.__ynxLocalWorkbenchClose(requestId);
    assert.equal(prompts, 2); assert.equal(messages[1].accepted, false); assert.equal(persistCalls, 1);
  }
});
