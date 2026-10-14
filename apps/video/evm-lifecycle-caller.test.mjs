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
    replaceChildren() {this.children = [];}, append(item) {this.children.push(item);}, setAttribute() {}, showModal() {this.open = true;}, close() {this.open = false;}});return nodes.get(selector);};
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
const rejection = () => Object.assign(new Error('fixture approval rejected'), {code: 4001});

for (const outcome of ['success', 'failure']) test(`revocation rejects late interactive ${outcome} and its stale finally`, async () => {
  const h = harness();h.a.interactiveGate = deferred();const pending = h.connect(h.a);await h.a.entered.promise;await h.revoke();const message = h.node('#session').textContent;
  if (outcome === 'success') h.a.interactiveGate.resolve([accountA]);else h.a.interactiveGate.reject(rejection());await pending;
  assert.equal(h.context.currentWallet, null);assert.equal(h.saved(), null);assert.equal(h.node('#session').textContent, message);assert.equal(h.notices.length, 0);assert.equal(h.node('#signin').disabled, false);h.assertSeparate();
});

test('old real restore read cannot replace a newer explicit interactive connection', async () => {
  const h = harness();h.sessionStorage.setItem(savedKey, JSON.stringify({walletId: h.a.uuid, account: accountA, walletName: 'YNX Wallet'}));h.a.restoreGate = deferred();const old = h.restore();await h.a.restoring.promise;await h.connect(h.b);h.a.restoreGate.resolve([accountA]);await old;
  assert.equal(h.context.currentWallet.walletId, h.b.uuid);assert.equal(h.saved().account, accountB);assert.equal(h.notices.length, 1);assert.equal(h.a.calls.includes('eth_requestAccounts'), false);h.assertSeparate();
});

for (const outcome of ['success', 'failure']) test(`older interactive ${outcome} cannot replace or clear newer explicit success`, async () => {
  const h = harness();h.a.interactiveGate = deferred();const old = h.connect(h.a);await h.a.entered.promise;await h.connect(h.b);
  if (outcome === 'success') h.a.interactiveGate.resolve([accountA]);else h.a.interactiveGate.reject(rejection());await old;
  assert.equal(h.context.currentWallet.walletId, h.b.uuid);assert.equal(h.saved().account, accountB);assert.equal(h.notices.length, 1);assert.equal(h.b.events.get('disconnect').size, 1);h.assertSeparate();
});

test('older finally cannot release the busy button of a newer pending request', async () => {
  const h = harness();h.a.interactiveGate = deferred();h.b.interactiveGate = deferred();const old = h.connect(h.a);await h.a.entered.promise;const current = h.connect(h.b);await h.b.entered.promise;h.a.interactiveGate.resolve([accountA]);await old;const busy = h.node('#signin').disabled;h.b.interactiveGate.resolve([accountB]);await current;
  assert.equal(busy, true);assert.equal(h.node('#signin').disabled, false);assert.equal(h.context.currentWallet.walletId, h.b.uuid);assert.equal(h.notices.length, 1);h.assertSeparate();
});

test('newer rejection remains authoritative when older success arrives later', async () => {
  const h = harness();h.a.interactiveGate = deferred();const old = h.connect(h.a);await h.a.entered.promise;h.b.interactiveGate = deferred();const current = h.connect(h.b);await h.b.entered.promise;h.b.interactiveGate.reject(rejection());await current;const message = h.node('#session').textContent;h.a.interactiveGate.resolve([accountA]);await old;
  assert.equal(h.context.currentWallet, null);assert.equal(h.saved(), null);assert.equal(h.node('#session').textContent, message);assert.equal(h.notices.length, 1);h.assertSeparate();
});

