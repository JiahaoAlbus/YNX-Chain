import test from 'node:test';
import assert from 'node:assert/strict';
import { mountCctpUI } from './cctp-ui.mjs';
import { installCctpIPC } from './cctp-flow.mjs';

const RECIPIENT = '0x2222222222222222222222222222222222222222';
const INTENT_ID = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
const REVIEW_ID = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
const TX_HASH = `0x${'ab'.repeat(32)}`;
const copy = value => structuredClone(value);
const ok = value => ({ ok: true, value: copy(value) });
const gate = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

// Deliberately small DOM facade: actual production click handlers run, but no
// browser, GUI, HTML parser, package installation or real IPC is involved.
class FakeNode {
  constructor(tag, document) { this.tagName = tag.toUpperCase(); this.ownerDocument = document; this.children = []; this.attributes = new Map(); this.listeners = new Map(); this._text = ''; this.disabled = false; this.value = ''; }
  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
  set innerHTML(_value) { this.ownerDocument.htmlWrites++; throw new Error('Renderer must not parse untrusted HTML.'); }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this._text = ''; this.children = children; }
  addEventListener(name, listener) { const listeners = this.listeners.get(name) ?? []; listeners.push(listener); this.listeners.set(name, listeners); }
  dispatch(name) { return Promise.all((this.listeners.get(name) ?? []).map(listener => listener({ target: this, type: name }))); }
  click() { return this.disabled ? Promise.resolve() : this.dispatch('click'); }
}

const walk = node => [node, ...node.children.flatMap(walk)];
const nodes = (root, tag) => walk(root).filter(node => node.tagName === tag.toUpperCase());
const button = (root, label) => { const found = nodes(root, 'button').find(node => node.textContent === label); assert.ok(found, `Missing button: ${label}`); return found; };
const hasButton = (root, label) => nodes(root, 'button').some(node => node.textContent === label);
const detailValues = root => nodes(root, 'dd').map(node => node.textContent);

function fixture({ locale = 'en', recipient = RECIPIENT } = {}) {
  const document = { htmlWrites: 0, created: [], createElement(tag) { this.created.push(tag); return new FakeNode(tag, this); } };
  const root = document.createElement('section');
  const quote = { quoteId: 'cccccccc-cccc-4ccc-cccc-cccccccccccc', amountUnits: '1000000', minimumReceivedUnits: '999900', maxFeeUnits: '100', maxSourceGasFeeWei: '1000000000000000', maxDestinationGasFeeWei: '1000000000000000', recipient };
  const ready = { id: INTENT_ID, state: 'ready', operations: [], binding: { recipient, amountUnits: '1000000' }, proof: null, destination: null };
  const review = { id: REVIEW_ID, intentId: INTENT_ID, step: 'burn', transaction: { to: '0x1111111111111111111111111111111111111111' }, fee: '2345' };
  const pending = { ...copy(ready), state: 'burn-pending', operations: [{ id: REVIEW_ID, step: 'burn', state: 'unknown', hash: TX_HASH }] };
  const calls = [], overrides = {};
  const defaultResults = { quote, start: ready, prepare: review, confirm: pending, check: pending, history: [pending], cancel: { cancelled: true, record: { ...ready, state: 'cancelled' } } };
  const api = Object.fromEntries(Object.keys(defaultResults).map(method => [method, async input => {
    calls.push({ method, input: copy(input) });
    if (overrides[method]) return overrides[method](input);
    return ok(defaultResults[method]);
  }]));
  const ui = mountCctpUI({ root, api, locale });
  const input = label => { const found = nodes(root, 'input').find(node => node.attributes.get('aria-label') === label); assert.ok(found, `Missing input: ${label}`); return found; };
  const fill = async () => { const amount = input('Amount (USDC)'), target = input('Recipient on Base Sepolia'); amount.value = ' 1 '; target.value = ` ${recipient} `; await amount.dispatch('input'); await target.dispatch('input'); };
  const reachReview = async () => { await fill(); await button(root, 'Review route and fees').click(); await button(root, 'Confirm route').click(); await button(root, 'Review next transaction').click(); };
  return { root, document, quote, ready, review, pending, calls, overrides, ui, input, fill, reachReview };
}

