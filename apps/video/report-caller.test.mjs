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
function harness(fetch) {
  const values = new Map();let tail = Promise.resolve();
  const environment = {isSecureContext: true, crypto: webcrypto,
    localStorage: {getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value)},
    navigator: {locks: {request: (name, {signal, mode}, callback) => {
      assert.equal(name, storageKey);assert.equal(mode, 'exclusive');
      const result = tail.then(() => {signal?.throwIfAborted();return callback({name, mode});});tail = result.catch(() => {});return result;
    }}}};
  const notices = [], requests = [], mintedKeys = [], button = {};
  const context = vm.createContext({DOMException, AbortSignal, AbortController, Error,
    productRevision: 1, playbackSelectionRevision: 1, productSignOutPending: false,
    productRequestAbort: new AbortController(), currentVideo: {id: 'first'}, account: 'owner-a',
    productConnected: () => true, requireAccount: () => true, prompt: () => 'review original video',
    $: () => button, json: body => ({method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)}),
    notice: (...args) => notices.push(args)});
  let api;
  const initialize = () => api = createVideoAPI({baseURL: 'https://video.ynxweb4.com/video/api', environment,
    getAccount: () => context.account, requestId: () => {const key = randomUUID();mintedKeys.push(key);return key;},
    authorize: async () => ({}), fetch: async (url, options) => {requests.push({url, ...options});return fetch(url, options);}});
  initialize();context.api = (...args) => api(...args);
  // Execute exact production privateAPI and report handler bodies, unchanged.
  vm.runInContext(slice('const privateAPI = async', '\nconst playlistJournal=') + '\n' +
    slice('$("#report").onclick =', '\n$("#comment").onsubmit ='), context);
  return {context, notices, requests, mintedKeys, initialize, submit: () => button.onclick(),
    retire() {context.account = 'owner-b';context.productRevision++;context.productRequestAbort.abort(new DOMException('Account changed', 'AbortError'));context.productRequestAbort = new AbortController();},
    rows: () => JSON.parse(values.get(storageKey) || '{"records":[]}').records};
}

for (const change of ['video', 'selection', 'account']) test(`retired report completion cannot notify after ${change} changes`, async () => {
  const entered = deferred(), response = deferred();
  const h = harness(async () => {entered.resolve();await response.promise;return new Response('{}');});
  const pending = h.submit();await entered.promise;
  if (change === 'video') h.context.currentVideo = {id: 'second'};
  if (change === 'selection') h.context.playbackSelectionRevision++;
  if (change === 'account') h.retire();
  response.resolve();await pending;
  assert.equal(h.notices.length, 0);assert.equal(h.requests.length, 1);
  assert.match(h.requests[0].url, /first\/reports$/);
  assert.deepEqual(JSON.parse(h.requests[0].body), {reason: 'review original video', details: 'Submitted from YNX Video viewer'});
  assert.equal(h.requests[0].headers['Idempotency-Key'], h.mintedKeys[0]);assert.equal(h.mintedKeys.length, 1);
  if (change === 'account') assert.equal(h.rows()[0].key, h.mintedKeys[0]);else assert.equal(h.rows().length, 0);
});

test('retired report UNKNOWN preserves its original key/fence and cannot replay after reinitialization', async () => {
  const entered = deferred(), response = deferred();
  const h = harness(async () => {entered.resolve();await response.promise;throw new TypeError('response lost after service commit');});
  const pending = h.submit();await entered.promise;h.context.currentVideo = {id: 'second'};response.resolve();await pending;
  assert.equal(h.notices.length, 0);const original = h.mintedKeys[0];
  assert.equal(h.rows()[0].key, original);assert.equal(h.rows()[0].state, 'UNKNOWN');
  h.initialize();h.context.currentVideo = {id: 'first'};await h.submit();
  assert.equal(h.requests.length, 1);assert.equal(h.mintedKeys.length, 1);
  assert.equal(h.rows()[0].key, original);assert.equal(h.rows()[0].state, 'UNKNOWN');
  assert.equal(h.notices.length, 1);assert.equal(h.notices[0][1], true);assert.match(h.notices[0][0], /result unconfirmed/);
});

test('current report success publishes once and clears its confirmed original fence', async () => {
  const h = harness(async () => new Response('{}'));await h.submit();
  assert.deepEqual(h.notices, [['Report submitted for human review. No automatic takedown occurred.']]);
  assert.equal(h.requests.length, 1);assert.equal(h.mintedKeys.length, 1);assert.equal(h.rows().length, 0);
});

test('current report UNKNOWN remains visible and blocks repeated submission with its original key', async () => {
  const h = harness(async () => {throw new TypeError('original response lost');});await h.submit();await h.submit();
  assert.equal(h.notices.length, 2);assert.ok(h.notices.every(row => row[1] === true && /result unconfirmed/.test(row[0])));
  assert.equal(h.requests.length, 1);assert.equal(h.mintedKeys.length, 1);
  assert.equal(h.rows()[0].key, h.mintedKeys[0]);assert.equal(h.rows()[0].state, 'UNKNOWN');
});
