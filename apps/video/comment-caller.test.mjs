import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {webcrypto, randomUUID} from 'node:crypto';
import {createVideoAPI} from './video-api.js';

const source = await readFile(process.env.YNX_VIDEO_APP_SOURCE || new URL('./app.js', import.meta.url), 'utf8');
const slice = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
const deferred = () => {let resolve, reject;const promise = new Promise((yes, no) => {resolve = yes;reject = no;});return {promise, resolve, reject};};
const storageKey = 'ynx.video.pending-mutations.v1';
function harness(fetch) {
  const values = new Map();let tail = Promise.resolve();
  const environment = {isSecureContext: true, crypto: webcrypto,
    localStorage: {getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value)},
    navigator: {locks: {request: (_name, {signal}, callback) => {
      const result = tail.then(() => {signal?.throwIfAborted();return callback({name: storageKey, mode: 'exclusive'});});tail = result.catch(() => {});return result;
    }}}};
  const notices = [], requests = [], mintedKeys = [], commentBox = {innerHTML: '', textContent: ''};
  const input = {value: 'original draft'};
  const form = {elements: [input], resets: 0, reset() {this.resets++;input.value = '';}};
  const context = vm.createContext({DOMException, AbortSignal, AbortController, Error,
    productRevision: 1, playbackSelectionRevision: 1, productSignOutPending: false,
    productRequestAbort: new AbortController(), currentVideo: {id: 'first'}, account: 'owner-a',
    productConnected: () => true, requireAccount: () => true,
    $: selector => selector === '#comment' ? form : commentBox,
    json: body => ({method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)}),
    esc: value => value, notice: (...args) => notices.push(args)});
  let api;
  const initialize = () => api = createVideoAPI({baseURL: 'https://video.ynxweb4.com/video/api',environment,
    getAccount: () => context.account, requestId: () => {const key = randomUUID();mintedKeys.push(key);return key;}, authorize: async () => ({}),
    fetch: async (url, options) => {requests.push({url, ...options});return fetch(url, options);}});
  initialize();context.api = (...args) => api(...args);
  // Execute exact production functions and handler, without changing their bodies.
  vm.runInContext(slice('const privateAPI = async', '\nconst playlistJournal=') + '\n' +
    slice('async function loadComments()', '\nasync function flushWatch') + '\n' +
    slice('$("#comment").onsubmit =', '\nconst nav ='), context);
  return {context, form, input, notices, requests, mintedKeys, initialize, environment, commentBox,
    submit: () => form.onsubmit({preventDefault() {}, target: form}),
    retire() {context.account = 'owner-b';context.productRevision++;context.productRequestAbort.abort(new DOMException('Account changed', 'AbortError'));context.productRequestAbort = new AbortController();},
    rows: () => JSON.parse(values.get(storageKey) || '{"records":[]}').records};
}

for (const change of ['video', 'selection', 'account']) test(`comment completion cannot reset a replacement draft after ${change} changes`, async () => {
  const entered = deferred(), response = deferred();
  const h = harness(async (_url, options) => {if (options.method === 'POST') {entered.resolve();await response.promise;return new Response('{}');}return new Response('[]');});
  const pending = h.submit();await entered.promise;
  if (change === 'video') h.context.currentVideo = {id: 'second'};
  if (change === 'selection') h.context.playbackSelectionRevision++;
  if (change === 'account') h.retire();
  h.input.value = 'replacement draft';response.resolve();await pending;
  assert.equal(h.input.value, 'replacement draft');assert.equal(h.form.resets, 0);
  assert.equal(h.notices.length, 0);assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].body, '{"body":"original draft"}');
  assert.ok(h.requests[0].headers['Idempotency-Key']);
  if (change === 'account') assert.equal(h.rows()[0].key, h.requests[0].headers['Idempotency-Key']);
  else assert.equal(h.rows().length, 0);
});

test('comment completion preserves a draft edited while its original POST was pending', async () => {
  const entered = deferred(), response = deferred();
  const h = harness(async (_url, options) => {if (options.method === 'POST') {entered.resolve();await response.promise;return new Response('{}');}return new Response('[]');});
  const pending = h.submit();await entered.promise;h.input.value = 'next draft';response.resolve();await pending;
  assert.equal(h.input.value, 'next draft');assert.equal(h.form.resets, 0);assert.equal(h.rows().length, 0);
  assert.equal(h.requests.filter(row => row.method === 'POST').length, 1);
  assert.deepEqual(h.notices, [['Comment persisted.']]);
});

test('comment success cannot notify a new account after the public comments reload await', async () => {
  const entered = deferred(), response = deferred();
  const h = harness(async (_url, options) => {if (options.method === 'POST') return new Response('{}');entered.resolve();await response.promise;return new Response('[]');});
  const pending = h.submit();await entered.promise;assert.equal(h.form.resets, 1);h.retire();h.input.value = 'new owner draft';response.resolve();await pending;
  assert.equal(h.input.value, 'new owner draft');assert.equal(h.notices.length, 0);
  assert.equal(h.rows().length, 0);assert.equal(h.requests.filter(row => row.method === 'POST').length, 1);
});

test('retired comment UNKNOWN cannot notify or replay; reinitialization retains the original key and fence', async () => {
  const entered = deferred(), response = deferred();
  const h = harness(async () => {entered.resolve();await response.promise;throw new TypeError('response lost after service commit');});
  const pending = h.submit();await entered.promise;h.context.currentVideo = {id: 'second'};h.input.value = 'replacement draft';response.resolve();await pending;
  const original = h.requests[0].headers['Idempotency-Key'];
  assert.equal(h.notices.length, 0);assert.equal(h.form.resets, 0);assert.equal(h.input.value, 'replacement draft');
  assert.equal(h.rows()[0].key, original);assert.equal(h.rows()[0].state, 'UNKNOWN');
  h.initialize();h.context.currentVideo = {id: 'first'};await h.submit();
  assert.equal(h.requests.length, 1);assert.equal(h.rows()[0].key, original);assert.equal(h.rows()[0].state, 'UNKNOWN');
  assert.equal(h.mintedKeys.length, 1);assert.equal(h.mintedKeys[0], original);
  assert.equal(h.form.resets, 0);assert.equal(h.notices.length, 1);assert.equal(h.notices[0][1], true);
});

test('current comment completion clears its original draft once, reloads and reports success', async () => {
  const h = harness(async (_url, options) => new Response(options.method === 'POST' ? '{}' : '[{"Author":"owner-a","Body":"original draft"}]'));
  await h.submit();
  assert.equal(h.form.resets, 1);assert.equal(h.input.value, '');assert.equal(h.rows().length, 0);
  assert.deepEqual(h.notices, [['Comment persisted.']]);
  assert.equal(h.requests.length, 2);assert.equal(h.requests[0].method, 'POST');assert.equal(h.requests[1].method, 'GET');
  assert.equal(h.requests[0].headers['Idempotency-Key'], h.mintedKeys[0]);assert.equal(h.mintedKeys.length, 1);
  assert.match(h.commentBox.innerHTML, /original draft/);
});