test('actual buttons call quote → start → prepare → confirm once each, with exact IDs and correct USDC decimal units', async () => {
  const h = fixture(); await h.fill();
  await button(h.root, 'Review route and fees').click();
  assert.deepEqual(h.calls[0], { method: 'quote', input: { routeId: 'cctp-v2-sepolia-base-sepolia-usdc', asset: 'USDC', amount: '1', recipient: RECIPIENT, maxProtocolFee: '0', maxSourceGasFeeWei: '1000000000000000', maxDestinationGasFeeWei: '1000000000000000' } });
  const amounts = detailValues(h.root);
  assert.ok(amounts.some(value => /^1(?:\.0{1,6})?$/.test(value)), '1,000,000 base units must display as 1 USDC');
  assert.ok(amounts.some(value => /^0\.99990{0,2}$/.test(value)), 'minimum received must use six-decimal USDC units');
  assert.ok(amounts.some(value => /^0\.00010{0,2}$/.test(value)), 'fee maximum must use USDC decimal units');
  assert.ok(!amounts.includes('1000000'), 'base units cannot be labeled as a USDC amount');
  await button(h.root, 'Confirm route').click();
  assert.ok(nodes(h.root, 'input').every(node => node.disabled));
  await button(h.root, 'Review next transaction').click();
  const dispatched = gate(), entered = gate();
  h.overrides.confirm = () => { entered.resolve(); return dispatched.promise; };
  const confirm = button(h.root, 'Confirm and send this transaction');
  const action = confirm.click(); await entered.promise;
  await confirm.dispatch('click'); // Duplicate callback, including detached/stale button.
  assert.equal(h.calls.filter(value => value.method === 'confirm').length, 1);
  dispatched.resolve(ok(h.pending)); await action;
  assert.deepEqual(h.calls.map(value => value.method), ['quote', 'start', 'prepare', 'confirm']);
  assert.equal(h.calls[1].input, h.quote.quoteId);
  assert.equal(h.calls[2].input, INTENT_ID);
  assert.deepEqual(h.calls[3].input, { id: INTENT_ID, reviewId: REVIEW_ID });
  assert.ok(h.root.textContent.includes(TX_HASH));
  assert.ok(hasButton(h.root, 'Check original transfer'));
  assert.ok(!hasButton(h.root, 'Confirm and send this transaction'));
});

test('history restore selects the original pending intent and requires explicit check without prepare or send', async () => {
  const h = fixture();
  await button(h.root, 'Restore transfer history').click();
  assert.deepEqual(h.calls.map(value => value.method), ['history']);
  const entry = nodes(h.root, 'button').find(value => value.textContent.startsWith('burn-pending ·'));
  assert.ok(entry); assert.match(entry.textContent, /· 1(?:\.0{1,6})? USDC\b/);
  await entry.click();
  assert.deepEqual(h.calls.map(value => value.method), ['history']);
  assert.ok(!hasButton(h.root, 'Review next transaction'));
  assert.ok(!hasButton(h.root, 'Confirm and send this transaction'));
  await button(h.root, 'Check original transfer').click();
  assert.deepEqual(h.calls, [{ method: 'history', input: undefined }, { method: 'check', input: INTENT_ID }]);
  assert.ok(h.root.textContent.includes(TX_HASH));
});

test('input invalidation and owner lock invalidation suppress late quote results', async t => {
  for (const invalidation of ['input', 'lock']) await t.test(invalidation, async () => {
    const h = fixture(); await h.fill(); const delayed = gate();
    h.overrides.quote = () => delayed.promise;
    const action = button(h.root, 'Review route and fees').click();
    if (invalidation === 'input') { h.input('Amount (USDC)').value = '2'; await h.input('Amount (USDC)').dispatch('input'); }
    else h.ui.invalidate();
    delayed.resolve(ok(h.quote)); await action;
    assert.ok(!hasButton(h.root, 'Confirm route'));
    assert.equal(detailValues(h.root).length, 0);
    assert.deepEqual(h.calls.map(value => value.method), ['quote']);
  });
});

test('lock invalidation after prepare starts cannot resurrect an old send review', async () => {
  const h = fixture(); await h.fill();
  await button(h.root, 'Review route and fees').click(); await button(h.root, 'Confirm route').click();
  const delayed = gate(); h.overrides.prepare = () => delayed.promise;
  const action = button(h.root, 'Review next transaction').click();
  h.ui.invalidate(); delayed.resolve(ok(h.review)); await action;
  assert.ok(!hasButton(h.root, 'Confirm and send this transaction'));
  assert.equal(detailValues(h.root).length, 0);
  assert.equal(h.calls.filter(value => value.method === 'confirm').length, 0);
});

