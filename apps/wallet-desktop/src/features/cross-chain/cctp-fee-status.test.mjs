import test from 'node:test';
import assert from 'node:assert/strict';
import { mountCctpUI } from './cctp-ui.mjs';

const ID = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
const QUOTE_ID = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
const RECIPIENT = '0x2222222222222222222222222222222222222222';
const BURN = `0x${'ab'.repeat(32)}`, MINT = `0x${'cd'.repeat(32)}`;
const BLOCK = `0x${'12'.repeat(32)}`, FINALIZED = `0x${'34'.repeat(32)}`;
const COMPLETED = 'Destination mint finalized and receipt verified.';
const clone = value => structuredClone(value);
const ok = value => ({ ok: true, value: clone(value) });

// The actual renderer listeners run against controlled public records. No HTML
// parser, GUI, IPC runtime, account material, signing or network is involved.
class TinyNode {
  constructor(tag, ownerDocument) { this.tagName = tag.toUpperCase(); this.ownerDocument = ownerDocument; this.children = []; this.listeners = new Map(); this.attributes = new Map(); this.disabled = false; this._text = ''; this.value = ''; }
  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
  set innerHTML(_value) { throw new Error('Use textContent for public record data.'); }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this._text = ''; this.children = children; }
  addEventListener(name, listener) { const listeners = this.listeners.get(name) ?? []; listeners.push(listener); this.listeners.set(name, listeners); }
  dispatch(name) { return Promise.all((this.listeners.get(name) ?? []).map(listener => listener({ target: this }))); }
  click() { return this.disabled ? Promise.resolve() : this.dispatch('click'); }
}
const walk = node => [node, ...node.children.flatMap(walk)];
const buttons = root => walk(root).filter(node => node.tagName === 'BUTTON');
const button = (root, label) => { const value = buttons(root).find(node => node.textContent === label); assert.ok(value, `Missing button: ${label}`); return value; };
const hasButton = (root, label) => buttons(root).some(node => node.textContent === label);
const details = root => {
  const values = walk(root).find(node => node.tagName === 'DL').children;
  return new Map(values.filter(node => node.tagName === 'DT').map(node => [node.textContent, values[values.indexOf(node) + 1]?.textContent]));
};
const status = root => walk(root).find(node => node.attributes.get('role') === 'status').textContent;

function record() {
  return {
    id: ID, state: 'mint-pending', binding: { quoteId: QUOTE_ID, recipient: RECIPIENT, amountUnits: '1000000' },
    operations: [
      { id: 'cccccccc-cccc-4ccc-cccc-cccccccccccc', step: 'burn', state: 'included', hash: BURN },
      { id: 'dddddddd-dddd-4ddd-dddd-dddddddddddd', step: 'mint', state: 'submitted', hash: MINT },
    ],
    proof: { nonce: `0x${'56'.repeat(32)}`, sourceTxHash: BURN, feeExecuted: '75', amountReceived: '999925' },
    destination: { state: 'included', balanceUnits: '9000000', receipt: { hash: MINT, blockNumber: '100', blockHash: BLOCK, status: 1, confirmationScope: 'rpc-block-inclusion' } },
  };
}
function completedRecord() {
  const value = record(); value.state = 'completed'; value.operations[1].state = 'included';
  value.destination.state = 'finalized';
  Object.assign(value.destination.receipt, { confirmationScope: 'rpc-finalized-block', finalizedBlockNumber: '110', finalizedBlockHash: FINALIZED });
  return value;
}
function fixture({ locale = 'en' } = {}) {
  const doc = { createElement(tag) { return new TinyNode(tag, this); } }, root = doc.createElement('section');
  const quote = { quoteId: QUOTE_ID, recipient: RECIPIENT, amountUnits: '1000000', minimumReceivedUnits: '999900', maxFeeUnits: '100', maxSourceGasFeeWei: '1000000000000000', maxDestinationGasFeeWei: '1000000000000000', availability: { requiredFeeUnits: '75', feeBps: '0.75' } };
  const preflight = { routeId: 'cctp-v2-sepolia-base-sepolia-usdc', available: true, source: { chainId: 11155111, genesis: `0x${'11'.repeat(32)}`, status: 'verified' }, destination: { chainId: 84532, genesis: `0x${'22'.repeat(32)}`, status: 'verified' }, canSign: false, approved: false, canRetry: false, targetReceived: false };
  const values = { preflight, quote, history: [record()], check: record() }, calls = [];
  const api = Object.fromEntries(Object.keys(values).map(method => [method, async input => { calls.push({ method, input: clone(input) }); return ok(values[method]); }]));
  for (const method of ['start', 'prepare', 'confirm', 'cancel']) api[method] = async input => { calls.push({ method, input: clone(input) }); throw new Error(`Display-only test must not call ${method}`); };
  const ui = mountCctpUI({ root, api, locale });
  const click = label => button(root, label).click();
  const select = async state => { const entry = buttons(root).find(node => node.textContent.startsWith(`${state} ·`)); assert.ok(entry, `Missing history record: ${state}`); await entry.click(); };
  return { root, ui, values, calls, click, select };
}

