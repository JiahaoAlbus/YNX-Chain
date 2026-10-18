import test from 'node:test';
import assert from 'node:assert/strict';
import { mountCctpUI } from './cctp-ui.mjs';

const ID = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
const REVIEW_ID = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
const QUOTE_ID = 'cccccccc-cccc-4ccc-cccc-cccccccccccc';
const RECIPIENT = '0x2222222222222222222222222222222222222222';
const HASH = `0x${'ab'.repeat(32)}`;
const clone = value => structuredClone(value);
const ok = value => ({ ok: true, value: clone(value) });
const gate = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

// Real production listeners and async control flow run against this tiny DOM.
// No HTML parsing, GUI, real IPC, custody, network, keys or source mutations.
class TinyNode {
  constructor(tag, ownerDocument) { this.tagName = tag.toUpperCase(); this.ownerDocument = ownerDocument; this.children = []; this.listeners = new Map(); this.attributes = new Map(); this.disabled = false; this._text = ''; this.value = ''; }
  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this._text = ''; this.children = children; }
  addEventListener(name, action) { const actions = this.listeners.get(name) ?? []; actions.push(action); this.listeners.set(name, actions); }
  dispatch(name) { return Promise.all((this.listeners.get(name) ?? []).map(action => action({ target: this }))); }
  click() { return this.disabled ? Promise.resolve() : this.dispatch('click'); }
}
const walk = node => [node, ...node.children.flatMap(walk)];
const buttons = root => walk(root).filter(node => node.tagName === 'BUTTON');
const button = (root, label) => { const value = buttons(root).find(node => node.textContent === label); assert.ok(value, `Missing button: ${label}`); return value; };
const hasButton = (root, label) => buttons(root).some(node => node.textContent === label);
const mutationLabels = ['Review route and fees', 'Confirm route', 'Review next transaction', 'Confirm and send this transaction', 'Cancel before sending', 'Discard current review'];
const assertFenced = root => { for (const label of mutationLabels) assert.ok(!hasButton(root, label), `Unknown original operation must fence: ${label}`); };
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

function fixture() {
  const doc = { createElement(tag) { return new TinyNode(tag, this); } }, root = doc.createElement('section');
  const quote = { quoteId: QUOTE_ID, recipient: RECIPIENT, amountUnits: '1000000', minimumReceivedUnits: '999900', maxFeeUnits: '100', maxSourceGasFeeWei: '1000000000000000', maxDestinationGasFeeWei: '1000000000000000' };
  const ready = { id: ID, state: 'ready', binding: { quoteId: QUOTE_ID, recipient: RECIPIENT, amountUnits: '1000000' }, operations: [], proof: null, destination: null };
  const review = { id: REVIEW_ID, intentId: ID, step: 'burn', transaction: { to: '0x1111111111111111111111111111111111111111' }, fee: '123' };
  const pending = { ...clone(ready), state: 'burn-pending', operations: [{ id: REVIEW_ID, step: 'burn', state: 'unknown', hash: HASH }] };
  const result = { quote, start: ready, prepare: review, confirm: pending, cancel: { cancelled: true, record: { ...clone(ready), state: 'cancelled' } }, history: [pending], check: pending };
  const calls = [], overrides = {};
  const api = Object.fromEntries(Object.keys(result).map(method => [method, async input => { calls.push({ method, input: clone(input) }); return overrides[method] ? overrides[method](input) : ok(result[method]); }]));
  const ui = mountCctpUI({ root, api });
  const click = label => button(root, label).click();
  const select = async state => { const entry = buttons(root).find(node => node.textContent.startsWith(`${state} ·`)); assert.ok(entry, `Missing history record: ${state}`); await entry.click(); };
  const reachReady = async () => { await click('Review route and fees'); await click('Confirm route'); };
  const reachReview = async () => { await reachReady(); await click('Review next transaction'); };
  const hold = method => { const entered = gate(), response = gate(); overrides[method] = () => { entered.resolve(); return response.promise; }; return { entered: entered.promise, ...response }; };
  return { root, ui, quote, ready, review, pending, result, calls, overrides, click, select, reachReady, reachReview, hold };
}