test('confirm transport timeout or error envelope keeps the original intent query-only without another confirm', async t => {
  for (const failure of ['timeout', 'envelope']) await t.test(failure, async () => {
    const h = fixture(); await h.reachReview();
    h.overrides.confirm = async () => {
      if (failure === 'timeout') throw new Error('Connection lost after original dispatch');
      return { ok: false, error: { code: 'CCTP_OUTCOME_UNKNOWN', message: 'Original dispatch outcome unknown' } };
    };
    await button(h.root, 'Confirm and send this transaction').click();
    assert.ok(!hasButton(h.root, 'Confirm and send this transaction'), 'a rejected confirmation must not retain a reusable send button');
    assert.ok(!hasButton(h.root, 'Review next transaction'), 'an uncertain attempt must not offer replacement review');
    assert.ok(hasButton(h.root, 'Check original transfer'));
    await button(h.root, 'Check original transfer').click();
    assert.equal(h.calls.filter(value => value.method === 'confirm').length, 1);
    assert.equal(h.calls.filter(value => value.method === 'prepare').length, 1);
    assert.deepEqual(h.calls.at(-1), { method: 'check', input: INTENT_ID });
    assert.ok(h.root.textContent.includes(TX_HASH));
  });
});

test('failed original lookup preserves the selected transaction hash and never signs or broadcasts', async () => {
  const h = fixture(); await button(h.root, 'Restore transfer history').click();
  await nodes(h.root, 'button').find(value => value.textContent.startsWith('burn-pending ·')).click();
  h.overrides.check = async () => ({ ok: false, error: { message: 'RPC unavailable; retain original transaction' } });
  await button(h.root, 'Check original transfer').click();
  assert.ok(h.root.textContent.includes(TX_HASH));
  assert.ok(h.root.textContent.includes('RPC unavailable; retain original transaction'));
  assert.deepEqual(h.calls.map(value => value.method), ['history', 'check']);
  assert.ok(hasButton(h.root, 'Check original transfer'));
});

test('recipient strings use textContent in quote, review and history without HTML interpretation', async () => {
  const injected = '<img src=x onerror="globalThis.attack()">';
  const h = fixture({ recipient: injected }); await h.reachReview();
  assert.ok(h.root.textContent.includes(injected));
  await button(h.root, 'Restore transfer history').click();
  assert.ok(nodes(h.root, 'button').some(value => value.textContent.includes(injected)));
  assert.equal(h.document.htmlWrites, 0);
  assert.ok(!h.document.created.includes('img'));
  assert.equal(nodes(h.root, 'img').length, 0);
});

test('dispose clears the UI and ignores a delayed response from an original request', async () => {
  const h = fixture(); const delayed = gate(); h.overrides.quote = () => delayed.promise;
  const action = button(h.root, 'Review route and fees').click(); h.ui.dispose();
  delayed.resolve(ok(h.quote)); await action;
  assert.equal(h.root.children.length, 0);
  assert.equal(h.calls.length, 1);
});

test('IPC retains original safe/sensitive wrappers and obtains a custody guard only for confirm', async () => {
  const handlers = new Map(), calls = [], wrappers = [];
  const guard = { marker: 'original-authority-guard' }; let guardCalls = 0;
  const flow = Object.fromEntries(['routes', 'history', 'check', 'quote', 'start', 'prepareStep', 'cancel', 'confirmStep'].map(method => [method, (...args) => { calls.push({ method, args }); return { method }; }]));
  installCctpIPC({
    handle(name, handler) { assert.ok(!handlers.has(name)); handlers.set(name, handler); },
    safe: async action => { wrappers.push('safe'); return { ok: true, value: await action() }; },
    sensitive: async action => { wrappers.push('sensitive'); return { ok: true, value: await action() }; },
    flow, getGuard() { guardCalls++; return guard; },
  });
  assert.equal(handlers.size, 8);
  for (const [name, method, wrapper, input] of [
    ['routes', 'routes', 'safe', undefined], ['history', 'history', 'safe', undefined], ['check', 'check', 'safe', INTENT_ID],
    ['quote', 'quote', 'sensitive', { amount: '1' }], ['start', 'start', 'sensitive', 'quote-id'], ['prepare', 'prepareStep', 'sensitive', INTENT_ID], ['cancel', 'cancel', 'sensitive', INTENT_ID],
  ]) {
    assert.deepEqual(await handlers.get(`wallet:cross-chain-${name}`)({}, input), { ok: true, value: { method } });
    assert.equal(wrappers.at(-1), wrapper);
    assert.equal(calls.at(-1).method, method);
    assert.deepEqual(calls.at(-1).args, input === undefined ? [] : [input]);
    assert.equal(guardCalls, 0);
  }
  const input = { id: INTENT_ID, reviewId: REVIEW_ID };
  assert.deepEqual(await handlers.get('wallet:cross-chain-confirm')({}, input), { ok: true, value: { method: 'confirmStep' } });
  assert.equal(wrappers.at(-1), 'sensitive');
  assert.equal(guardCalls, 1);
  assert.deepEqual(calls.at(-1), { method: 'confirmStep', args: [input, guard] });
});
