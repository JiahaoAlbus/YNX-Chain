import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {mountCctpUI} from '../src/features/cross-chain/cctp-ui.mjs';

const dir = new URL('../src/renderer.js', import.meta.url);
const originalAccountFile = process.env.CROSS_ORIGINAL_ACCOUNT_RENDERER;
const renderer = await readFile(dir, 'utf8');
const accountRenderer = originalAccountFile ? await readFile(originalAccountFile, 'utf8') : renderer;
function slice(source, start, end) {
  const first = source.indexOf(start);
  const last = source.indexOf(end, first);
  assert.ok(first >= 0 && last > first);
  return source.slice(first, last);
}

class Element {
  constructor(tag, doc) {
    this.tag = tag; this.ownerDocument = doc; this.children = [];
    this.listeners = new Map(); this.open = false; this.value = '';
    this.disabled = false; this.text = ''; this.dataset = {};
  }
  set textContent(value) { this.text = String(value); this.children = []; }
  get textContent() { return this.text + this.children.map(child => child.textContent).join(''); }
  setAttribute() {}
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.text = ''; this.children = nodes; }
  addEventListener(name, handler) {
    const handlers = this.listeners.get(name) ?? [];
    handlers.push(handler); this.listeners.set(name, handlers);
  }
  async dispatch(name) { await Promise.all((this.listeners.get(name) ?? []).map(handler => handler({target: this}))); }
  showModal() { assert.equal(this.open, false); this.open = true; }
  close() { this.open = false; }
}

const noop = () => {};
const ok = value => ({ok: true, value});
const gate = () => {
  let resolve;
  const promise = new Promise(done => {resolve = done;});
  return {promise, resolve};
};
const flush = async () => {for (let i = 0; i < 20; i++) await Promise.resolve();};
const walk = node => [node, ...node.children.flatMap(walk)];
const idA = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
const idB = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
const accountA = '0x' + '11'.repeat(20);
const accountB = '0x' + '22'.repeat(20);
const makeRecord = (id, account, byte) => ({
  id, state: 'burn-pending', binding: {account, recipient: account, amountUnits: '1000000', sourceNetwork: {id:'sepolia'}},
  operations: [{id, step:'burn', state:'unknown', hash:'0x'+byte.repeat(32)}],
});
const a = makeRecord(idA, accountA, 'a1');
const b = makeRecord(idB, accountB, 'b2');

function setup(t) {
  const calls = [];
  const queued = [];
  const doc = {documentElement: {lang:'en'}, createElement(tag) {return new Element(tag, this);}};
  doc.body = doc.createElement('body');
  const selectors = new Map();
  doc.querySelector = name => {
    if (!selectors.has(name)) selectors.set(name, doc.createElement('node'));
    return selectors.get(name);
  };
  doc.querySelector('#open-multichain').parentElement = doc.body;
  doc.querySelectorAll = name => name === 'dialog[open]' ? walk(doc.body).filter(node => node.tag === 'dialog' && node.open) : [];
  const window = new Element('window', doc);
  window.ynxWallet = {
    crossChain: Object.fromEntries(['history','check','preflight','quote','start','prepare','confirm','cancel'].map(method => [method, input => {
      calls.push({method, input});
      if (method === 'history') {
        const next = queued.shift();
        assert.ok(next, 'unexpected history');
        return next.promise;
      }
      if (method === 'check') {
        assert.equal(input, idB);
        return ok(b);
      }
      assert.fail('Unexpected ' + method);
    }])),
    onCrossChainContextChanged: handler => window.onCrossContext = handler,
    onAccountStatus: handler => window.onAccount = handler,
    onSecurityState: handler => window.onSecurity = handler,
  };
  const variables = {
    document:doc, window, mountCctpUI, cctpUI:undefined, nativeAccountLabel: value => value,
    accountStatusObserved:false, accountState:null, activeAccount:accountA, accountViewRevision:0,
    keyState:{account:accountA, revision:1, locked:false}, accountSecurityIntent:0, securityViewRevision:0,
    pendingImportOperation:null, transferReview:null, desktopUI:null, desktopHistoryUI:null,
    nativePayProductUI:null, passwordUI:null, multichainUI:null, familyUI:null, ideIdentityUI:null, projectControlUI:null,
    transferReviewSummaryUI:null, accountDetail:{}, accountTitle:{}, accountShort:{}, signingShort:{}, createAccount:{}, addAccount:{}, accountList:doc.createElement('list'),
    transactionHistoryUI:{clear:noop, refresh:noop}, receiveCodeUI:{clear:noop}, receiveShareUI:{invalidate:noop},
    contractUI:{clear:noop}, aiTaskReviewObserver:{invalidate:noop}, approvalQueue:{clear:noop,suspend:noop},
    authorizationChoices:{clear:noop},
  };
  for (const name of ['clearAssetBalance','clearTransactionResolution','invalidateWalletConnectSessions','clearInvoiceInput',
    'invalidatePaymentInput','renderKeyDetail','showAccountError','presentApproval','refreshTransactions','reconcileAccountView',
    'copyUI','updateOriginalAdmissionSecurity','renderDeviceCreationStatus','refreshDeviceCreationStatus']) variables[name] = noop;
  const block = slice(renderer, 'const cctpDialog=document.createElement', 'const ideIdentityDialog=');
  const accountCode = slice(accountRenderer, 'function renderAccount(payload)', '\nfunction renderAccountSelectionControls');
  const keyCode = slice(renderer, 'function renderKeyState(state)', '\npasswordUI = createPasswordVaultUI');
  const accountRegistration = renderer.match(/^window\.ynxWallet\.onAccountStatus\(renderAccount\);$/m);
  const keyRegistration = renderer.match(/^window\.ynxWallet\.onSecurityState\?\.\(renderKeyState\);$/m);
  assert.ok(accountRegistration && keyRegistration);
  const entry = runInNewContext([block, accountCode, keyCode, accountRegistration[0], keyRegistration[0],
    '({cctpDialog,cctpOpen,cctpClose,cctpRoot,cctpUI})'].join('\n'), variables);
  t.after(() => entry.cctpUI.dispose());
  return {...entry, window, calls, nextHistory() {const response=gate(); queued.push(response); return response;}};
}

