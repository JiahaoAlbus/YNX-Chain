import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {webcrypto, randomUUID} from 'node:crypto';
import {createVideoAPI} from './video-api.js';
const source = await readFile(process.env.YNX_VIDEO_APP_SOURCE || new URL('./app.js', import.meta.url), 'utf8');
const slice = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
const deferred = () => {let resolve;const promise = new Promise(done => resolve = done);return {promise, resolve};};
const storageKey = 'ynx.video.pending-mutations.v1';
async function harness(write) {
  const values = new Map();let tail = Promise.resolve();
  const environment = {isSecureContext: true, crypto: webcrypto,
    localStorage: {getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value)},
    navigator: {locks: {request: (name, {signal, mode}, callback) => {
      assert.equal(name, storageKey);assert.equal(mode, 'exclusive');
      const result = tail.then(() => {signal?.throwIfAborted();return callback({name, mode});});tail = result.catch(() => {});return result;
    }}}};
  const notices = [], requests = [], keys = [], disabledWrites = [], navigations = [], articles = [];
  const action = {set disabled(value) {disabledWrites.push(value);}};
  const box = {replaceChildren() {articles.length = 0;}, append(article) {articles.push(article);}};
  const context = vm.createContext({DOMException, AbortSignal, AbortController, Error, encodeURIComponent,
    productRevision: 1, productSignOutPending: false, libraryEpoch: 0, currentView: 'discover',
    productRequestAbort: new AbortController(), productState: {session: {account: 'owner-a'}}, productConnected: () => true,
    $: () => box, beginLibrary: view => {navigations.push(view);context.currentView = view;return ++context.libraryEpoch;},
    field: (value, lower, upper) => value[lower] ?? value[upper], esc: value => value,
    document: {createElement: () => ({querySelector: selector => selector === '.unsubscribe' ? action : {}})},
    showChannel: () => {}, empty: () => {}, libraryFailure: error => notices.push([error.message, true]),
    notice: (...args) => notices.push(args)});
  let api;
  const initialize = () => api = createVideoAPI({baseURL: 'https://video.ynxweb4.com/video/api', environment,
    getAccount: () => context.productState.session.account, requestId: () => {const key = randomUUID();keys.push(key);return key;},
    authorize: async () => ({}), fetch: async (url, options) => {
      requests.push({url, ...options});return options.method === 'DELETE' ? write(url, options) : new Response('[{"id":"original-channel","name":"Original","handle":"original"}]');}});
  initialize();context.api = (...args) => api(...args);
  vm.runInContext(slice('const privateAPI = async', '\nconst playlistJournal=') + '\n' +
    slice('function playlistScope(', '\nasync function createOriginalPlaylist') + '\n' +
    slice('async function showSubscriptions(', '\nasync function refreshSubscriptionButton'), context);
  await vm.runInContext('showSubscriptions({})', context);
  const submit = action.onclick;
  return {context, notices, requests, keys, disabledWrites, navigations, initialize,
    submit: () => submit({currentTarget: action}),
    retire() {context.productState = {session: {account: 'owner-b'}};context.productRevision++;context.productRequestAbort.abort(new DOMException('Account changed', 'AbortError'));context.productRequestAbort = new AbortController();},
    rows: () => JSON.parse(values.get(storageKey) || '{"records":[]}').records};
}
for (const change of ['view', 'epoch', 'account']) test(`unsubscribe completion cannot navigate or publish after ${change} retires its rendered scope`, async () => {
  const entered = deferred(), response = deferred();
  const h = await harness(async () => {entered.resolve();await response.promise;return new Response('{}');});
  const pending = h.submit();await entered.promise;
  if (change === 'view') h.context.currentView = 'history';
  if (change === 'epoch') h.context.libraryEpoch++;
  if (change === 'account') h.retire();
  const expectedView = h.context.currentView, expectedEpoch = h.context.libraryEpoch;
  response.resolve();await pending;
  assert.equal(h.context.currentView, expectedView);assert.equal(h.context.libraryEpoch, expectedEpoch);
  assert.equal(h.navigations.length, 1);assert.equal(h.notices.length, 0);assert.deepEqual(h.disabledWrites, [true]);
  assert.equal(h.requests.filter(row => row.method === 'DELETE').length, 1);assert.equal(h.keys.length, 1);
  assert.match(h.requests[1].url, /original-channel\/subscription$/);assert.equal(h.requests[1].headers['Idempotency-Key'], h.keys[0]);
  if (change === 'account') assert.equal(h.rows()[0].key, h.keys[0]);else assert.equal(h.rows().length, 0);
});

test('held old unsubscribe button cannot dispatch DELETE for a newly connected account', async () => {
  const h = await harness(async () => new Response('{}'));h.retire();await h.submit();
  assert.equal(h.requests.filter(row => row.method === 'DELETE').length, 0);assert.equal(h.keys.length, 0);
  assert.equal(h.rows().length, 0);assert.equal(h.notices.length, 0);assert.equal(h.navigations.length, 1);assert.deepEqual(h.disabledWrites, []);
});

test('retired unsubscribe UNKNOWN remains fenced through API reinitialization without old UI publication', async () => {
  const entered = deferred(), response = deferred();
  const h = await harness(async () => {entered.resolve();await response.promise;throw new TypeError('lost original unsubscribe result');});
  const pending = h.submit();await entered.promise;h.context.currentView = 'history';response.resolve();await pending;
  assert.equal(h.notices.length, 0);assert.deepEqual(h.disabledWrites, [true]);const original = h.keys[0];
  assert.equal(h.rows()[0].key, original);assert.equal(h.rows()[0].state, 'UNKNOWN');
  h.initialize();h.context.currentView = 'subscriptions';await h.submit();
  assert.equal(h.requests.filter(row => row.method === 'DELETE').length, 1);assert.equal(h.keys.length, 1);
  assert.equal(h.rows()[0].key, original);assert.equal(h.rows()[0].state, 'UNKNOWN');
  assert.equal(h.notices.length, 1);assert.equal(h.notices[0][1], true);assert.match(h.notices[0][0], /result unconfirmed/);
});

test('current unsubscribe succeeds once, clears original fence and reloads subscriptions normally', async () => {
  const h = await harness(async () => new Response('{}'));await h.submit();
  assert.equal(h.requests.length, 3);assert.deepEqual(h.requests.map(row => row.method), ['GET', 'DELETE', 'GET']);
  assert.equal(h.keys.length, 1);assert.equal(h.rows().length, 0);assert.equal(h.notices.length, 0);
  assert.equal(h.navigations.length, 2);assert.equal(h.context.currentView, 'subscriptions');
});

test('current unsubscribe UNKNOWN remains visible, restores its button and prevents another DELETE', async () => {
  const h = await harness(async () => {throw new TypeError('lost original response');});await h.submit();await h.submit();
  assert.equal(h.requests.filter(row => row.method === 'DELETE').length, 1);assert.equal(h.keys.length, 1);assert.equal(h.navigations.length, 1);
  assert.equal(h.rows()[0].key, h.keys[0]);assert.equal(h.rows()[0].state, 'UNKNOWN');
  assert.equal(h.notices.length, 2);assert.ok(h.notices.every(row => row[1] === true && /result unconfirmed/.test(row[0])));
  assert.deepEqual(h.disabledWrites, [true, false, true, false]);
});
