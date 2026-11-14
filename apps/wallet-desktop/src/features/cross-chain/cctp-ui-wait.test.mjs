import test from 'node:test';
import assert from 'node:assert/strict';
import { mountCctpUI } from './cctp-ui.mjs';
import { validateNetwork } from '../../multichain-config.mjs';

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
  const result = { preflight: {routeId:'cctp-v2-sepolia-base-sepolia-usdc',available:true,source:{side:'source',chainId:11155111,genesis:'0x'+'11'.repeat(32),status:'verified',stage:'rpc-identity',errorCode:null},destination:{side:'destination',chainId:84532,genesis:'0x'+'22'.repeat(32),status:'verified',stage:'rpc-identity',errorCode:null},canSign:false,approved:false,canRetry:false,targetReceived:false}, quote, start: ready, prepare: review, confirm: pending, cancel: { cancelled: true, record: { ...clone(ready), state: 'cancelled' } }, history: [pending], check: pending };
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

// These are public DATA observations returned by original check, not a new
// terminal route state, cancellation permission, or replacement-send grant.
const OBSERVATION_ACCOUNT = `0x${'11'.repeat(20)}`;
const OBSERVATION_NETWORK = validateNetwork({ name: 'Public source fixture', rpcUrl: 'https://example.com', chainId: '11155111', symbol: 'ETH', decimals: 18, genesis: `0x${'12'.repeat(32)}` });
const observationMessages = {
  cancelled: 'Wallet recorded cancellation before signing. Transfer outcome is unknown.',
  'local-cancelled-before-broadcast': 'Wallet recorded a local cancellation for the signed transaction. Transfer outcome is unknown.',
};
function observedOriginal(h, recordedState) {
  const record = clone(h.pending);
  record.binding.account = OBSERVATION_ACCOUNT;
  record.binding.sourceNetwork = clone(OBSERVATION_NETWORK);
  record.operations[0].hash = recordedState === 'cancelled' ? null : HASH;
  record.originalObservation = {
    version: 1, intentId: record.id, operationId: REVIEW_ID, step: 'burn', account: OBSERVATION_ACCOUNT,
    network: clone(OBSERVATION_NETWORK), recordedState, hash: record.operations[0].hash,
    view: 'query-only', routeOutcome: 'unknown',
  };
  return record;
}
const persistedOriginal = value => { const record = clone(value); delete record.originalObservation; return record; };
const unrelatedRecord = (h, state) => ({
  ...clone(h.ready), state,
  id: state === 'ready' ? 'dddddddd-dddd-4ddd-dddd-dddddddddddd' : 'eeeeeeee-eeee-4eee-eeee-eeeeeeeeeeee',
  binding: { ...clone(h.ready.binding), quoteId: 'ffffffff-ffff-4fff-ffff-ffffffffffff' },
});
const writeCalls = h => h.calls.filter(call => ['quote', 'start', 'prepare', 'confirm', 'cancel'].includes(call.method));