const has = (h, label) => walk(h.cctpRoot).some(node => node.tag === 'button' && node.textContent === label);
async function click(h, label) {
  const button = walk(h.cctpRoot).find(node => node.tag === 'button' && node.textContent === label);
  assert.ok(button && !button.disabled);
  await button.dispatch('click');
}

test('normal Wallet first open performs one history read and fences quotes until it returns', async t => {
  const h = setup(t);
  const first = h.nextHistory();
  await h.cctpOpen.dispatch('click');
  await h.cctpOpen.dispatch('click');
  assert.equal(h.cctpDialog.open, true);
  assert.equal(has(h, 'Review route and fees'), false);
  assert.deepEqual(h.calls, [{method:'history', input:undefined}]);
  first.resolve(ok([])); await flush();
  assert.equal(has(h, 'Review route and fees'), true);
});

test('normal Wallet account error retires the pending first-open history', async t => {
  const h = setup(t);
  const old = h.nextHistory();
  await h.cctpOpen.dispatch('click');
  h.window.onAccount({ok:false,error:{code:'READ_FAILED'}});
  old.resolve(ok([a])); await flush();
  assert.ok(!h.cctpRoot.textContent.includes(a.operations[0].hash));
  assert.equal(has(h, 'Check original transfer'), false);
  assert.equal(has(h, 'Review route and fees'), false);
});

test('normal Wallet switch restores the second account and queries only its original UNKNOWN', async t => {
  const h = setup(t);
  const old = h.nextHistory();
  await h.cctpOpen.dispatch('click');
  h.window.onAccount({ok:true,value:{account:accountB}});
  const fresh = h.nextHistory();
  const restored = click(h, 'Restore transfer history');
  fresh.resolve(ok([b])); await restored;
  old.resolve(ok([a])); await flush();
  assert.ok(h.cctpRoot.textContent.includes(b.operations[0].hash));
  assert.ok(!h.cctpRoot.textContent.includes(a.operations[0].hash));
  await click(h, 'Check original transfer');
  assert.deepEqual(h.calls.map(value => value.method), ['history','history','check']);
  assert.equal(h.calls.at(-1).input, idB);
  assert.equal(has(h, 'Review route and fees'), false);
  assert.equal(has(h, 'Review next transaction'), false);
});

test('normal Wallet lock closes Cross and a delayed close event cannot cancel reopened history', async t => {
  const h = setup(t);
  const old = h.nextHistory();
  await h.cctpOpen.dispatch('click');
  h.window.onSecurity({account:accountA,revision:2,locked:true});
  assert.equal(h.cctpDialog.open, false);
  const fresh = h.nextHistory();
  await h.cctpOpen.dispatch('click');
  await h.cctpDialog.dispatch('close');
  fresh.resolve(ok([b])); await flush();
  old.resolve(ok([a])); await flush();
  assert.ok(h.cctpRoot.textContent.includes(b.operations[0].hash));
  assert.ok(!h.cctpRoot.textContent.includes(a.operations[0].hash));
  assert.equal(has(h, 'Review route and fees'), false);
});

for (const kind of ['button','cancel','close']) test('normal Wallet '+kind+' close retires old history before reopen', async t => {
  const h = setup(t);
  const old = h.nextHistory();
  await h.cctpOpen.dispatch('click');
  if (kind === 'button') await h.cctpClose.dispatch('click');
  else {
    if (kind === 'cancel') await h.cctpDialog.dispatch('cancel');
    h.cctpDialog.close();
    await h.cctpDialog.dispatch('close');
  }
  const fresh = h.nextHistory();
  await h.cctpOpen.dispatch('click');
  fresh.resolve(ok([b])); await flush();
  old.resolve(ok([a])); await flush();
  assert.ok(h.cctpRoot.textContent.includes(b.operations[0].hash));
  assert.ok(!h.cctpRoot.textContent.includes(a.operations[0].hash));
  assert.deepEqual(h.calls.map(value => value.method), ['history','history']);
});
