import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';

const [source, html, i18n] = await Promise.all(['app.js', 'index.html', 'i18n.js'].map(name => readFile(new URL(`../web/${name}`, import.meta.url), 'utf8')));
const accountA = `0x${'a'.repeat(40)}`, accountB = `0x${'b'.repeat(40)}`;
const connected = account => ({status: 'connected', providerKind: 'metamask', chainId: '0x1917', account});
const receipt = (account, balance = '1000000000000000000') => ({...connected(account), asset: 'YNXT', decimals: 18, balanceBaseUnits: balance, blockNumber: '42', source: 'selected-wallet-provider', asOf: '2026-09-12T00:00:00.000Z'});
const deferred = () => {let resolve, reject; const promise = new Promise((done, fail) => {resolve = done; reject = fail;}); return {promise, resolve, reject};};
const settle = async () => {for (let i = 0; i < 8; i++) await Promise.resolve();};

// Execute the shipped app with a small DOM/HTTP boundary. Provider lifecycles are
// independently exercised in the actual-browser suite; these are local fixtures.
class Element {
  constructor(tag = 'div', attrs = '') {
    this.tagName = tag; this.dataset = {}; this.value = ''; this.textContent = ''; this.hidden = /\bhidden\b/.test(attrs); this.disabled = /\bdisabled\b/.test(attrs); this.children = []; this.events = new Map(); this._html = '';
    this.classes = new Set((attrs.match(/class="([^"]*)"/)?.[1] || '').split(/\s+/));
    this.classList = {add: name => this.classes.add(name), remove: name => this.classes.delete(name), toggle: (name, enabled) => enabled ? this.classes.add(name) : this.classes.delete(name)};
    for (const [, key, value] of attrs.matchAll(/([\w-]+)="([^"]*)"/g)) {
      if (key.startsWith('data-')) this.dataset[key.slice(5).replace(/-([a-z])/g, (_, char) => char.toUpperCase())] = value;
      else if (key === 'value' || key === 'id') this[key] = value;
    }
  }
  get innerHTML() {return this.textContent ? this.textContent.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;') : this._html;}
  set innerHTML(value) {this._html = value; this.textContent = '';}
  addEventListener(type, listener) {this.events.set(type, [...(this.events.get(type) || []), listener]);}
  emit(type) {for (const listener of this.events.get(type) || []) listener({target: this});}
  append(...elements) {this.children.push(...elements);}
  replaceChildren(...elements) {this.children = elements;}
}
function harness({snapshot = {}, portfolioRead, apiResponse, savedStorage} = {}) {
  const ids = new Map(), elements = [];
  for (const [, tag, attrs] of html.matchAll(/<([a-z]+)\b([^>]*?)>/g)) {
    const element = new Element(tag, attrs); elements.push(element); if (element.id) ids.set(element.id, element);
  }
  const nav = elements.filter(element => element.tagName === 'button' && element.dataset.view), views = elements.filter(element => element.tagName === 'section' && element.classes.has('view'));
  const formInputs = id => [...html.match(new RegExp(`<form id="${id}"[\\s\\S]*?</form>`))[0].matchAll(/<(?:input|select)\b[^>]*id="([^"]+)"/g)].map(([, key]) => ids.get(key));
  const document = {documentElement: {}, createElement: tag => new Element(tag), querySelector: selector => selector === 'nav button.active' ? nav.find(element => element.classes.has('active')) : ids.get(selector.slice(1)), querySelectorAll: selector => {
    if (selector === 'nav button') return nav;
    if (selector === '.view') return views;
    if (selector === '[data-i18n]') return elements.filter(element => element.dataset.i18n);
    if (selector === '[data-business-i18n]') return elements.filter(element => element.dataset.businessI18n);
    if (selector.startsWith('#mandate-form')) return formInputs('mandate-form').filter(element => element.id !== 'mandate-signature');
    if (selector.startsWith('#testnet-order-form')) return formInputs('testnet-order-form').filter(element => element.id !== 'order-signature');
    throw new Error(`Unmodelled DOM selector: ${selector}`);
  }};
  const storage = new Map(savedStorage || []), calls = [], events = new Map(); let current = {status: 'disconnected'}, reads = 0, proofs = 0;
  const window = {addEventListener: (name, listener) => events.set(name, listener), YNXQuantWallet: {
    getStandardWalletState: () => current,
    readPortfolio: () => {reads++; return portfolioRead ? portfolioRead(current) : Promise.resolve(receipt(current.account));},
    requireProof: async () => {proofs++; throw new Error('PRIVATE_SERVICE_DEGRADED');},
  }};
  const context = vm.createContext({window, document, console, crypto: webcrypto, Intl, Date, BigInt, setTimeout: () => 1, clearTimeout: () => {}, confirm: () => false,
    localStorage: {getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key)},
    fetch: async (url, options) => {calls.push({url, options}); const body = apiResponse ? await apiResponse(url, options) : url.endsWith('/snapshot') ? snapshot : url.endsWith('/paper/orders') ? {ID: 'paper-000001', ...JSON.parse(options.body)} : {payload: 'exact-fixture-payload', digest: 'f'.repeat(64)}; return {ok: true, json: async () => body};},
  });
  vm.runInContext(i18n, context);
  context.QuantI18n = window.QuantI18n;
  vm.runInContext(source, context);
  return {ids, calls, storage, context, reads: () => reads, proofs: () => proofs,
    wallet: state => {current = state; events.get('ynx:quant-wallet-state')({detail: state});},
    submit: id => ids.get(id).onsubmit({preventDefault() {}}),
  };
}

