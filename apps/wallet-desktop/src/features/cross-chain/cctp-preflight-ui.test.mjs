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

test('standalone preflight displays each side and never requests quote, approval or transaction work', async () => {
  const h = fixture();
  try {
    h.result.preflight.available = false;
    Object.assign(h.result.preflight.destination, { status: 'unverified', errorCode: 'MULTICHAIN_RPC_ERROR' });
    await h.click('Check route availability');
    assert.deepEqual(h.calls, [{method:'preflight',input:{routeId:'cctp-v2-sepolia-base-sepolia-usdc'}}]);
    assert.ok(h.root.textContent.includes('Source Ethereum Sepolia · 11155111 · Chain identity and genesis pin verified'));
    assert.ok(h.root.textContent.includes('Destination Base Sepolia · 84532 · Unverified'));
    assert.ok(h.root.textContent.includes('rpc-identity · MULTICHAIN_RPC_ERROR'));
    assert.ok(!hasButton(h.root, 'Confirm route'));
    await h.click('Review route and fees');
    assert.deepEqual(h.calls.map(v=>v.method), ['preflight','preflight']);
    assert.ok(!h.root.textContent.includes('Working…'));
    assert.equal(button(h.root, 'Restore transfer history').disabled, false);
  } finally { h.ui.dispose(); }
});

test('quote explicitly checks current availability first and creates no quote from a malformed grant', async () => {
  const h = fixture();
  try {
    h.result.preflight.canSign = true;
    await h.click('Review route and fees');
    assert.deepEqual(h.calls.map(v=>v.method), ['preflight']);
    assert.ok(!hasButton(h.root,'Confirm route'));
    h.result.preflight.canSign = false;
    await h.click('Review route and fees');
    assert.deepEqual(h.calls.map(v=>v.method), ['preflight','preflight','quote']);
    assert.ok(hasButton(h.root,'Confirm route'));
  } finally { h.ui.dispose(); }
});

for (const invalidation of ['lock-account-network', 'input', 'stop', 'dispose']) test(`late preflight cannot publish availability after ${invalidation}`, async () => {
  const h = fixture();
  try {
    const held = h.hold('preflight'), action = h.click('Check route availability'); await held.entered;
    if (invalidation === 'input') await walk(h.root).find(n=>n.tagName==='INPUT').dispatch('input');
    else if (invalidation === 'stop') await h.click('Stop route check');
    else if (invalidation === 'dispose') h.ui.dispose();
    else h.ui.invalidate();
    if (invalidation !== 'input') await action;
    held.resolve(ok(h.result.preflight)); await action; await flush();
    assert.ok(!h.root.textContent.includes('Chain identity and genesis pin verified'));
    assert.ok(!hasButton(h.root,'Confirm route'));
    assert.equal(h.calls.length,1);
    if(invalidation !== 'dispose')assert.equal(button(h.root,'Restore transfer history').disabled,false);
  } finally { h.ui.dispose(); }
});

test('stopped quote preflight cannot proceed to quote; a newer preflight owns the visible result', async () => {
  const h = fixture();
  try {
    const old = h.hold('preflight'), oldAction = h.click('Review route and fees'); await old.entered;
    await h.click('Stop route check'); await oldAction;
    const fresh = h.hold('preflight'), newAction = h.click('Check route availability'); await fresh.entered;
    old.resolve(ok(h.result.preflight)); await flush();
    assert.equal(button(h.root,'Restore transfer history').disabled,true);
    const unavailable = clone(h.result.preflight); unavailable.available=false;
    Object.assign(unavailable.destination,{status:'unverified',stage:'network-selection',errorCode:'CCTP_NETWORK_REQUIRED',genesis:null});
    fresh.resolve(ok(unavailable)); await newAction;
    assert.ok(h.root.textContent.includes('CCTP_NETWORK_REQUIRED'));
    assert.ok(!h.root.textContent.includes('Confirm route'));
    assert.deepEqual(h.calls.map(v=>v.method),['preflight','preflight']);
  } finally { h.ui.dispose(); }
});

test('successful preflight preserves an unknown-write fence, original history and original check', async () => {
  const h = fixture();
  try {
    await h.reachReady();
    const held=h.hold('prepare'), action=h.click('Review next transaction');await held.entered;
    h.ui.invalidate();await action;assertFenced(h.root);
    await h.click('Check route availability');assertFenced(h.root);
    assert.ok(h.root.textContent.includes('Chain identity and genesis pin verified'));
    h.result.history=[h.ready];h.result.check=h.ready;
    await h.click('Restore transfer history');await h.select('ready');assertFenced(h.root);
    await h.click('Check route availability');assertFenced(h.root);
    await h.click('Check original transfer');
    assert.ok(hasButton(h.root,'Review next transaction'));
    assert.equal(h.calls.filter(v=>v.method==='prepare').length,1);
    assert.equal(h.calls.filter(v=>v.method==='confirm').length,0);
    held.resolve(ok(h.review));await flush();
    assert.ok(!hasButton(h.root,'Confirm and send this transaction'));
  } finally { h.ui.dispose(); }
});

for(const failure of ['unverified','rejected'])test(`fresh standalone ${failure} preflight retires a previous unconsumed quote`,async()=>{
  const h=fixture();try{
    await h.click('Review route and fees');assert.ok(hasButton(h.root,'Confirm route'));
    if(failure==='unverified'){h.result.preflight.available=false;Object.assign(h.result.preflight.destination,{status:'unverified',errorCode:'MULTICHAIN_RPC_ERROR'});}
    else h.overrides.preflight=async()=>{throw new Error('Current identity unavailable')};
    await h.click('Check route availability');
    assert.ok(!hasButton(h.root,'Confirm route'),'An earlier quote cannot survive a newer availability check');
    assert.equal(h.calls.filter(v=>v.method==='start').length,0);
  }finally{h.ui.dispose()}
});
