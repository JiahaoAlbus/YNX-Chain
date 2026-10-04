import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { deferSnippetNotifications } = require('../../ynx-workbench/lib/workspace-snippet-notifications.js');
const fixtureURL = new URL('./workspace-snippet-session.test.mjs', import.meta.url);
let fixtureSource = readFileSync(fixtureURL, 'utf8');
fixtureSource = fixtureSource.slice(0, fixtureSource.indexOf("test('real prepare"));
fixtureSource = fixtureSource.replaceAll('import.meta.url', JSON.stringify(fixtureURL.href));
const { integrationFixture, Range } = await import('data:text/javascript;base64,' + Buffer.from(fixtureSource + '\nexport { integrationFixture, Range };').toString('base64'));
const { autorun } = await import(new URL('../node_modules/@theia/monaco-editor-core/esm/vs/base/common/observable.js', import.meta.url));
const { applyTextTransaction } = require('../../ynx-workbench/lib/workspace-text-edit-adapter.js');
// integrationFixture already uses the production editor + snippet notification
// fence; do not wrap its controller a second time.
function type(f) {
  f.caller.pushStackElement();
  f.caller.pushEditOperations([], [{ range: new Range(1, 1, 1, 1), text: 'user ' }], () => []);
  f.caller.pushStackElement();
}
for (const notification of ['context', 'autorun', 'observer beginUpdate']) {
  test(`real native ${notification} cancellation callback typing follows complete workspace Undo`, async t => {
    const f = integrationFixture(); t.after(() => f.dispose());
    await applyTextTransaction(f.workspace, f.edits(), f.deps);
    let armed = true, seen, subscription;
    const insert = () => { if (!armed) return; armed = false; seen = f.caller.getValue(); type(f); };
    if (notification === 'context') subscription = f.context.onDidChangeContext(insert);
    else if (notification === 'autorun') subscription = autorun(reader => { if (!f.controller.isInSnippetObservable.read(reader)) insert(); });
    else {
      const observer = { beginUpdate: insert, endUpdate() {}, handleChange() {}, handlePossibleChange() {} };
      f.controller.isInSnippetObservable.addObserver(observer);
      subscription = { dispose: () => f.controller.isInSnippetObservable.removeObserver(observer) };
    }
    t.after(() => subscription.dispose());
    await f.undoRedo.undo(f.model.uri);
    assert.equal(seen, 'old');
    assert.deepEqual(f.values(), ['old\nold\nold', 'user old']);
    assert.equal(f.controller.isInSnippet(), false); assert.equal(f.controller.isInSnippetObservable.get(), false);
    assert.deepEqual(f.warnings, []);
    await f.undoRedo.undo(f.caller.uri);
    assert.deepEqual(f.values(), ['old\nold\nold', 'old']);
  });
}
test('real native adoption context/observable observers run after history sealing and preserve linked Tab typing', async t => {
  const f = integrationFixture(); t.after(() => f.dispose());
  let once = true, observed;
  const subscription = autorun(reader => {
    if (f.controller.isInSnippetObservable.read(reader) && once) {
      once = false; observed = f.histories().map(h => h.past.length); type(f);
    }
  }); t.after(() => subscription.dispose());
  await applyTextTransaction(f.workspace, f.edits(), f.deps);
  assert.deepEqual(observed, [1, 1]); assert.equal(f.caller.getValue(), 'user atomic');
  assert.equal(f.controller.isInSnippet(), true); assert.equal(f.controller.isInSnippetObservable.get(), true);
  f.controller.next(); assert.equal(f.editor.getSelections().length, 1);
  await f.undoRedo.undo(f.caller.uri); assert.equal(f.caller.getValue(), 'atomic');
  await f.undoRedo.undo(f.model.uri); assert.deepEqual(f.values(), ['old\nold\nold', 'old']);
  await f.undoRedo.redo(f.model.uri); assert.equal(f.caller.getValue(), 'atomic');
});
test('prevalidation rejects duplicate and readonly methods without pausing real context or changing descriptors', t => {
  const f = integrationFixture(); t.after(() => f.dispose());
  const original = f.controller._inSnippetObservable.set, emitter = f.context._onDidChangeContext;
  const release = deferSnippetNotifications(f.controller);
  assert.throws(() => deferSnippetNotifications(f.controller), /already/);
  assert.equal(emitter._isPaused, 1); release(); release();
  assert.equal(emitter._isPaused, 0); assert.equal(f.controller._inSnippetObservable.set, original);
  Object.defineProperty(f.controller._inSnippetObservable, 'set', { value: original, writable: false, configurable: true });
  const descriptor = Object.getOwnPropertyDescriptor(f.controller._inSnippetObservable, 'set');
  assert.throws(() => deferSnippetNotifications(f.controller), /safely/);
  assert.equal(emitter._isPaused, 0); assert.deepEqual(Object.getOwnPropertyDescriptor(f.controller._inSnippetObservable, 'set'), descriptor);
});
test('native context nesting and acquisition failure restore original methods and pause depth', t => {
  const f = integrationFixture(); t.after(() => f.dispose());
  const emitter = f.context._onDidChangeContext, observable = f.controller._inSnippetObservable, original = observable.set;
  emitter.pause(); const release = deferSnippetNotifications(f.controller); assert.equal(emitter._isPaused, 2);
  release(); assert.equal(emitter._isPaused, 1); emitter.resume();
  const originalPause = emitter.pause;
  emitter.pause = () => { throw Error('pause refused'); };
  assert.throws(() => deferSnippetNotifications(f.controller), /pause refused/);
  assert.equal(observable.set, original); assert.equal(Object.hasOwn(observable, 'set'), false); assert.equal(emitter._isPaused, 0);
  emitter.pause = originalPause;
  deferSnippetNotifications(f.controller)();
});
test('failure acquiring a second actual context service resumes the first and restores observable ownership', t => {
  const a = integrationFixture(), b = integrationFixture(); t.after(() => { a.dispose(); b.dispose(); });
  const key = a.controller._hasNextTabstop, oldService = key._service;
  key._service = b.context;
  const emitter = b.context._onDidChangeContext, pause = emitter.pause;
  emitter.pause = () => { throw Error('second service refused'); };
  try {
    assert.throws(() => deferSnippetNotifications(a.controller), /second service/);
    assert.equal(a.context._onDidChangeContext._isPaused, 0); assert.equal(emitter._isPaused, 0);
    assert.equal(Object.hasOwn(a.controller._inSnippetObservable, 'set'), false);
  } finally { key._service = oldService; emitter.pause = pause; }
  deferSnippetNotifications(a.controller)();
});
test('actual observer failure and failing warning sink cannot retain context pauses or observable interception', async t => {
  const f = integrationFixture(); t.after(() => f.dispose());
  await applyTextTransaction(f.workspace, f.edits(), f.deps);
  const observable = f.controller.isInSnippetObservable, original = observable.set;
  const observer = { beginUpdate() { throw Error('observer refused'); }, endUpdate() {}, handleChange() {}, handlePossibleChange() {} };
  observable.addObserver(observer); t.after(() => observable.removeObserver(observer));
  const release = deferSnippetNotifications(f.controller, () => { throw Error('warning refused'); });
  f.controller.cancel(); assert.equal(observable.get(), true);
  assert.equal(f.controller.isInSnippet(), false); assert.equal(f.controller._session, undefined);
  release(); assert.equal(observable.get(), false); assert.equal(observable.set, original);
  assert.equal(Object.hasOwn(observable, 'set'), false); assert.equal(f.context._onDidChangeContext._isPaused, 0);
  release(); deferSnippetNotifications(f.controller)();
});
