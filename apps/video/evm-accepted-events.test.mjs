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
      if (method === 'eth_requestAccounts') {entered.resolve();return this.interactiveGate ? this.interactiveGate.promise : [this.account];}
      if (method === 'eth_accounts') {restoring.resolve();return this.restoreGate ? this.restoreGate.promise : [this.account];}
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

function row(h, entry) {return h.node('#wallet-choices').children.find(item => item.dataset.walletId === entry.uuid);}
async function opening(h, phase) {const pending = h.signin();if (phase === 'chooser') await pending;return {pending};}

for (const phase of ['discovery', 'chooser']) test(`accepted provider account change during ${phase} remains authoritative through cancel`, async () => {
  const h = harness();await h.connect(h.a);const calls = h.a.calls.length;const {pending} = await opening(h, phase);h.a.account = accountC;h.a.emit('accountsChanged', [accountC]);await pending;
  const observed = h.context.currentWallet.account;h.node('#wallet-chooser-close').onclick();assert.equal(observed, accountC);assert.equal(h.context.currentWallet.account, accountC);assert.equal(h.saved().account, accountC);assert.equal(h.context.currentWallet.walletId, h.a.uuid);assert.equal(h.a.calls.length, calls);assert.equal(h.b.calls.length, 0);assert.equal(h.a.events.get('accountsChanged').size, 1);h.assertSeparate();
});

for (const phase of ['discovery', 'chooser']) for (const event of ['disconnect', 'empty-accounts']) test(`accepted provider ${event} during ${phase} clears connection and retires old choice`, async () => {
  const h = harness();await h.connect(h.a);const {pending} = await opening(h, phase);const old = row(h, h.b);
  if (event === 'disconnect') h.a.emit('disconnect');else h.a.emit('accountsChanged', []);await pending;
  if (old) await old.onclick();assert.equal(h.context.currentWallet, null);assert.equal(h.saved(), null);assert.equal(!!h.node('#wallet-chooser').open, false);assert.equal(h.b.calls.length, 0);assert.equal(h.a.events.get('disconnect').size, 0);h.assertSeparate();
});

for (const phase of ['discovery', 'chooser']) for (const chain of [YNX_TESTNET.evmChainHex, '0x1']) test(`accepted chain ${chain} during ${phase} is still handled by current provider`, async () => {
  const h = harness();await h.connect(h.a);const {pending} = await opening(h, phase);h.node('#session').textContent = 'waiting selection';h.a.emit('chainChanged', chain);await pending;const message = h.node('#session').textContent;
  h.node('#wallet-chooser-close').onclick();assert.match(message, chain === '0x1' ? /chain changed away/ : /switched back/);assert.equal(h.context.currentWallet.walletId, h.a.uuid);assert.equal(h.saved().account, accountA);assert.equal(h.saved().chainId, YNX_TESTNET.evmChainHex);assert.equal(h.b.calls.length, 0);h.assertSeparate();
});

test('after real explicit B request starts old A queued events cannot reset B busy/cache ownership', async () => {
  const h = harness();await h.connect(h.a);const accounts = h.a.queued('accountsChanged'), chain = h.a.queued('chainChanged'), disconnect = h.a.queued('disconnect');await h.signin();h.b.interactiveGate = deferred();const current = row(h, h.b).onclick();await h.b.entered.promise;
  for (const callback of accounts) callback([]);for (const callback of chain) callback('0x1');for (const callback of disconnect) callback();const busy = h.node('#signin').disabled;const before = h.saved();h.b.interactiveGate.resolve([accountB]);await current;
  assert.equal(busy, true);assert.equal(before.account, accountA);assert.equal(h.context.currentWallet.walletId, h.b.uuid);assert.equal(h.saved().account, accountB);assert.equal(h.node('#signin').disabled, false);
  for (const callback of accounts) callback([accountC]);for (const callback of disconnect) callback();assert.equal(h.saved().account, accountB);assert.equal(h.a.events.get('disconnect').size, 0);assert.equal(h.b.events.get('disconnect').size, 1);h.assertSeparate();
});

test('normal chooser choice after current account event still uses selected real standard provider', async () => {
  const h = harness();await h.connect(h.a);await h.signin();h.a.account = accountC;h.a.emit('accountsChanged', [accountC]);await row(h, h.b).onclick();assert.equal(h.context.currentWallet.walletId, h.b.uuid);assert.equal(h.saved().account, accountB);assert.equal(h.context.currentWallet.standardConnection, 'CONNECTED');assert.equal(h.context.currentWallet.productSession, 'PRIVATE_SERVICE_DEGRADED');assert.equal(h.a.events.get('disconnect').size, 0);assert.equal(h.b.events.get('disconnect').size, 1);h.assertSeparate();
});