test('unbound old provider queued account/chain/disconnect callbacks cannot mutate newer display/cache', async () => {
  const h = harness();await h.connect(h.a);const accounts = h.a.queued('accountsChanged'), chain = h.a.queued('chainChanged'), disconnect = h.a.queued('disconnect');await h.connect(h.b);const before = h.node('#session').textContent;
  for (const callback of accounts) callback([accountC]);for (const callback of chain) callback('0x1');for (const callback of disconnect) callback();
  assert.equal(h.context.currentWallet?.walletId, h.b.uuid);assert.equal(h.saved().account, accountB);assert.equal(h.node('#session').textContent, before);assert.equal(h.a.events.get('accountsChanged').size, 0);assert.equal(h.a.events.get('chainChanged').size, 0);assert.equal(h.a.events.get('disconnect').size, 0);assert.equal(h.b.events.get('disconnect').size, 1);h.assertSeparate();
});

test('current provider events still update display/cache and revoke only their current connection', async () => {
  const h = harness();await h.connect(h.b);h.b.emit('accountsChanged', [accountC]);assert.equal(h.context.currentWallet.account, accountC);assert.equal(h.saved().account, accountC);h.b.emit('chainChanged', YNX_TESTNET.evmChainHex);assert.equal(h.saved().chainId, YNX_TESTNET.evmChainHex);h.b.emit('chainChanged', '0x1');assert.match(h.node('#session').textContent, /chain changed away/);h.b.emit('disconnect');assert.equal(h.context.currentWallet, null);assert.equal(h.saved(), null);assert.equal(h.b.events.get('disconnect').size, 0);h.assertSeparate();
});

test('normal ambiguous discovery shows explicit chooser and selected provider uses real standard SDK', async () => {
  const h = harness();await h.signin();assert.equal(h.node('#wallet-chooser').open, true);assert.equal(h.node('#wallet-choices').children.length, 2);assert.equal(h.a.calls.length, 0);assert.equal(h.b.calls.length, 0);
  const choice = h.node('#wallet-choices').children.find(item => item.dataset.walletId === h.b.uuid);await choice.onclick();assert.equal(h.context.currentWallet.walletId, h.b.uuid);assert.equal(h.context.currentWallet.standardConnection, 'CONNECTED');assert.equal(h.context.currentWallet.productSession, 'PRIVATE_SERVICE_DEGRADED');assert.equal(h.a.calls.length, 0);assert.equal(h.b.calls[0], 'eth_requestAccounts');h.assertSeparate();
});

test('absent restore cache does not prompt providers or block guest startup', async () => {
  const h = harness();await h.restore();assert.equal(h.context.currentWallet, null);assert.equal(h.a.calls.length, 0);assert.equal(h.b.calls.length, 0);assert.equal(h.node('#signin').disabled, false);h.assertSeparate();
});

test('old sign-in button discovery cannot open stale chooser after newer explicit request starts', async () => {
  const h = harness();const old = h.signin();const current = h.connect(h.b);await Promise.all([old, current]);
  assert.equal(!!h.node('#wallet-chooser').open, false);assert.equal(h.context.currentWallet.walletId, h.b.uuid);assert.equal(h.notices.length, 1);h.assertSeparate();
});
test('optional restore cannot supersede or read old provider while an explicit request is busy', async () => {
  const h = harness();h.sessionStorage.setItem(savedKey, JSON.stringify({walletId: h.a.uuid, account: accountA}));h.b.interactiveGate = deferred();const pending = h.connect(h.b);await h.b.entered.promise;await h.restore();const oldProviderReads = h.a.calls.length;const provisional = h.context.currentWallet;h.b.interactiveGate.resolve([accountB]);await pending;
  assert.equal(oldProviderReads, 0);assert.equal(provisional, null);assert.equal(h.context.currentWallet.walletId, h.b.uuid);assert.equal(h.node('#signin').disabled, false);h.assertSeparate();
});
test('current cached restore uses real read-only provider path and binds current events normally', async () => {
  const h = harness();h.sessionStorage.setItem(savedKey, JSON.stringify({walletId: h.a.uuid, account: accountA}));await h.restore();assert.equal(h.context.currentWallet.walletId, h.a.uuid);assert.equal(h.saved().account, accountA);assert.deepEqual(h.a.calls, ['eth_accounts', 'eth_chainId']);assert.equal(h.b.calls.length, 0);h.a.emit('accountsChanged', [accountC]);assert.equal(h.saved().account, accountC);assert.equal(h.a.events.get('disconnect').size, 1);h.assertSeparate();
});
