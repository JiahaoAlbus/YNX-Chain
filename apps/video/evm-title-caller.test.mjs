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
function harness(options = {}) {
  const a = provider('provider-a', accountA, 'ynx'), b = provider('provider-b', accountB, 'metamask');
  const c = provider('provider-c', accountC, 'generic');b.icon = options.icon;const entries = [a, b, c];const discovered = [];
  const browser = new EventTarget();
  browser.addEventListener('eip6963:requestProvider', () => {
    for (const entry of entries) browser.dispatchEvent(new CustomEvent('eip6963:announceProvider', {detail: {
      info: {uuid: entry.uuid, name: entry.kind === 'ynx' ? 'YNX Wallet' : entry.kind === 'metamask' ? 'MetaMask' : (options.name ?? 'Generic Wallet'), rdns: entry.kind === 'ynx' ? 'com.ynx.wallet' : entry.kind === 'metamask' ? 'io.metamask' : 'org.generic', icon: entry.icon}, provider: entry}}));
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
    discoverWalletCandidates: async (window, options) => {const result = await discoverWalletCandidates(window, {...options, timeoutMs: 1});discovered.push(result);return result;},
    $: node, document: {createElement: () => ({dataset: {}, attributes: {}, setAttribute(name, value) {this.attributes[name] = String(value);}})}, notice: (...args) => notices.push(args)});
  vm.runInContext(slice('function esc(', '\nfunction empty(') + '\n' + slice('const storageState =', '\nfunction clearLegacySession') + '\n' +
    slice('function showInstallOptions(', '\nlet siteAccountBusy') + '\n' +
    slice('function renderWalletChoices(', '\nfunction startWatchProgress') + '\n' +
    slice('$("#signin").onclick = async', '\nasync function changeSiteAccount'), context);
  return {a, b, c, discovered, context, notices, node, values, sessionStorage,
    connect: entry => {context.selectedId = entry.uuid;return vm.runInContext('connectVideoWalletInteractive(selectedId)', context);},
    restore: () => vm.runInContext('restoreWalletFromSession()', context),
    revoke: () => node('#revoke').onclick(), signin: () => node('#signin').onclick(),
    saved: () => JSON.parse(sessionStorage.getItem(savedKey) || 'null'),
    assertSeparate() {assert.equal(context.productState, productState);assert.equal(values.get('ynx.video.pending-mutations.v1'), 'original durable fence');assert.ok([...a.calls, ...b.calls, ...c.calls].every(method => ['eth_requestAccounts', 'eth_accounts', 'eth_chainId'].includes(method)));}};
}

function row(h, entry) {return h.node('#wallet-choices').children.find(item => item.dataset.walletId === entry.uuid);}
function actualLabel(h, entry) {return h.discovered.at(-1).find(candidate => candidate.info.uuid === entry.uuid).label;}
function visibleLabel(item) {
  const encoded = item.innerHTML.match(/<\/span><span>(.*?)<\/span>$/s)?.[1];assert.notEqual(encoded, undefined);assert.doesNotMatch(encoded, /[<>]/);
  return encoded.replace(/&(amp|lt|gt|quot|#39);/g, (_, name) => ({amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'"}[name]));
}
function assertGenericLabel(h) {
  const label = actualLabel(h, h.c), item = row(h, h.c);
  assert.equal(item.attributes.title, `${label} · EIP-1193`, 'DOM attribute setter must receive actual SDK label text');assert.equal(visibleLabel(item), label);assert.equal(item.dataset.walletBrand, 'EIP-1193');assert.doesNotMatch(item.innerHTML, /<img/);
}
for (const name of ['R&D &amp; research', 'Wallet "double" and \'single\'', '  Tools <alpha> & "beta"  ']) test(`normal discovery title and visible label retain SDK text: ${name}`, async () => {
  const h = harness({name});await h.signin();assert.equal(actualLabel(h, h.c), name.trim());assertGenericLabel(h);assert.equal(h.c.calls.length, 0);h.assertSeparate();
});
test('plain generic wallet title remains literal and visible without an image', async () => {
  const h = harness();await h.signin();assertGenericLabel(h);assert.equal(row(h, h.c).attributes.title, 'Generic Wallet · EIP-1193');h.assertSeparate();
});
test('default YNX and MetaMask labels/logos and escaped provider icon remain supplied', async () => {
  const h = harness({icon: 'data:image/png;fixture,"<&>'});await h.signin();assert.equal(row(h, h.a).attributes.title, 'YNX Wallet · YNX Wallet');assert.equal(row(h, h.b).attributes.title, 'MetaMask · MetaMask');assert.equal(visibleLabel(row(h, h.a)), 'YNX Wallet · YNX Wallet');assert.equal(visibleLabel(row(h, h.b)), 'MetaMask · MetaMask');assert.match(row(h, h.a).innerHTML, /<img src="/);assert.match(row(h, h.b).innerHTML, /src="data:image\/png;fixture,&quot;&lt;&amp;&gt;"/);h.assertSeparate();
});
test('current generic label row connects once through real SDK and retains normalized profile', async () => {
  const h = harness({name: 'Wallet <A> & "B"'});await h.signin();const selected = row(h, h.c);await selected.onclick();await selected.onclick();assert.equal(h.c.calls.filter(x => x === 'eth_requestAccounts').length, 1);assert.equal(h.a.calls.length, 0);assert.equal(h.b.calls.length, 0);assert.equal(h.context.currentWallet.walletId, h.c.uuid);assert.equal(h.saved().account, accountC);assert.equal(h.context.currentWallet.standardConnection, 'CONNECTED');h.assertSeparate();
});
for (const mode of ['close', 'cancel']) test(`retained generic title row cannot approve after current ${mode}`, async () => {
  const h = harness({name: 'Wallet & <A>'});await h.signin();const old = row(h, h.c);
  if (mode === 'close') h.node('#wallet-chooser-close').onclick();else {let prevented = false;h.node('#wallet-chooser').oncancel({preventDefault() {prevented = true;}});assert.equal(prevented, true);}
  await old.onclick();assert.equal(h.c.calls.length, 0);assert.equal(h.context.currentWallet, null);assert.equal(h.saved(), null);assert.equal(h.node('#wallet-chooser').open, false);h.assertSeparate();
});
test('old generic row cannot close a newer chooser or request accounts', async () => {
  const h = harness({name: 'Wallet & <A>'});await h.signin();const old = row(h, h.c);await h.signin();await old.onclick();assert.equal(h.node('#wallet-chooser').open, true);assert.equal(h.c.calls.length, 0);h.assertSeparate();
});
test('old cancel callback preserves newer normalized title and chooser ownership', async () => {
  const h = harness({name: 'Wallet & <A>'});await h.signin();const old = h.node('#wallet-chooser').oncancel;await h.signin();let prevented = false;old({preventDefault() {prevented = true;}});assert.equal(prevented, true);assert.equal(h.node('#wallet-chooser').open, true);assertGenericLabel(h);assert.equal(h.c.calls.length, 0);h.assertSeparate();
});