for (const state of ['cancelled', 'completed']) test(`terminal recovery from ${state} exposes original check before releasing the unknown-write fence`, async () => {
  const h = fixture();
  try {
    if (state === 'cancelled') await h.reachReady(); else await h.reachReview();
    const method = state === 'cancelled' ? 'cancel' : 'confirm';
    const held = h.hold(method);
    const action = h.click(state === 'cancelled' ? 'Cancel before sending' : 'Confirm and send this transaction');
    await held.entered;
    h.ui.invalidate(); await action;
    const terminal = { ...clone(state === 'cancelled' ? h.ready : h.pending), state };
    h.result.history = [terminal]; h.result.check = terminal;
    await h.click('Restore transfer history'); await h.select(state);
    assertFenced(h.root);
    assert.equal(button(h.root, 'Check original transfer').disabled, false, 'A terminal history record still needs its original check to resolve the lost write response');
    await h.click('Check original transfer');
    assert.deepEqual(h.calls.at(-1), { method: 'check', input: ID });
    assert.ok(hasButton(h.root, 'Review route and fees'), 'Only original check may release the unknown-write fence');
    assert.equal(h.calls.filter(call => call.method === method).length, 1);
  } finally { h.ui.dispose(); }
});

test('a retired readonly check releases history; its finally and late payload cannot release or overwrite the newer request', async () => {
  const h = fixture();
  try {
    await h.click('Restore transfer history'); await h.select('burn-pending');
    const old = h.hold('check'), oldAction = h.click('Check original transfer'); await old.entered;
    h.ui.invalidate();
    assert.equal(button(h.root, 'Restore transfer history').disabled, false);
    const fresh = h.hold('history'), freshAction = h.click('Restore transfer history'); await fresh.entered;
    await oldAction; // The stopped old renderer wait must not release fresh busy.
    assert.equal(button(h.root, 'Restore transfer history').disabled, true);
    assert.ok(buttons(h.root).every(node => node.disabled));
    const current = { ...clone(h.pending), id: 'dddddddd-dddd-4ddd-dddd-dddddddddddd', operations: [{ ...h.pending.operations[0], hash: `0x${'cd'.repeat(32)}` }] };
    fresh.resolve(ok([current])); await freshAction; await h.select('burn-pending');
    old.resolve(ok({ ...clone(h.pending), state: 'completed' })); await flush();
    assert.ok(h.root.textContent.includes(current.operations[0].hash));
    assert.ok(!h.root.textContent.includes(HASH), 'Late original payload cannot replace the newly selected record');
    assert.ok(!h.root.textContent.includes('completed'));
    assert.deepEqual(h.calls, [{ method: 'history', input: undefined }, { method: 'check', input: ID }, { method: 'history', input: undefined }]);
  } finally { h.ui.dispose(); }
});

for (const method of ['prepare', 'cancel']) test(`invalidated ${method} remains fenced until original check; a late rejection cannot restore the cleared fence`, async () => {
  const h = fixture();
  try {
    await h.reachReady();
    const held = h.hold(method), action = h.click(method === 'prepare' ? 'Review next transaction' : 'Cancel before sending');
    await held.entered; h.ui.invalidate(); await action;
    assertFenced(h.root);
    h.result.history = [h.ready]; h.result.check = h.ready;
    await h.click('Restore transfer history'); await h.select('ready');
    assertFenced(h.root);
    assert.equal(button(h.root, 'Check original transfer').disabled, false);
    await h.click('Check original transfer');
    assert.deepEqual(h.calls.at(-1), { method: 'check', input: ID });
    assert.ok(hasButton(h.root, 'Review next transaction'));
    held.reject(new Error('Late original transport rejection')); await flush();
    assert.ok(hasButton(h.root, 'Review next transaction'), 'A retired request cannot reinstate recovery after its intent was checked');
    assert.ok(!h.root.textContent.includes('Late original transport rejection'));
    assert.equal(h.calls.filter(call => call.method === method).length, 1);
  } finally { h.ui.dispose(); }
});