for (const recordedState of Object.keys(observationMessages)) {
  test(`original observation distinguishes ${recordedState} without claiming cancellation of the route`, async () => {
    const h = fixture();
    try {
      const original = observedOriginal(h, recordedState);
      h.result.history = [persistedOriginal(original)];
      h.result.check = original;
      await h.click('Restore transfer history'); await h.select('burn-pending');
      await h.click('Check original transfer');
      assert.ok(h.root.textContent.includes(observationMessages[recordedState]), 'Show the original Wallet observation without changing the route outcome');
      assert.ok(!h.root.textContent.includes(observationMessages[recordedState === 'cancelled' ? 'local-cancelled-before-broadcast' : 'cancelled']));
      assert.ok(h.root.textContent.includes('burn-pending'));
      if (original.originalObservation.hash) {
        const details = walk(h.root).find(node => node.tagName === 'DL');
        const label = details.children.findIndex(node => node.tagName === 'DT' && node.textContent === 'Recorded transaction hash');
        assert.ok(label >= 0, 'The original signed transaction hash needs a distinct observation label');
        assert.equal(details.children[label + 1].textContent, HASH);
      } else {
        assert.ok(!h.root.textContent.includes(HASH), 'A pre-sign cancellation has no signed transaction hash');
      }
      assert.ok(!h.root.textContent.includes('Destination mint finalized and receipt verified.'));
      assert.deepEqual(h.calls, [{ method: 'history', input: undefined }, { method: 'check', input: ID }]);
    } finally { h.ui.dispose(); }
  });

  test(`original observation ${recordedState} keeps the lost-confirm fence across other history records`, async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const h = fixture();
    try {
      const oldQuoteButton = button(h.root, 'Review route and fees');
      await h.reachReady();
      const oldPrepareButton = button(h.root, 'Review next transaction');
      await h.click('Review next transaction');
      const oldConfirmButton = button(h.root, 'Confirm and send this transaction');
      const held = h.hold('confirm'), action = h.click('Confirm and send this transaction'); await held.entered;
      t.mock.timers.tick(120000); await action;
      const original = observedOriginal(h, recordedState);
      h.result.check = original;
      await h.click('Check original transfer');
      const writesBefore = clone(writeCalls(h));
      h.result.history = [persistedOriginal(original), unrelatedRecord(h, 'ready'), unrelatedRecord(h, 'completed')];
      await h.click('Restore transfer history'); await h.select('ready');
      assertFenced(h.root);
      // Retained old handlers must obey the same fence as newly rendered UI.
      await oldQuoteButton.click(); await oldPrepareButton.click(); await oldConfirmButton.click();
      h.result.check = unrelatedRecord(h, 'ready'); await h.click('Check original transfer');
      assertFenced(h.root);
      await h.select('completed'); assertFenced(h.root);
      // A late successful confirm response is not a fresh original check.
      held.resolve(ok(h.ready)); await flush(); assertFenced(h.root);
      assert.deepEqual(writeCalls(h), writesBefore, 'No quote, prepare or send may follow a query-only observation');
      assert.equal(h.calls.filter(call => call.method === 'confirm').length, 1);
      assert.deepEqual(h.calls.filter(call => call.method === 'check').map(call => call.input), [ID, unrelatedRecord(h, 'ready').id]);
    } finally { h.ui.dispose(); }
  });
}

test('original observation from cold history establishes a write fence until a later trusted original result', async () => {
  const h = fixture();
  try {
    const original = observedOriginal(h, 'local-cancelled-before-broadcast'), other = unrelatedRecord(h, 'ready');
    h.result.history = [persistedOriginal(original), other]; h.result.check = original;
    await h.click('Restore transfer history'); await h.select('burn-pending');
    await h.click('Check original transfer');
    await h.select('ready'); assertFenced(h.root);
    h.result.check = other; await h.click('Check original transfer'); assertFenced(h.root);
    assert.deepEqual(writeCalls(h), []);
    await h.select('burn-pending');
    const trusted = clone(original); delete trusted.originalObservation;
    trusted.state = 'attestation-pending'; trusted.operations[0].state = 'included';
    h.result.check = trusted; await h.click('Check original transfer');
    await h.select('ready');
    assert.ok(hasButton(h.root, 'Review next transaction'), 'Only a later trusted check of the original intent resolves this observation fence');
    assert.deepEqual(writeCalls(h), []);
  } finally { h.ui.dispose(); }
});

test('original observation arriving after account invalidation cannot replace the new account record', async () => {
  const h = fixture();
  try {
    const original = observedOriginal(h, 'local-cancelled-before-broadcast');
    h.result.history = [h.pending];
    await h.click('Restore transfer history'); await h.select('burn-pending');
    const held = h.hold('check'), action = h.click('Check original transfer'); await held.entered;
    // Main's account/lock listener invalidates this renderer before the next
    // account-owned history response. No real Wallet account is accessed.
    h.ui.invalidate(); await action;
    const current = { ...clone(h.pending), id: 'dddddddd-dddd-4ddd-dddd-dddddddddddd', binding: { ...clone(h.pending.binding), account: `0x${'33'.repeat(20)}` }, operations: [{ ...clone(h.pending.operations[0]), id: 'eeeeeeee-eeee-4eee-eeee-eeeeeeeeeeee', hash: `0x${'cd'.repeat(32)}` }] };
    h.result.history = [current];
    await h.click('Restore transfer history'); await h.select('burn-pending');
    held.resolve(ok(original)); await flush();
    assert.ok(h.root.textContent.includes(current.operations[0].hash));
    assert.ok(!h.root.textContent.includes(HASH));
    assert.ok(!h.root.textContent.includes(observationMessages['local-cancelled-before-broadcast']));
    h.overrides.check = () => ok(current); await h.click('Check original transfer');
    assert.deepEqual(h.calls.at(-1), { method: 'check', input: current.id });
    assert.deepEqual(writeCalls(h), []);
  } finally { h.ui.dispose(); }
});