test('guest Paper has a separate persisted browser tenant and cannot submit an invented strategy hash', async () => {
  const app = harness(); await settle();
  assert.match(app.ids.get('wallet-portfolio-status').textContent, /Connect YNX Wallet or MetaMask/);
  assert.equal(app.ids.get('wallet-portfolio-balance').textContent, '—');
  assert.equal(app.ids.get('paper-submit').disabled, true);
  await app.submit('paper-order');
  assert.equal(app.calls.length, 1);
  const tenant = app.calls[0].options.headers['x-ynx-tenant-id'];
  assert.match(tenant, /^[0-9a-f]{64}$/);
  app.wallet(connected(accountA)); await settle();
  app.wallet(connected(accountB)); await settle();
  assert.equal(app.storage.get('ynx.quant.tenant.v1'), tenant);
  assert.equal(app.proofs(), 0);
});

test('Paper submits the selected saved strategy, preserves selection on refresh and rejects a stale/foreign hash', async () => {
  const hash = 'd'.repeat(64), app = harness({snapshot: {strategies: {one: {Name: 'Saved strategy', StrategyHash: hash}}}}); await settle();
  app.ids.get('paper-strategy').value = hash; app.ids.get('paper-strategy').onchange();
  app.ids.get('side').value = 'buy'; app.ids.get('paper-amount').value = '100';
  await app.submit('paper-order');
  const order = app.calls.find(call => call.url.endsWith('/paper/orders'));
  assert.equal(JSON.parse(order.options.body).StrategyHash, hash);
  assert.equal(app.ids.get('paper-strategy').value, hash);
  app.ids.get('paper-strategy').value = 'e'.repeat(64);
  await app.submit('paper-order');
  assert.equal(app.calls.filter(call => call.url.endsWith('/paper/orders')).length, 1);
});

test('Paper preserves one intent across double clicks, unknown network outcome and reload retry', async () => {
  const strategyHash = 'd'.repeat(64), snapshot = {strategies: {one: {Name: 'Saved strategy', StrategyHash: strategyHash}}};
  const late = deferred(), app = harness({snapshot, apiResponse: url => url.endsWith('/snapshot') ? snapshot : late.promise});
  await settle();
  app.ids.get('paper-strategy').value = strategyHash;
  app.ids.get('paper-strategy').onchange();
  app.ids.get('side').value = 'buy'; app.ids.get('paper-amount').value = '100';
  const first = app.submit('paper-order');
  await app.submit('paper-order');
  assert.equal(app.ids.get('paper-submit').disabled, true);
  const requests = app.calls.filter(call => call.url.endsWith('/paper/orders'));
  assert.equal(requests.length, 1);
  const original = JSON.parse(requests[0].options.body);
  assert.match(original.IdempotencyKey, /^quant-paper-[0-9a-f-]{36}$/);
  late.reject(new Error('Connection lost after request was sent')); await first;
  const key = [...app.storage.keys()].find(value => value.startsWith('ynx.quant.paper.pending.v1:'));
  assert.equal(JSON.parse(app.storage.get(key)).IdempotencyKey, original.IdempotencyKey);
  app.wallet(connected(accountB)); await settle();
  assert.equal(JSON.parse(app.storage.get(key)).IdempotencyKey, original.IdempotencyKey);
  app.ids.get('paper-amount').value = '101';
  await app.submit('paper-order');
  assert.equal(app.calls.filter(call => call.url.endsWith('/paper/orders')).length, 1);
  assert.match(app.ids.get('toast').textContent, /unknown outcome/);
  const restored = harness({snapshot, savedStorage: app.storage}); await settle();
  assert.equal(restored.ids.get('paper-strategy').value, strategyHash);
  assert.equal(restored.ids.get('paper-amount').value, '100');
  await restored.submit('paper-order');
  const retried = JSON.parse(restored.calls.find(call => call.url.endsWith('/paper/orders')).options.body);
  assert.deepEqual(retried, original);
  assert.equal(restored.storage.has(key), false);
  assert.equal(restored.proofs(), 0);
});

test('Paper refuses unsafe numeric amounts before creating an intent or making a request', async () => {
  const hash = 'd'.repeat(64), app = harness({snapshot: {strategies: {one: {Name: 'Saved', StrategyHash: hash}}}}); await settle();
  app.ids.get('paper-strategy').value = hash; app.ids.get('side').value = 'buy';
  for (const amount of ['9007199254740992', '0', '-1', '1.5']) {
    app.ids.get('paper-amount').value = amount;
    await app.submit('paper-order');
  }
  assert.equal(app.calls.filter(call => call.url.endsWith('/paper/orders')).length, 0);
  assert.equal([...app.storage.keys()].some(key => key.startsWith('ynx.quant.paper.pending.v1:')), false);
});

