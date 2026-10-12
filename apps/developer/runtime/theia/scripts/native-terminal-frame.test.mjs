import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
const require = createRequire(new URL('../package.json', import.meta.url));
assert.equal(require('xterm/package.json').version, '5.3.0');
// Exercise the actual retained debouncer, rather than a look-alike fixture.
const upstream = require.resolve('xterm/package.json').replace(/package\.json$/, 'src/browser/RenderDebouncer.ts');
const compiled = require('esbuild').transformSync(readFileSync(upstream, 'utf8'), { loader: 'ts', format: 'cjs', target: 'es2020' }).code;
const upstreamModule = { exports: {} };
vm.runInNewContext(compiled, { exports: upstreamModule.exports, module: upstreamModule });
const { RenderDebouncer } = upstreamModule.exports;
const renderSource = readFileSync(upstream.replace('RenderDebouncer.ts', 'services/RenderService.ts'), 'utf8');
const observerStart = renderSource.indexOf('  private _handleIntersectionChange('), observerEnd = renderSource.indexOf('\n  public refreshRows(', observerStart);
assert.ok(observerStart > 0 && observerEnd > observerStart);
const observerModule = { exports: {} };
vm.runInNewContext(require('esbuild').transformSync('export class RetainedObserver {\n' + renderSource.slice(observerStart, observerEnd) + '\n}', { loader: 'ts', format: 'cjs', target: 'es2020' }).code, { module: observerModule, exports: observerModule.exports });
const retainedObserver = observerModule.exports.RetainedObserver.prototype._handleIntersectionChange;
const ownedModule = { exports: {} };
vm.runInNewContext(readFileSync(new URL('../../ynx-workbench/lib/native-terminal-frame.js', import.meta.url), 'utf8'), { module: ownedModule, Proxy, Reflect, Map, WeakSet, WeakMap });
const { boundedFrames, frameState, installOn } = ownedModule.exports;
function fixture() {
  let serial = 0;
  const frames = new Map(), timers = new Map(), listeners = new Map();
  const parent = {
    performance: { now: () => 31.125 },
    requestAnimationFrame(fn) { const id = ++serial; frames.set(id, fn); return id; },
    cancelAnimationFrame(id) { frames.delete(id); },
    setTimeout(fn) { const id = ++serial; timers.set(id, fn); return id; },
    clearTimeout(id) { timers.delete(id); },
    addEventListener(name, fn) { listeners.set(name, fn); },
    removeEventListener(name, fn) { if (listeners.get(name) === fn) listeners.delete(name); },
    method() { return this === parent; },
    webkit: { messageHandlers: { ynxLocalWorkbench: {} } },
    __ynxNativeWindowVisible: true,
  };
  const deadlines = () => { for (const [id, fn] of [...timers]) { timers.delete(id); fn(); } };
  const paint = () => { for (const [id, fn] of [...frames]) { frames.delete(id); fn(12.5); } };
  return { parent, frames, timers, listeners, deadlines, paint };
}
test('negative control: actual xterm coalesces writes but never renders when native paint is withheld', () => {
  const f = fixture(), rows = [];
  const d = new RenderDebouncer(f.parent, (...range) => rows.push(range));
  d.refresh(2, 3, 24); d.refresh(0, 8, 24);
  assert.equal(f.frames.size, 1); assert.equal(rows.length, 0); assert.equal(f.timers.size, 0);
});
test('withheld paint still flushes actual coalesced rows and refresh callbacks exactly once', () => {
  const f = fixture(), rows = [], completed = [], scheduler = boundedFrames(f.parent, () => true);
  const d = new RenderDebouncer(scheduler.window, (...range) => rows.push(range));
  d.refresh(2, 3, 24); d.refresh(0, 8, 24); d.addRefreshCallback(time => completed.push(time));
  const latePaint = [...f.frames.values()][0];
  assert.equal(f.timers.size, 1); f.deadlines();
  assert.deepEqual(rows, [[0, 8]]); assert.deepEqual(completed, [0]);
  assert.equal(f.frames.size, 0); assert.equal(f.timers.size, 0);
  latePaint(200); f.deadlines(); assert.equal(rows.length, 1);
});
test('normal paint wins; nested render requests survive stale callback and preserve native timestamp/this', () => {
  const f = fixture(), scheduler = boundedFrames(f.parent, () => true), times = [];
  assert.equal(scheduler.window.method(), true);
  const id = scheduler.window.requestAnimationFrame(time => {
    times.push(time); scheduler.window.requestAnimationFrame(value => times.push(value));
  });
  const stale = [...f.frames.values()][0]; f.paint();
  assert.deepEqual(times, [12.5]); assert.equal(f.timers.size, 1);
  stale(300); scheduler.window.cancelAnimationFrame(id); f.deadlines();
  assert.deepEqual(times, [12.5, 31.125]);
});
test('hidden terminal does not flush, then resumes pending rows when shown', () => {
  const f = fixture(), rows = []; let visible = true;
  const scheduler = boundedFrames(f.parent, () => visible), d = new RenderDebouncer(scheduler.window, (...range) => rows.push(range));
  d.refresh(3, 4, 24); visible = false; f.deadlines();
  assert.equal(rows.length, 0); assert.equal(f.timers.size, 0);
  visible = true; scheduler.resume(); f.deadlines();
  assert.deepEqual(rows, [[3, 4]]);
});
test('cancel and disposal prevent delayed work and clear all owned scheduling resources', () => {
  const f = fixture(), scheduler = boundedFrames(f.parent, () => true); let calls = 0;
  const first = scheduler.window.requestAnimationFrame(() => calls++), late = [...f.frames.values()][0];
  scheduler.window.cancelAnimationFrame(first); late(0); f.deadlines();
  scheduler.window.requestAnimationFrame(() => calls++); scheduler.dispose();
  f.paint(); f.deadlines();
  assert.equal(calls, 0); assert.equal(f.frames.size, 0); assert.equal(f.timers.size, 0);
  assert.equal(scheduler.window.requestAnimationFrame(() => calls++), 0);
});
function terminalFixture(f) {
  const rows = [], completed = [];
  const prototype = {
    open() {
      if (this.termOpened) return;
      const d = new RenderDebouncer(f.parent, (...range) => rows.push(range));
      this.term._core._renderService = { _renderDebouncer: d, _isPaused: false, _handleIntersectionChange: retainedObserver, _charSizeService: { hasValidSize: true } };
      d.refresh(2, 4, 24); d.addRefreshCallback(time => completed.push(time));
      this.termOpened = true;
    },
    onAfterShow() { this.isVisible = true; },
  };
  const widget = Object.assign(Object.create(prototype), {
    isVisible: true, isAttached: true, isDisposed: false, termOpened: false, toDispose: [],
    term: { rows: 24, _core: {}, refresh(start, end) { this._core._renderService._renderDebouncer.refresh(start, end, this.rows); } },
  });
  return { prototype, widget, rows, completed };
}
test('native installation recovers the already queued initial frame without losing callbacks; cleanup restores only its own window', () => {
  const f = fixture(), t = terminalFixture(f);
  installOn(t.prototype, f.parent); t.widget.open(); t.widget.open();
  assert.equal(t.widget.toDispose.length, 1); assert.equal(f.frames.size, 1);
  f.deadlines(); assert.deepEqual(t.rows, [[0, 23]]); assert.deepEqual(t.completed, [0]);
  const d = t.widget.term._core._renderService._renderDebouncer;
  d.refresh(1, 2, 24); t.widget.isDisposed = true; t.widget.toDispose[0].dispose();
  f.paint(); f.deadlines(); assert.equal(t.rows.length, 1);
  assert.equal(d._parentWindow, f.parent); assert.equal(d._animationFrame, undefined); assert.equal(f.listeners.size, 0);
});
test('native occlusion and hidden tabs preserve pending work until a legitimate show/visibility event', () => {
  const f = fixture(), t = terminalFixture(f); f.parent.__ynxNativeWindowVisible = false;
  installOn(t.prototype, f.parent); t.widget.open();
  f.deadlines(); assert.equal(t.rows.length, 0); assert.equal(f.timers.size, 0);
  f.parent.__ynxNativeWindowVisible = true; f.listeners.get('ynx-window-visibility')();
  t.widget.isVisible = false; f.deadlines(); assert.equal(t.rows.length, 0);
  t.widget.onAfterShow(); f.deadlines(); assert.deepEqual(t.rows, [[0, 23]]);
});
test('ordinary browser keeps upstream open and scheduling untouched', () => {
  const f = fixture(), t = terminalFixture(f); delete f.parent.webkit;
  const original = t.prototype.open; installOn(t.prototype, f.parent);
  assert.equal(t.prototype.open, original); t.widget.open();
  f.deadlines(); assert.equal(t.rows.length, 0); assert.equal(t.widget.toDispose.length, 0);
});
test('actual retained intersection observer resumes a frame whose deadline expired while paused', () => {
  const f = fixture(), t = terminalFixture(f);
  installOn(t.prototype, f.parent); t.widget.open();
  const render = t.widget.term._core._renderService;
  render._handleIntersectionChange({ isIntersecting: false }); f.deadlines();
  assert.equal(t.rows.length, 0); assert.equal(f.timers.size, 0);
  render._handleIntersectionChange({ isIntersecting: true }); f.deadlines();
  assert.deepEqual(t.rows, [[0, 23]]);
  t.widget.toDispose[0].dispose(); assert.equal(render._handleIntersectionChange, retainedObserver);
});
test('count-only snapshot distinguishes missing adapter, stale proxy and false visibility from a delivered fallback', () => {
  const f = fixture(), t = terminalFixture(f);
  assert.equal(frameState(t.widget, {}).nativeWindowVisible, 0);
  assert.equal(frameState(t.widget, f.parent).frameAdapter, 0);
  installOn(t.prototype, f.parent); t.widget.open();
  let state = frameState(t.widget, f.parent);
  assert.equal(state.nativeWindowVisible, 2); assert.equal(state.frameAdapter, 1);
  assert.equal(state.requests, 1); assert.equal(state.deadlines, 1); assert.equal(state.pending, 1);
  f.deadlines(); state = frameState(t.widget, f.parent);
  assert.equal(state.timeouts, 1); assert.equal(state.fallbacks, 1); assert.equal(state.pending, 0);
  f.parent.__ynxNativeWindowVisible = false;
  t.widget.term._core._renderService._renderDebouncer._parentWindow = f.parent;
  assert.equal(frameState(t.widget, f.parent).nativeWindowVisible, 1);
  assert.equal(frameState(t.widget, f.parent).frameAdapter, 2);
  assert.equal(Object.values(state).every(value => typeof value === 'number'), true);
});