test('quote shows the actual protocol fee and basis-point rate separately from the maximum and minimum received', async () => {
  const h = fixture();
  try {
    await h.click('Review route and fees'); const view = details(h.root);
    assert.equal(view.get('Quoted protocol fee (USDC)'), '0.000075');
    assert.equal(view.get('Quoted fee rate (bps)'), '0.75');
    assert.equal(view.get('Maximum protocol fee (USDC)'), '0.0001');
    assert.equal(view.get('Minimum received (USDC)'), '0.9999');
    assert.deepEqual(h.calls.map(call => call.method), ['preflight', 'quote']);
    assert.ok(hasButton(h.root, 'Confirm route'));
  } finally { h.ui.dispose(); }
});

test('explicit zero fee and zero rate stay visible, while absent fee data is unknown rather than free', async () => {
  for (const available of [true, false]) {
    const h = fixture();
    try {
      h.values.quote.availability = available ? { requiredFeeUnits: '0', feeBps: '0' } : {};
      await h.click('Review route and fees'); const view = details(h.root);
      assert.equal(view.get('Quoted protocol fee (USDC)'), available ? '0' : '—');
      assert.equal(view.get('Quoted fee rate (bps)'), available ? '0' : '—');
      assert.equal(view.get('Maximum protocol fee (USDC)'), '0.0001');
    } finally { h.ui.dispose(); }
  }
});

test('an unknown original operation displays both its state and hash without a replacement prepare or send', async () => {
  const h = fixture();
  try {
    const pending = record(); pending.operations[1].state = 'unknown'; h.values.history = [pending];
    await h.click('Restore transfer history'); await h.select('mint-pending'); const view = details(h.root);
    assert.equal(view.get('Claim original test USDC status'), 'unknown');
    assert.equal(view.get('Claim original test USDC transaction'), MINT);
    assert.ok(!hasButton(h.root, 'Review next transaction'));
    assert.ok(!hasButton(h.root, 'Confirm and send this transaction'));
    assert.equal(button(h.root, 'Check original transfer').disabled, false);
    assert.deepEqual(h.calls, [{ method: 'history', input: undefined }]);
  } finally { h.ui.dispose(); }
});

test('a complete finalized history record displays its exact receipt and the same completion message as an explicit check', async () => {
  const restored = fixture(), checked = fixture(), completed = completedRecord();
  try {
    restored.values.history = [completed];
    await restored.click('Restore transfer history'); await restored.select('completed');
    assert.deepEqual(restored.calls, [{ method: 'history', input: undefined }], 'Selecting persisted history must not automatically query, prepare or send');
    assert.equal(status(restored.root), COMPLETED);
    const view = details(restored.root);
    for (const [label, value] of [
      ['Destination receipt state', 'finalized'], ['Receipt transaction', MINT], ['Receipt block', '100'], ['Receipt block hash', BLOCK],
      ['Confirmation scope', 'rpc-finalized-block'], ['Finalized block', '110'], ['Finalized block hash', FINALIZED],
      ['Attested protocol fee (USDC)', '0.000075'], ['Received in this transfer (USDC)', '0.999925'], ['Current target balance (USDC)', '9'],
    ]) assert.equal(view.get(label), value, label);
    assert.ok(!view.has('Attested claim amount (USDC)'));
    checked.values.check = completed;
    await checked.click('Restore transfer history'); await checked.select('mint-pending'); await checked.click('Check original transfer');
    assert.deepEqual(checked.calls, [{ method: 'history', input: undefined }, { method: 'check', input: ID }]);
    assert.equal(status(checked.root), status(restored.root));
    assert.deepEqual(details(checked.root), view);
  } finally { restored.ui.dispose(); checked.ui.dispose(); }
});