test('confirm times out at 120000ms without resending and only original intent check releases recovery', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = fixture();
  try {
    await h.reachReview();
    const held = h.hold('confirm'), action = h.click('Confirm and send this transaction'); await held.entered;
    t.mock.timers.tick(119999); await flush();
    assert.equal(button(h.root, 'Check original transfer').disabled, true, 'The deadline must not fire early');
    t.mock.timers.tick(1); await action;
    assert.ok(h.root.textContent.includes('Wallet response timed out'));
    assertFenced(h.root);
    assert.equal(button(h.root, 'Check original transfer').disabled, false);
    assert.deepEqual(h.calls.filter(call => call.method === 'confirm'), [{ method: 'confirm', input: { id: ID, reviewId: REVIEW_ID } }]);
    h.result.check = { ...clone(h.pending), state: 'completed' };
    await h.click('Check original transfer');
    assert.deepEqual(h.calls.at(-1), { method: 'check', input: ID });
    assert.ok(hasButton(h.root, 'Review route and fees'));
    held.resolve(ok(h.ready)); await flush();
    assert.ok(h.root.textContent.includes('completed'));
    assert.ok(!hasButton(h.root, 'Review next transaction'), 'Late confirm payload cannot replace the reconciled terminal record');
    assert.equal(h.calls.filter(call => call.method === 'confirm').length, 1);
  } finally { h.ui.dispose(); }
});

test('timed-out start is found by original quote ID in history and still needs that intent check before another write', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = fixture();
  try {
    await h.click('Review route and fees');
    const held = h.hold('start'), action = h.click('Confirm route'); await held.entered;
    t.mock.timers.tick(120000); await action;
    assertFenced(h.root);
    const unrelated = { ...clone(h.ready), id: 'eeeeeeee-eeee-4eee-eeee-eeeeeeeeeeee', binding: { ...h.ready.binding, quoteId: 'ffffffff-ffff-4fff-ffff-ffffffffffff' } };
    h.result.history = [unrelated]; h.result.check = unrelated;
    await h.click('Restore transfer history'); await h.select('ready');
    await h.click('Check original transfer');
    assertFenced(h.root);
    assert.deepEqual(h.calls.at(-1), { method: 'check', input: unrelated.id });
    h.result.history = [h.ready]; h.result.check = h.ready;
    await h.click('Restore transfer history'); await h.select('ready');
    assertFenced(h.root, 'Matching quote history only locates the original intent');
    await h.click('Check original transfer');
    assert.deepEqual(h.calls.at(-1), { method: 'check', input: ID });
    assert.ok(hasButton(h.root, 'Review next transaction'));
    assert.deepEqual(h.calls.filter(call => call.method === 'start'), [{ method: 'start', input: QUOTE_ID }]);
    held.resolve(ok({ ...h.ready, id: unrelated.id })); await flush();
    await h.click('Check original transfer');
    assert.deepEqual(h.calls.at(-1), { method: 'check', input: ID }, 'Late start payload cannot change the original recovered intent');
  } finally { h.ui.dispose(); }
});

test('dispose retires the unresolved action and clears its deadline without waiting for the main response', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const schedule = globalThis.setTimeout, cancelTimer = globalThis.clearTimeout;
  const scheduled = [], cleared = [];
  t.mock.method(globalThis, 'setTimeout', (callback, delay, ...args) => { const timer = schedule(callback, delay, ...args); scheduled.push({ timer, delay }); return timer; });
  t.mock.method(globalThis, 'clearTimeout', timer => { cleared.push(timer); return cancelTimer(timer); });
  const h = fixture();
  try {
    const held = h.hold('history'), action = h.click('Restore transfer history'); await held.entered;
    assert.equal(scheduled.length, 1); assert.equal(scheduled[0].delay, 120000);
    h.ui.dispose(); await action;
    assert.ok(cleared.includes(scheduled[0].timer));
    assert.equal(h.root.children.length, 0);
    t.mock.timers.tick(120000); await flush();
    held.resolve(ok([h.pending])); await flush();
    assert.equal(h.root.children.length, 0);
    assert.deepEqual(h.calls, [{ method: 'history', input: undefined }]);
  } finally { h.ui.dispose(); }
});