test('Paper does not acknowledge or forget an intent when the service returns an unbound result', async () => {
  const hash = 'd'.repeat(64), snapshot = {strategies: {one: {Name: 'Saved', StrategyHash: hash}}};
  for (const mismatch of [{}, {IdempotencyKey: 'wrong-key'}, {StrategyHash: 'e'.repeat(64)}, {Amount: 101}]) {
    const app = harness({snapshot, apiResponse: (url, options) => url.endsWith('/snapshot') ? snapshot : Object.keys(mismatch).length ? {ID: 'paper-000001', ...JSON.parse(options.body), ...mismatch} : {}});
    await settle();
    app.ids.get('paper-strategy').value = hash; app.ids.get('side').value = 'buy'; app.ids.get('paper-amount').value = '100';
    await app.submit('paper-order');
    assert.match(app.ids.get('toast').textContent, /unknown outcome/);
    assert.equal([...app.storage.keys()].some(key => key.startsWith('ynx.quant.paper.pending.v1:')), true);
  }
});

test('portfolio uses exact provider data without floating point loss and rejects malformed account/source receipts', async () => {
  const large = '9007199254740993000000000000000001';
  const app = harness({portfolioRead: state => Promise.resolve(receipt(state.account, large))}); await settle();
  app.wallet(connected(accountA)); await settle();
  assert.equal(app.ids.get('wallet-portfolio-balance').textContent, '9,007,199,254,740,993.000000000000000001 YNXT');
  assert.equal(app.ids.get('wallet-portfolio-block').textContent, '42');
  assert.equal(app.ids.get('wallet-portfolio-account').textContent, accountA);
  for (const value of [{...receipt(accountB)}, {...receipt(accountA), source: 'local-paper'}, {...receipt(accountA), decimals: 6}, {...receipt(accountA), balanceBaseUnits: 1e18}, {...receipt(accountA), blockNumber: 42}]) {
    app.context.window.YNXQuantWallet.readPortfolio = async () => value;
    await app.ids.get('wallet-portfolio-refresh').onclick();
    assert.equal(app.ids.get('wallet-portfolio-balance').textContent, '—');
    assert.match(app.ids.get('wallet-portfolio-status').textContent, /unavailable/);
  }
});

test('wallet events deduplicate reads, clear account-bound signatures/previews and ignore late portfolio results', async () => {
  const late = deferred(), app = harness({portfolioRead: () => late.promise}); await settle();
  app.wallet(connected(accountA)); app.wallet({...connected(accountA), rpcProbeStatus: 'degraded'});
  assert.equal(app.reads(), 1);
  for (const id of ['mandate-signature', 'order-signature', 'mandate-account', 'order-mandate']) app.ids.get(id).value = 'old-account-bound-value';
  for (const id of ['mandate-payload', 'order-payload']) {app.ids.get(id).hidden = false; app.ids.get(id).textContent = 'old preview';}
  app.wallet({status: 'disconnected'});
  late.resolve(receipt(accountA)); await settle();
  assert.equal(app.ids.get('wallet-portfolio-balance').textContent, '—');
  for (const id of ['mandate-signature', 'order-signature', 'mandate-account', 'order-mandate']) assert.equal(app.ids.get(id).value, '');
  for (const id of ['mandate-payload', 'order-payload']) assert.equal(app.ids.get(id).hidden, true);
});

test('pending signing preview cannot return after account change and unpreviewed orders never request proof', async () => {
  const late = deferred(), app = harness({apiResponse: url => url.endsWith('/snapshot') ? {} : late.promise}); await settle();
  app.wallet(connected(accountA)); await settle();
  const preview = app.ids.get('preview-mandate').onclick();
  app.wallet(connected(accountB));
  late.resolve({payload: 'stale-account-payload', digest: 'f'.repeat(64)}); await preview;
  assert.equal(app.ids.get('mandate-payload').hidden, true);
  await app.submit('mandate-form'); await app.submit('testnet-order-form');
  assert.equal(app.proofs(), 0);
  assert.equal(app.calls.filter(call => /\/testnet\/(orders|mandates)$/.test(call.url)).length, 0);
});

test('new portfolio states and execution blocker follow all supported languages', async () => {
  const app = harness(); await settle();
  const englishKeys = vm.runInContext('Object.keys(businessCopy.en)', app.context);
  for (const locale of vm.runInContext('supportedLocales', app.context)) {
    assert.deepEqual([...vm.runInContext(`Object.keys(businessCopy[${JSON.stringify(locale)}])`, app.context)].sort(), [...englishKeys].sort());
    app.ids.get('locale').onchange({target: {value: locale}});
    assert.equal(app.context.document.documentElement.lang, locale);
    assert.equal(app.ids.get('wallet-portfolio-status').textContent, vm.runInContext(`businessCopy[${JSON.stringify(locale)}].connectForPortfolio`, app.context));
    assert.equal(app.ids.get('testnet-execution-boundary').textContent, vm.runInContext(`businessCopy[${JSON.stringify(locale)}].executionUnavailable`, app.context));
  }
});
