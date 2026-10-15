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
  const c = provider('provider-c', accountC, 'generic');b.icon = options.icon;const entries = options.generic ? [a, b, c] : [a, b];
  const browser = new EventTarget();
  browser.addEventListener('eip6963:requestProvider', () => {
    for (const entry of entries) browser.dispatchEvent(new CustomEvent('eip6963:announceProvider', {detail: {
      info: {uuid: entry.uuid, name: entry.kind === 'ynx' ? 'YNX Wallet' : entry.kind === 'metamask' ? 'MetaMask' : 'Generic Wallet', rdns: entry.kind === 'ynx' ? 'com.ynx.wallet' : entry.kind === 'metamask' ? 'io.metamask' : 'org.generic', icon: entry.icon}, provider: entry}}));
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
    $: node, document: {createElement: () => ({dataset: {}, setAttribute() {}})}, notice: (...args) => notices.push(args)});
  vm.runInContext(slice('function esc(', '\nfunction empty(') + '\n' + slice('const storageState =', '\nfunction clearLegacySession') + '\n' +
    slice('function showInstallOptions(', '\nlet siteAccountBusy') + '\n' +
    slice('function renderWalletChoices(', '\nfunction startWatchProgress') + '\n' +
    slice('$("#signin").onclick = async', '\nasync function changeSiteAccount'), context);
  return {a, b, c, context, notices, node, values, sessionStorage,
    connect: entry => {context.selectedId = entry.uuid;return vm.runInContext('connectVideoWalletInteractive(selectedId)', context);},
    restore: () => vm.runInContext('restoreWalletFromSession()', context),
    revoke: () => node('#revoke').onclick(), signin: () => node('#signin').onclick(),
    saved: () => JSON.parse(sessionStorage.getItem(savedKey) || 'null'),
    assertSeparate() {assert.equal(context.productState, productState);assert.equal(values.get('ynx.video.pending-mutations.v1'), 'original durable fence');assert.ok([...a.calls, ...b.calls, ...c.calls].every(method => ['eth_requestAccounts', 'eth_accounts', 'eth_chainId'].includes(method)));}};
}

function row(h, entry) {return h.node('#wallet-choices').children.find(item => item.dataset.walletId === entry.uuid);}
function serializedSource(item) {
  // Observe the actual renderer's HTML string, not browser parsing or execution.
  const img = item.innerHTML.match(/<span class="wallet-choice-logo [^"]*" aria-hidden="true">(.*?)<\/span>/s)?.[1];
  assert.ok(img, 'expected supplied/default image in real render output');
  const attribute = img.match(/^<img src="([^"]*)" alt="([^"]*)" \/>$/s);
  assert.ok(attribute, 'image source must remain exactly one double-quoted attribute');
  assert.doesNotMatch(attribute[1], /[<>]/);
  return attribute[1].replace(/&(amp|lt|gt|quot|#39);/g, (_, name) => ({amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'"}[name]));
}
for (const mime of ['svg+xml', 'png', 'webp']) test(`actual discovered ${mime} icon preserves quotes, brackets and ampersand as one source attribute`, async () => {
  const icon = `data:image/${mime};fixture," title="fixture<&>' &quot;`;
  const h = harness({icon});await h.signin();assert.equal(h.node('#wallet-chooser').open, true);
  assert.equal(serializedSource(row(h, h.b)), icon);assert.equal(h.b.calls.length, 0);h.assertSeparate();
});
test('ordinary provider PNG data icon retains its exact value', async () => {
  const icon = 'data:image/png;base64,aGVsbG8=';const h = harness({icon});await h.signin();assert.equal(serializedSource(row(h, h.b)), icon);h.assertSeparate();
});
test('normal YNX and MetaMask default logos and generic no-icon rows remain supplied', async () => {
  const h = harness({generic: true});await h.signin();assert.equal(h.node('#wallet-choices').children.length, 3);assert.match(serializedSource(row(h, h.a)), /^(?:data:image\/|\/|https:)/);assert.match(serializedSource(row(h, h.b)), /^data:image\/svg\+xml[,;]/);assert.doesNotMatch(row(h, h.c).innerHTML, /<img/);assert.match(row(h, h.c).innerHTML, /Generic Wallet/);h.assertSeparate();
});
test('current normal chooser row makes exactly one standard approval request even if retained handler is repeated', async () => {
  const h = harness({icon: 'data:image/png;fixture,"<&>'});await h.signin();const selected = row(h, h.b);await selected.onclick();await selected.onclick();assert.equal(h.b.calls.filter(x => x === 'eth_requestAccounts').length, 1);assert.equal(h.a.calls.length, 0);assert.equal(h.context.currentWallet.walletId, h.b.uuid);assert.equal(h.saved().account, accountB);assert.equal(h.context.currentWallet.standardConnection, 'CONNECTED');h.assertSeparate();
});
for (const mode of ['close', 'cancel']) test(`retained icon row cannot request accounts after current ${mode}`, async () => {
  const h = harness({icon: 'data:image/png;fixture,"<&>'});await h.signin();const old = row(h, h.b);
  if (mode === 'close') h.node('#wallet-chooser-close').onclick();
  else {let prevented = false;h.node('#wallet-chooser').oncancel({preventDefault() {prevented = true;}});assert.equal(prevented, true);}
  await old.onclick();assert.equal(h.b.calls.length, 0);assert.equal(h.context.currentWallet, null);assert.equal(h.saved(), null);assert.equal(h.node('#wallet-chooser').open, false);h.assertSeparate();
});
test('old icon row cannot close newer discovery chooser or start an approval', async () => {
  const h = harness({icon: 'data:image/png;fixture,"<&>'});await h.signin();const old = row(h, h.b);await h.signin();await old.onclick();assert.equal(h.node('#wallet-chooser').open, true);assert.equal(h.b.calls.length, 0);h.assertSeparate();
});
test('old cancel callback cannot close current chooser whose icons are serialized', async () => {
  const h = harness({icon: 'data:image/png;fixture,"<&>'});await h.signin();const oldCancel = h.node('#wallet-chooser').oncancel;await h.signin();let prevented = false;oldCancel({preventDefault() {prevented = true;}});assert.equal(prevented, true);assert.equal(h.node('#wallet-chooser').open, true);assert.equal(serializedSource(row(h, h.b)), h.b.icon);assert.equal(h.b.calls.length, 0);h.assertSeparate();
});
