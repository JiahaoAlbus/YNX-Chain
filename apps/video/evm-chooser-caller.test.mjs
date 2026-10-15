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
  return {uuid, account, kind, events, calls, entered, restoring, interactiveGate: null, restoreGate: null,
    async request({method}) {
      calls.push(method);
      if (method === 'eth_requestAccounts') {entered.resolve();return this.interactiveGate ? this.interactiveGate.promise : [account];}
      if (method === 'eth_accounts') {restoring.resolve();return this.restoreGate ? this.restoreGate.promise : [account];}
      if (method === 'eth_chainId') return YNX_TESTNET.evmChainHex;
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
    replaceChildren() {this.children = [];}, append(item) {this.children.push(item);}, setAttribute() {}, showModal() {this.open = true;}, close() {this.open = false;this.closes = (this.closes || 0) + 1;}});return nodes.get(selector);};
  const productState = {status: 'connected', session: {account: 'separate-video-owner'}};
  const context = vm.createContext({Error, window: browser, sessionStorage, savedWalletStateKey: savedKey, currentWallet: null, walletRevision: 0,
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

function row(h, entry) {return h.node('#wallet-choices').children.find(item => item.dataset.walletId === entry.uuid);}
function cancel(h, kind) {
  const chooser = h.node('#wallet-chooser');
  if (kind === 'close') h.node('#wallet-chooser-close').onclick();
  else {const event = {defaultPrevented: false, preventDefault() {this.defaultPrevented = true;}};chooser.oncancel?.(event);if (!event.defaultPrevented && chooser.open) chooser.close();}
}

for (const kind of ['close', 'escape']) test(`old chooser row cannot start provider approval after current ${kind}`, async () => {
  const h = harness();await h.signin();const old = row(h, h.b);cancel(h, kind);const before = h.node('#signin').disabled;await old.onclick();
  assert.equal(h.b.calls.length, 0);assert.equal(h.a.calls.length, 0);assert.equal(h.context.currentWallet, null);assert.equal(h.saved(), null);assert.equal(h.node('#signin').disabled, before);assert.equal(h.notices.length, 0);assert.equal(h.node('#wallet-chooser').open, false);h.assertSeparate();
});

test('reset/revoke closes its chooser and old row cannot reconnect original provider', async () => {
  const h = harness();await h.signin();const old = row(h, h.a);await h.revoke();const closed = h.node('#wallet-chooser').open;await old.onclick();
  assert.equal(closed, false);assert.equal(h.a.calls.length, 0);assert.equal(h.b.calls.length, 0);assert.equal(h.context.currentWallet, null);assert.equal(h.notices.length, 0);h.assertSeparate();
});

test('old row from prior discovery cannot close newer chooser or send provider requests', async () => {
  const h = harness();await h.signin();const old = row(h, h.b);await h.signin();const closes = h.node('#wallet-chooser').closes || 0;await old.onclick();
  assert.equal(h.node('#wallet-chooser').open, true);assert.equal(h.node('#wallet-chooser').closes || 0, closes);assert.equal(h.a.calls.length, 0);assert.equal(h.b.calls.length, 0);assert.equal(h.context.currentWallet, null);h.assertSeparate();
});

test('old close and captured cancel callbacks cannot close a newer chooser generation', async () => {
  const h = harness();await h.signin();const oldClose = h.node('#wallet-chooser-close').onclick, oldCancel = h.node('#wallet-chooser').oncancel;await h.signin();const closes = h.node('#wallet-chooser').closes || 0;oldClose();const event = {defaultPrevented: false, preventDefault() {this.defaultPrevented = true;}};oldCancel?.(event);if (oldCancel && !event.defaultPrevented && h.node('#wallet-chooser').open) h.node('#wallet-chooser').close();if (oldCancel) assert.equal(event.defaultPrevented, true);
  assert.equal(h.node('#wallet-chooser').open, true);assert.equal(h.node('#wallet-chooser').closes || 0, closes);assert.equal(h.a.calls.length, 0);assert.equal(h.b.calls.length, 0);h.assertSeparate();
});

test('captured old row cannot replace a newer pending request or release its busy/cache ownership', async () => {
  const h = harness();await h.signin();const old = row(h, h.a);h.b.interactiveGate = deferred();const current = h.connect(h.b);await h.b.entered.promise;await old.onclick();const busy = h.node('#signin').disabled, provisional = h.context.currentWallet;h.b.interactiveGate.resolve([accountB]);await current;
  assert.equal(h.a.calls.length, 0);assert.equal(busy, true);assert.equal(provisional, null);assert.equal(h.context.currentWallet.walletId, h.b.uuid);assert.equal(h.saved().account, accountB);assert.equal(h.notices.length, 1);h.assertSeparate();
});

for (const kind of ['close', 'escape']) test(`current ${kind} preserves existing connection/profile and keeps its provider events current`, async () => {
  const h = harness();await h.connect(h.a);await h.signin();const beforeCalls = h.a.calls.length;cancel(h, kind);
  assert.equal(h.context.currentWallet.walletId, h.a.uuid);assert.equal(h.saved().account, accountA);assert.equal(h.a.calls.length, beforeCalls);assert.equal(h.b.calls.length, 0);
  h.a.emit('accountsChanged', [accountC]);assert.equal(h.context.currentWallet.account, accountC);assert.equal(h.saved().account, accountC);assert.equal(h.a.events.get('accountsChanged').size, 1);assert.equal(h.a.events.get('disconnect').size, 1);assert.equal(h.node('#wallet-chooser').open, false);h.assertSeparate();
});

test('current legal chooser row retains explicit ambiguity choice and real standard SDK connection', async () => {
  const h = harness();await h.signin();assert.equal(h.node('#wallet-choices').children.length, 2);assert.equal(h.node('#wallet-chooser').open, true);await row(h, h.b).onclick();
  assert.equal(h.context.currentWallet.walletId, h.b.uuid);assert.equal(h.context.currentWallet.standardConnection, 'CONNECTED');assert.equal(h.context.currentWallet.productSession, 'PRIVATE_SERVICE_DEGRADED');assert.equal(h.node('#wallet-chooser').open, false);assert.equal(h.a.calls.length, 0);assert.equal(h.b.calls[0], 'eth_requestAccounts');assert.equal(h.saved().account, accountB);h.assertSeparate();
});