test('pending or included receipt and a large target balance never become confirmed per-transfer receipt', async () => {
  for (const destinationState of ['pending', 'included']) {
    const h = fixture();
    try {
      const pending = record(); pending.destination.state = destinationState; pending.destination.balanceUnits = '999999999000000';
      if (destinationState === 'pending') pending.destination.receipt = null;
      h.values.history = [pending]; h.values.check = pending;
      await h.click('Restore transfer history'); await h.select('mint-pending');
      const selectedStatus = status(h.root), view = details(h.root);
      assert.equal(view.get('Destination receipt state'), destinationState);
      assert.equal(view.get('Attested protocol fee (USDC)'), '0.000075');
      assert.equal(view.get('Attested claim amount (USDC)'), '0.999925');
      assert.equal(view.get('Current target balance (USDC)'), '999999999');
      assert.ok(!view.has('Received in this transfer (USDC)'));
      assert.notEqual(selectedStatus, COMPLETED);
      await h.click('Check original transfer');
      assert.equal(status(h.root), selectedStatus);
      assert.ok(!h.root.textContent.includes(COMPLETED));
      assert.ok(!details(h.root).has('Received in this transfer (USDC)'));
      assert.deepEqual(h.calls.map(call => call.method), ['history', 'check']);
    } finally { h.ui.dispose(); }
  }
});

test('completed label alone cannot claim receipt when the finality evidence is missing, failed or bound to another mint', async () => {
  const cases = [
    value => { value.destination.receipt = null; },
    value => { value.destination.receipt.hash = BURN; },
    value => { value.destination.receipt.status = 0; },
    value => { value.destination.receipt.confirmationScope = 'rpc-block-inclusion'; },
    value => { value.operations[1].hash = null; value.destination.receipt.hash = null; },
  ];
  for (const corrupt of cases) {
    const h = fixture();
    try {
      const incomplete = completedRecord(); corrupt(incomplete); h.values.history = [incomplete];
      await h.click('Restore transfer history'); await h.select('completed');
      assert.notEqual(status(h.root), COMPLETED);
      assert.ok(!details(h.root).has('Received in this transfer (USDC)'));
      assert.deepEqual(h.calls, [{ method: 'history', input: undefined }]);
    } finally { h.ui.dispose(); }
  }
});

test('Chinese fee precision distinguishes the current fee from its cap and an existing balance from this transfer', async () => {
  const h = fixture({ locale: 'zh-CN' });
  try {
    await h.click('查询路线与费用'); let view = details(h.root);
    assert.equal(view.get('本次查询协议费（USDC）'), '0.000075');
    assert.equal(view.get('本次查询费率（基点）'), '0.75');
    assert.equal(view.get('协议费用上限（USDC）'), '0.0001');
    await h.click('恢复交易记录'); await h.select('mint-pending'); view = details(h.root);
    assert.equal(view.get('证明中的领取金额（USDC）'), '0.999925');
    assert.equal(view.get('目标链当前余额（USDC）'), '9');
    assert.ok(!view.has('本笔到账（USDC）'));
    assert.ok(!h.root.textContent.includes('目标铸币已最终确认，到账凭据已核对。'));
    assert.deepEqual(h.calls.map(call => call.method), ['preflight', 'quote', 'history']);
  } finally { h.ui.dispose(); }
});
