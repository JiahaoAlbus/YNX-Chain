import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {connectVideoWallet, restoreVideoWallet, discoverWalletCandidates, walletChoiceNeedsResolution, walletCandidatesFromError, WALLET_INSTALLATION_OPTIONS} from './wallet-connection.js';
import {YNX_TESTNET} from './ynx-dapp-connect-sdk/constants.js';
const source = await readFile(process.env.YNX_VIDEO_APP_SOURCE || new URL('./app.js', import.meta.url), 'utf8');
const slice = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
const deferred = () => {let resolve, reject;const promise = new Promise((yes, no) => {resolve = yes;reject = no;});return {promise, resolve, reject};};
const accountA = '0x' + '1'.repeat(40), accountB = '0x' + '2'.repeat(40), accountC = '0x' + '3'.repeat(40);
const savedKey = 'ynx.video.walletState';
function provider(uuid, account, kind) {
  const events = new Map(), calls = [], entered = deferred(), restoring = deferred();
  return {uuid, account, kind, chainId: YNX_TESTNET.evmChainHex, events, calls, entered, restoring, interactiveGate: null, restoreGate: null,
    async request({method}) {
      calls.push(method);
      if (method === 'eth_requestAccounts') {entered.resolve();return this.interactiveGate ? this.interactiveGate.promise : [this.account];}
      if (method === 'eth_accounts') {restoring.resolve();return this.restoreGate ? this.restoreGate.promise : [this.account];}
      if (method === 'eth_chainId') return this.chainId;
      assert.fail('fixture permits only standard accounts/chain reads, never signing/send/switch/add or real provider');
    },
    on(name, callback) {if (!events.has(name)) events.set(name, new Set());events.get(name).add(callback);},
    removeListener(name, callback) {events.get(name)?.delete(callback);},
    emit(name, value) {for (const callback of [...(events.get(name) || [])]) callback(value);},
    queued(name) {return [...(events.get(name) || [])];},
  };
}
function harness() {
  const a = provider('provider-a', accountA, 'ynx'), b = provider('provider-b', accountB, 'metamask');
  const browser = new EventTarget();
  browser.addEventListener('eip6963:requestProvider', () => {
    for (const entry of [a, b]) browser.dispatchEvent(new CustomEvent('eip6963:announceProvider', {detail: {
      info: {uuid: entry.uuid, name: entry.kind === 'ynx' ? 'YNX Wallet' : 'MetaMask', rdns: entry.kind === 'ynx' ? 'com.ynx.wallet' : 'io.metamask'}, provider: entry}}));
  });
  const values = new Map([['ynx.video.pending-mutations.v1', 'original durable fence']]);
  const sessionStorage = {getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key)};
  const notices = [], nodes = new Map();
  const node = selector => {if (!nodes.has(selector)) nodes.set(selector, {textContent: '', disabled: false, hidden: false, children: [], classList: {add() {}, remove() {}},
    replaceChildren() {this.children = [];}, append(item) {this.children.push(item);}, setAttribute() {}, showModal() {this.open = true;}, close() {this.open = false;}});return nodes.get(selector);};
  const productState = {status: 'connected', session: {account: 'separate-video-owner'}};
  const context = vm.createContext({Error, window: browser, sessionStorage, savedWalletStateKey: savedKey, currentWallet: null, walletRevision: 0, walletConnectionRevision: 0,
    unsubscribeEvents: [], productState, YNX_TESTNET, WALLET_INSTALLATION_OPTIONS, walletChoiceNeedsResolution, walletCandidatesFromError,
    // Override discovery deadlines only; actual SDK/provider result construction is unchanged.
    connectVideoWallet: (window, options) => connectVideoWallet(window, {...options, timeoutMs: 1}),
    restoreVideoWallet: (state, window) => restoreVideoWallet(state, window, {timeoutMs: 1, requestTimeoutMs: 1000}),
    discoverWalletCandidates: (window, options) => discoverWalletCandidates(window, {...options, timeoutMs: 1}),
    $: node, esc: value => value, document: {createElement: () => ({dataset: {}, setAttribute() {}})}, notice: (...args) => notices.push(args)});
  vm.runInContext(slice('const storageState =', '\nfunction clearLegacySession') + '\n' +
    slice('function showInstallOptions(', '\nlet siteAccountBusy') + '\n' +
    slice('function renderWalletChoices(', '\nfunction startWatchProgress') + '\n' +
    slice('$("#signin").onclick = async', '\nasync function changeSiteAccount'), context);
  return {a, b, context, notices, node, values, sessionStorage,
    connect: entry => {context.selectedId = entry.uuid;return vm.runInContext('connectVideoWalletInteractive(selectedId)', context);},
    restore: () => vm.runInContext('restoreWalletFromSession()', context),
    revoke: () => node('#revoke').onclick(), signin: () => node('#signin').onclick(),
    saved: () => JSON.parse(sessionStorage.getItem(savedKey) || 'null'),
    assertSeparate() {assert.equal(context.productState, productState);assert.equal(values.get('ynx.video.pending-mutations.v1'), 'original durable fence');assert.ok([...a.calls, ...b.calls].every(method => ['eth_requestAccounts', 'eth_accounts', 'eth_chainId'].includes(method)));}};
}