test('original observation already displayed is removed on account or lock invalidation', async () => {
  const h = fixture();
  try {
    h.result.check = observedOriginal(h, 'local-cancelled-before-broadcast');
    await h.click('Restore transfer history'); await h.select('burn-pending'); await h.click('Check original transfer');
    assert.ok(h.root.textContent.includes(observationMessages['local-cancelled-before-broadcast']));
    const before = clone(h.calls); h.ui.invalidate();
    assert.ok(!h.root.textContent.includes(HASH));
    assert.ok(!h.root.textContent.includes(observationMessages['local-cancelled-before-broadcast']));
    assert.deepEqual(h.calls, before, 'Invalidation must not make another IPC request');
    assertFenced(h.root);
  } finally { h.ui.dispose(); }
});

test('original observation cold recovery survives account switching until its original intent is checked', async () => {
  const h = fixture();
  try {
    const original = observedOriginal(h, 'local-cancelled-before-broadcast');
    h.result.history = [persistedOriginal(original)]; h.result.check = original;
    await h.click('Restore transfer history'); await h.select('burn-pending'); await h.click('Check original transfer');
    h.ui.invalidate();
    const otherAccount = unrelatedRecord(h, 'ready'); otherAccount.binding.account = `0x${'33'.repeat(20)}`;
    h.result.history = [otherAccount]; h.result.check = otherAccount;
    await h.click('Restore transfer history'); await h.select('ready'); await h.click('Check original transfer');
    assertFenced(h.root);
    assert.ok(!h.root.textContent.includes(HASH));
    assert.ok(!h.root.textContent.includes(observationMessages['local-cancelled-before-broadcast']));
    h.ui.invalidate();
    const trusted = persistedOriginal(original); trusted.state = 'attestation-pending'; trusted.operations[0].state = 'included';
    const otherOriginalAccount = unrelatedRecord(h, 'ready'); otherOriginalAccount.binding.account = OBSERVATION_ACCOUNT;
    h.result.history = [persistedOriginal(original), otherOriginalAccount];
    await h.click('Restore transfer history');
    const differentOperation = clone(trusted); differentOperation.operations[0].id = 'ffffffff-ffff-4fff-ffff-ffffffffffff';
    const differentHash = clone(trusted); differentHash.operations[0].hash = `0x${'ef'.repeat(32)}`;
    for (const [reason, result] of [
      ['the same original operation is still UNKNOWN', persistedOriginal(original)],
      ['an included operation has a different original ID', differentOperation],
      ['an included operation has a different known original hash', differentHash],
    ]) {
      h.result.check = result;
      await h.select('burn-pending'); await h.click('Check original transfer'); await h.select('ready');
      assertFenced(h.root);
      assert.deepEqual(writeCalls(h), [], reason);
    }
    h.result.check = trusted;
    await h.select('burn-pending'); await h.click('Check original transfer');
    await h.select('ready');
    assert.ok(hasButton(h.root, 'Review next transaction'));
    assert.deepEqual(h.calls.filter(call => call.method === 'check').map(call => call.input), [ID, otherAccount.id, ID, ID, ID, ID]);
    assert.deepEqual(writeCalls(h), [], 'Account changes and original-result queries never trigger writes');
  } finally { h.ui.dispose(); }
});

test('independent original observations survive account switches and resolve one operation at a time', async () => {
  const h = fixture();
  try {
    const first = observedOriginal(h, 'cancelled');
    const second = observedOriginal(h, 'local-cancelled-before-broadcast');
    second.id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    second.binding.account = `0x${'33'.repeat(20)}`;
    second.operations[0].id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
    Object.assign(second.originalObservation, {
      intentId: second.id, operationId: second.operations[0].id, account: second.binding.account,
    });
    const restore = async (pending, other) => {
      h.result.history = [persistedOriginal(pending), other];
      await h.click('Restore transfer history');
      await h.select('burn-pending');
    };
    const included = pending => {
      const result = persistedOriginal(pending);
      result.state = 'attestation-pending';
      result.operations[0].state = 'included';
      result.operations[0].hash ??= `0x${'34'.repeat(32)}`;
      return result;
    };
    const readyFirst = unrelatedRecord(h, 'ready');
    const readySecond = unrelatedRecord(h, 'ready');
    readyFirst.binding.account = first.binding.account;
    readySecond.binding.account = second.binding.account;

    await restore(first, readyFirst);
    h.result.check = first; await h.click('Check original transfer');
    h.ui.invalidate();
    await restore(second, readySecond);
    h.result.check = second; await h.click('Check original transfer');
    h.ui.invalidate();
    await restore(first, readyFirst);
    h.result.check = included(first); await h.click('Check original transfer');
    await h.select('ready');
    assertFenced(h.root);
    assert.ok(!h.root.textContent.includes(HASH), 'The other account hash stays hidden while its recovery is pending');

    h.ui.invalidate();
    await restore(second, readySecond);
    h.result.check = persistedOriginal(second); await h.click('Check original transfer');
    await h.select('ready'); assertFenced(h.root);
    await h.select('burn-pending');
    h.result.check = included(second); await h.click('Check original transfer');
    await h.select('ready');
    assert.ok(hasButton(h.root, 'Review next transaction'));
    assert.deepEqual(h.calls.filter(call => call.method === 'check').map(call => call.input), [first.id, second.id, first.id, second.id, second.id]);
    assert.deepEqual(writeCalls(h), []);
  } finally { h.ui.dispose(); }
});

