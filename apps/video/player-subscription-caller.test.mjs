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
function harness(method, fetch) {
  const values = new Map();let tail = Promise.resolve();
  const environment = {isSecureContext: true, crypto: webcrypto,
    localStorage: {getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value)},
    navigator: {locks: {request: (name, {signal, mode}, callback) => {
      assert.equal(name, storageKey);assert.equal(mode, 'exclusive');
      const result = tail.then(() => {signal?.throwIfAborted();return callback({name, mode});});tail = result.catch(() => {});return result;
    }}}};
  const notices = [], requests = [], keys = [], disabledWrites = [], events = new Map();
  const button = {dataset: {subscribed: String(method === 'DELETE')}, textContent: method === 'DELETE' ? 'Unsubscribe' : 'Subscribe', set disabled(value) {disabledWrites.push(value);}};
  const close = {}, player = {open: true, close() {this.open = false;}, addEventListener: (name, handler) => events.set(name, handler)};
  const context = vm.createContext({DOMException, AbortSignal, AbortController, Error, encodeURIComponent,
    productRevision: 1, playbackSelectionRevision: 1, subscriptionRevision: 0, productSignOutPending: false,
    productRequestAbort: new AbortController(), currentVideo: {id: 'first', channel_id: 'original-channel'},
    productConnected: () => true, requireAccount: () => true, flushWatch: async () => {},
    $: selector => selector === '#subscribe' ? button : selector === '#close' ? close : selector === '#player' ? player : {pause() {}},
    notice: (...args) => notices.push(args)});
  let api;
  const initialize = () => api = createVideoAPI({baseURL: 'https://video.ynxweb4.com/video/api', environment,
    getAccount: () => 'owner-a', requestId: () => {const key = randomUUID();keys.push(key);return key;}, authorize: async () => ({}),
    fetch: async (url, options) => {requests.push({url, ...options});return fetch(url, options);}});
  initialize();context.api = (...args) => api(...args);
  // Execute production close/cancel paths, privateAPI and subscribe handler unchanged.
  vm.runInContext(slice('const privateAPI = async', '\nconst playlistJournal=') + '\n' +
    slice('$("#close").onclick =', '\n$("#video").addEventListener("timeupdate"') + '\n' +
    slice('$("#subscribe").onclick =', '\n$("#playlist").onclick ='), context);
  return {context, button, notices, requests, keys, disabledWrites, initialize,
    submit: () => button.onclick({currentTarget: button}),
    retire: event => event === 'close' ? close.onclick() : events.get('cancel')(),
    rows: () => JSON.parse(values.get(storageKey) || '{"records":[]}').records};
}

for (const method of ['PUT', 'DELETE']) for (const event of ['close', 'cancel']) test(`${method} late ${event === 'close' ? 'success' : 'UNKNOWN'} cannot update button or notice after actual player ${event}`, async () => {
  const entered = deferred(), response = deferred();
  const h = harness(method, async () => {entered.resolve();await response.promise;if (event === 'cancel') throw new TypeError('original subscription response lost');return new Response('{}');});
  const pending = h.submit();await entered.promise;const originalTarget = h.context.currentVideo;
  h.retire(event);assert.equal(h.context.playbackSelectionRevision, 2);assert.equal(h.context.currentVideo, originalTarget);assert.equal(h.context.subscriptionRevision, 1);
  h.button.dataset.subscribed = 'replacement-state';h.button.textContent = 'replacement text';response.resolve();await pending;
  assert.equal(h.notices.length, 0);assert.equal(h.button.dataset.subscribed, 'replacement-state');assert.equal(h.button.textContent, 'replacement text');assert.deepEqual(h.disabledWrites, [true]);
  assert.equal(h.requests.length, 1);assert.equal(h.requests[0].method, method);assert.match(h.requests[0].url, /original-channel\/subscription$/);
  assert.equal(h.requests[0].headers['Idempotency-Key'], h.keys[0]);assert.equal(h.keys.length, 1);
  if (event === 'cancel') {assert.equal(h.rows()[0].key, h.keys[0]);assert.equal(h.rows()[0].state, 'UNKNOWN');}else assert.equal(h.rows().length, 0);
});

for (const method of ['PUT', 'DELETE']) test(`current ${method} acknowledgement updates its original button and clears its fence`, async () => {
  const h = harness(method, async () => new Response('{}'));await h.submit();
  assert.equal(h.requests.length, 1);assert.equal(h.keys.length, 1);assert.equal(h.rows().length, 0);
  assert.equal(h.button.dataset.subscribed, String(method === 'PUT'));assert.equal(h.button.textContent, method === 'PUT' ? 'Unsubscribe' : 'Subscribe');
  assert.deepEqual(h.notices, [[method === 'PUT' ? 'Channel added to your subscriptions.' : 'Subscription removed.']]);assert.deepEqual(h.disabledWrites, [true, false]);
});

for (const method of ['PUT', 'DELETE']) test(`current ${method} UNKNOWN stays visible and retains original key/firstCause through API reinitialization without replay`, async () => {
  const h = harness(method, async () => {throw new TypeError('original subscription response lost');});await h.submit();
  const firstCause = h.rows()[0].firstCause;h.initialize();await h.submit();
  assert.equal(h.requests.length, 1);assert.equal(h.keys.length, 1);assert.equal(h.rows()[0].key, h.keys[0]);assert.equal(h.rows()[0].state, 'UNKNOWN');assert.deepEqual(h.rows()[0].firstCause, firstCause);
  assert.equal(h.notices.length, 2);assert.ok(h.notices.every(row => row[1] === true && /result unconfirmed/.test(row[0])));
  assert.equal(h.button.dataset.subscribed, String(method === 'DELETE'));assert.deepEqual(h.disabledWrites, [true, false, true, false]);
});
