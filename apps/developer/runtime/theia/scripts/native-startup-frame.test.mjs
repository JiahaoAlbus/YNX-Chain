import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
const require = createRequire(new URL('../package.json', import.meta.url));
require('reflect-metadata');
globalThis.window = { localStorage: { getItem: () => null }, WebAssembly };
globalThis.document = { createElement: () => ({ style: {} }) };
const common = require('@theia/core/lib/common');
const browser = require('@theia/core/lib/browser/browser');
const module = { exports: {} };
vm.runInNewContext(readFileSync(new URL('../../ynx-workbench/lib/native-startup-frame.js', import.meta.url), 'utf8'), { module, require });
const { waitForStartupFrame, startNative } = module.exports;
function fixture(deliverFrames) {
  const calls = [], callbacks = new Map(); let next = 0, removed = 0;
  const indicator = { classList: { add: value => calls.push(value) }, parentElement: { removeChild: () => removed++ } };
  const target = {
    setTimeout, clearTimeout,
    requestAnimationFrame(fn) { const id = ++next; callbacks.set(id, fn); if (deliverFrames) setImmediate(() => callbacks.get(id)?.()); return id; },
    cancelAnimationFrame(id) { callbacks.delete(id); },
    getComputedStyle: () => ({ transitionDuration: '0s' }),
  };
  const savedLayout = { editor: 'existing.cpp', dirty: true, text: 'unsaved user text' };
  const app = {
    stateService: {}, backendStopwatch: { start: async () => 'startup', stop() {} }, stopwatch: { start: () => ({ info() {} }) },
    measure: (id, operation) => operation(), startContributions: async () => calls.push('contributions'),
    getHost: async () => ({}), attachShell: () => calls.push('attach'), attachTooltip() {},
    initializeLayout: async () => { calls.push('restore'); app.restored = savedLayout; },
    fireOnDidInitializeLayout: async () => calls.push('initialized'),
    revealShell: async () => {}, getStartupIndicator: () => indicator,
    registerEventListeners: () => calls.push('listeners'),
  };
  return { app, target, calls, callbacks, savedLayout, removed: () => removed };
}

test('negative control: actual upstream start remains before layout while its RAF is withheld', async () => {
  const source = readFileSync(require.resolve('@theia/core/lib/browser/frontend-application'), 'utf8');
  const begin = source.indexOf('    async start() {'), end = source.indexOf('\n    /**', begin);
  const start = vm.runInNewContext('({' + source.slice(begin, end) + '}).start', { common_1: common, browser_1: browser, TIMER_WARNING_THRESHOLD: 100 });
  const f = fixture(false), previous = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = fn => f.target.requestAnimationFrame(fn);
  try {
    let finished = false; const pending = start.call(f.app).then(() => { finished = true; });
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal(f.app.stateService.state, 'started_contributions'); assert.equal(finished, false); assert.equal(f.app.restored, undefined);
    for (const fn of f.callbacks.values()) fn(); await pending;
    assert.equal(f.app.stateService.state, 'ready');
  } finally { globalThis.requestAnimationFrame = previous; }
});

test('native startup reaches ready with both paint callbacks withheld and retains restored layout/editor state', async () => {
  const f = fixture(false);
  await startNative.call(f.app, f.target);
  assert.equal(f.app.stateService.state, 'ready'); assert.equal(f.removed(), 1); assert.equal(f.callbacks.size, 0);
  assert.equal(f.app.restored, f.savedLayout); assert.equal(f.app.restored.dirty, true); assert.equal(f.app.restored.text, 'unsaved user text');
  assert.deepEqual(f.calls, ['contributions', 'attach', 'restore', 'initialized', 'theia-hidden', 'listeners']);
});

test('normal paint wins without waiting for fallback and late callbacks cannot settle twice', async () => {
  const f = fixture(true); let cleared = 0, deadlines = 0;
  const originalClear = f.target.clearTimeout;
  f.target.clearTimeout = id => { cleared++; originalClear(id); };
  f.target.setTimeout = (fn, ms) => setTimeout(() => { deadlines++; fn(); }, ms);
  await waitForStartupFrame(f.target, 10000);
  assert.equal(cleared, 1); assert.equal(deadlines, 0); assert.equal(f.callbacks.size, 0);
});