function chain(h, entry, chainId) {entry.chainId = chainId;entry.emit('chainChanged', chainId);}

test('accepted wrong-network event updates actual memory/cache and redraw does not claim YNX Testnet', async () => {
  const h = harness();await h.connect(h.a);const listeners = h.a.events.get('chainChanged').size;chain(h, h.a, '0x1');const actual = await h.a.request({method: 'eth_chainId'});
  assert.equal(actual, '0x1');assert.equal(h.context.currentWallet.chainId, actual);assert.equal(h.saved().chainId, actual);assert.equal(h.context.currentWallet.account, accountA);assert.equal(h.context.currentWallet.walletId, h.a.uuid);assert.match(h.node('#session').textContent, /0x1/);
  vm.runInContext('renderWalletState(currentWallet)', h.context);assert.match(h.node('#session').textContent, /network \(0x1\)/);assert.doesNotMatch(h.node('#session').textContent, /on YNX Testnet/);assert.equal(h.a.events.get('chainChanged').size, listeners);h.assertSeparate();
});

test('correct to wrong to correct network retains current provider/account and restores truthful YNX display', async () => {
  const h = harness();await h.connect(h.a);chain(h, h.a, '0x1');const wrong = {memory: h.context.currentWallet.chainId, saved: h.saved().chainId};chain(h, h.a, YNX_TESTNET.evmChainHex);
  assert.deepEqual(wrong, {memory: '0x1', saved: '0x1'});assert.equal(h.context.currentWallet.chainId, await h.a.request({method: 'eth_chainId'}));assert.equal(h.saved().chainId, YNX_TESTNET.evmChainHex);assert.equal(h.saved().account, accountA);assert.match(h.node('#session').textContent, /switched back/);
  vm.runInContext('renderWalletState(currentWallet)', h.context);assert.match(h.node('#session').textContent, /on YNX Testnet \(0x1917\)/);assert.equal(h.a.events.get('disconnect').size, 1);h.assertSeparate();
});

for (const phase of ['discovery', 'chooser']) test(`current actual wrong chain during ${phase} remains consistent after cancel`, async () => {
  const h = harness();await h.connect(h.a);const pending = h.signin();if (phase === 'chooser') await pending;chain(h, h.a, '0x1');await pending;h.node('#wallet-chooser-close').onclick();
  assert.equal(h.context.currentWallet.chainId, await h.a.request({method: 'eth_chainId'}));assert.equal(h.saved().chainId, '0x1');assert.equal(h.saved().account, accountA);assert.equal(h.a.events.get('chainChanged').size, 1);assert.equal(h.b.calls.length, 0);assert.equal(h.node('#wallet-chooser').open, false);h.assertSeparate();
});

test('old A late chain event cannot overwrite accepted B actual chain/display/cache', async () => {
  const h = harness();await h.connect(h.a);const old = h.a.queued('chainChanged');await h.connect(h.b);const message = h.node('#session').textContent;h.a.chainId = '0x1';for (const callback of old) callback('0x1');
  assert.equal(h.context.currentWallet.walletId, h.b.uuid);assert.equal(h.saved().chainId, await h.b.request({method: 'eth_chainId'}));assert.equal(h.saved().account, accountB);assert.equal(h.node('#session').textContent, message);assert.equal(h.a.events.get('chainChanged').size, 0);h.assertSeparate();
});

test('read-only restore on actual wrong fixture chain does not connect or request approval/switch/sign', async () => {
  const h = harness();h.a.chainId = '0x1';h.sessionStorage.setItem(savedKey, JSON.stringify({walletId: h.a.uuid, account: accountA, chainId: '0x1'}));await h.restore();
  assert.equal(h.context.currentWallet, null);assert.deepEqual(h.a.calls, ['eth_accounts', 'eth_chainId']);assert.equal(h.b.calls.length, 0);assert.equal(h.saved().chainId, '0x1');assert.equal(h.saved().account, accountA);assert.doesNotMatch(h.node('#session').textContent, /Connected to .* on YNX Testnet/);h.assertSeparate();
});

test('read-only current YNX fixture restore still connects normally without approval/switch/sign', async () => {
  const h = harness();h.sessionStorage.setItem(savedKey, JSON.stringify({walletId: h.a.uuid, account: accountA, chainId: YNX_TESTNET.evmChainHex}));await h.restore();assert.equal(h.context.currentWallet.chainId, await h.a.request({method: 'eth_chainId'}));assert.equal(h.saved().chainId, YNX_TESTNET.evmChainHex);assert.match(h.node('#session').textContent, /on YNX Testnet/);assert.ok(h.a.calls.every(method => ['eth_accounts', 'eth_chainId'].includes(method)));h.assertSeparate();
});