test('original observation opening retains a legacy completed mint whose journal is still unknown', async () => {
  const h = fixture();
  try {
    const legacy = persistedOriginal(observedOriginal(h, 'local-cancelled-before-broadcast'));
    legacy.state = 'completed';
    legacy.operations[0].step = 'mint';
    legacy.binding.destinationNetwork = clone(OBSERVATION_NETWORK);
    h.result.history = [legacy];
    await h.ui.open();
    assertFenced(h.root);
    assert.ok(hasButton(h.root, 'Check original transfer'));
    assert.ok(!h.root.textContent.includes('Destination mint finalized and receipt verified.'));
    h.result.check = legacy;
    await h.click('Check original transfer');
    assertFenced(h.root);
    assert.deepEqual(h.calls.filter(call => call.method === 'check').map(call => call.input), [ID]);
    assert.deepEqual(writeCalls(h), []);
  } finally { h.ui.dispose(); }
});

test('original observation on opening Cross restores UNKNOWN before allowing a quote, even after closing the dialog', async () => {
  const h = fixture();
  try {
    const pending = persistedOriginal(observedOriginal(h, 'local-cancelled-before-broadcast'));
    h.result.confirm = pending;
    h.result.history = [pending, unrelatedRecord(h, 'completed')];
    h.result.check = pending;
    await h.reachReview();
    await h.click('Confirm and send this transaction');
    h.ui.invalidate();
    const history = h.hold('history');
    const opened = h.ui.open();
    assertFenced(h.root);
    await history.entered;
    history.resolve(ok(h.result.history));
    await opened;
    assert.ok(h.root.textContent.includes(HASH), 'Select the original unresolved transfer from current history');
    await h.click('Check original transfer');
    await h.select('completed');
    assertFenced(h.root);
    await h.select('burn-pending');
    const included = clone(pending);
    included.state = 'attestation-pending';
    included.operations[0].state = 'included';
    h.result.check = included;
    await h.click('Check original transfer');
    await h.select('completed');
    assert.ok(hasButton(h.root, 'Review route and fees'));
    assert.deepEqual(h.calls.filter(call => call.method === 'check').map(call => call.input), [ID, ID]);
    assert.equal(writeCalls(h).filter(call => call.method === 'confirm').length, 1);
  } finally { h.ui.dispose(); }
});

test('original observation on opening Cross holds writes on failed or retired history and the normal restore can recover', async () => {
  const h = fixture();
  try {
    const old = h.hold('history');
    const opened = h.ui.open();
    await old.entered;
    h.ui.invalidate();
    await opened;
    h.overrides.history = async () => ({ok:false,error:{message:'History temporarily unavailable'}});
    await h.ui.open();
    assertFenced(h.root);
    assert.ok(h.root.textContent.includes('History temporarily unavailable'));
    old.resolve(ok([h.pending]));
    await flush();
    assert.ok(!h.root.textContent.includes(HASH));
    const review = clone(h.ready);
    review.state = 'burn-ready';
    review.operations = [
      {id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', step: 'approve', state: 'included', hash: HASH},
      {id: REVIEW_ID, step: 'burn', state: 'review', hash: null},
    ];
    h.overrides.history = async () => ok([review]);
    await h.click('Restore transfer history');
    await h.select('burn-ready');
    assert.ok(hasButton(h.root, 'Discard current review'));
    assert.deepEqual(writeCalls(h), []);
  } finally { h.ui.dispose(); }
});
