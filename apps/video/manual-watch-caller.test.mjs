import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {webcrypto, randomUUID} from 'node:crypto';
import {createVideoAPI} from './video-api.js';
import {createWatchProgress} from './watch-progress.js';

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
  const notices = [], requests = [], batches = [];
  const context = vm.createContext({DOMException, AbortSignal, AbortController, Error,
    productRevision: 1, playbackSelectionRevision: 1, productSignOutPending: false,
    productRequestAbort: new AbortController(), currentVideo: {id: 'first'}, account: 'owner-a',
    productConnected: () => true, notice: (...args) => notices.push(args)});
  let api;
  const initialize = () => api = createVideoAPI({baseURL: 'https://video.ynxweb4.com/video/api', environment,
    getAccount: () => context.account, requestId: () => assert.fail('watch must provide its original batch key'),
    authorize: async () => ({}), fetch: async (url, options) => {requests.push({url, ...options});return fetch(url, options);}});
  initialize();context.api = (...args) => api(...args);
  // Execute unchanged production privateAPI and manual flushWatch bodies.
  vm.runInContext(slice('const privateAPI = async', '\nconst playlistJournal=') + '\n' +
    slice('async function flushWatch(', '\nasync function showSubscriptions'), context);
  const privateAPI = vm.runInContext('privateAPI', context);
  const makeTracker = () => {
    const account = context.account, revision = context.productRevision, target = context.currentVideo;
    let now = 0;
    const tracker = createWatchProgress({clock: () => now, idFactory: randomUUID,
      signedIn: () => account === context.account && revision === context.productRevision,
      send: (body, {idempotencyKey}) => {batches.push({body, idempotencyKey});return privateAPI(`/v1/videos/${target.id}/watch`,
        {method: 'POST', headers: {'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey}, body: JSON.stringify(body)});}});
    tracker.sample({position: 0, paused: false, seeking: false});now = 1000;tracker.sample({position: 1, paused: false, seeking: false});
    return tracker;
  };
  context.watchProgress = makeTracker();
  return {context, notices, requests, batches, initialize, makeTracker,
    flush: completed => vm.runInContext(`flushWatch(${!!completed})`, context),
    retire() {context.account = 'owner-b';context.productRevision++;context.productRequestAbort.abort(new DOMException('Account changed', 'AbortError'));context.productRequestAbort = new AbortController();},
    rows: () => JSON.parse(values.get(storageKey) || '{"records":[]}').records};
}

for (const change of ['tracker', 'video', 'selection', 'account']) test(`manual watch failure cannot notify after ${change} retires its caller`, async () => {
  const entered = deferred(), response = deferred();
  const h = harness(async () => {entered.resolve();await response.promise;throw new TypeError('response lost after original watch commit');});
  const originalTracker = h.context.watchProgress;
  const pending = h.flush();await entered.promise;
  if (change === 'tracker') h.context.watchProgress = h.makeTracker();
  if (change === 'video') h.context.currentVideo = {id: 'second'};
  if (change === 'selection') h.context.playbackSelectionRevision++;
  if (change === 'account') h.retire();
  response.resolve();await pending;
  assert.equal(h.notices.length, 0);assert.equal(h.requests.length, 1);assert.equal(h.batches.length, 1);
  assert.match(h.requests[0].url, /first\/watch$/);
  const key = h.batches[0].idempotencyKey;
  assert.equal(h.requests[0].headers['Idempotency-Key'], key);assert.equal(h.rows()[0].key, key);
  assert.equal(h.requests[0].body, JSON.stringify(h.batches[0].body));assert.ok(Object.isFrozen(h.batches[0].body));
  assert.deepEqual([h.batches[0].body.seconds, h.batches[0].body.completed], [1, false]);
  if (change !== 'account') {
    let unknown;await assert.rejects(originalTracker.flush(true), error => {unknown = error;return error.code === 'VIDEO_MUTATION_UNKNOWN';});
    assert.equal(unknown.pending.key, key);assert.equal(unknown.pending.body, h.requests[0].body);
    assert.equal(h.rows()[0].state, 'UNKNOWN');
    await assert.rejects(originalTracker.flush(), error => error === unknown);
  }
  assert.equal(h.requests.length, 1);assert.equal(h.batches.length, 1);
});

test('current manual watch UNKNOWN is shown and reinitialization retains the original durable fence without replay', async () => {
  const h = harness(async () => {throw new TypeError('original response lost');});await h.flush();
  assert.equal(h.notices.length, 1);assert.equal(h.notices[0][1], true);assert.match(h.notices[0][0], /result unconfirmed/);
  const key = h.requests[0].headers['Idempotency-Key'];let unknown;
  await assert.rejects(h.context.watchProgress.flush(), error => {unknown = error;return error.code === 'VIDEO_MUTATION_UNKNOWN';});
  assert.equal(unknown.pending.key, key);assert.equal(h.rows()[0].state, 'UNKNOWN');
  h.initialize();h.context.watchProgress = h.makeTracker();await h.flush();
  assert.equal(h.requests.length, 1);assert.equal(h.rows()[0].key, key);assert.equal(h.rows()[0].state, 'UNKNOWN');
  assert.equal(h.notices.length, 2);assert.ok(h.notices.every(row => /result unconfirmed/.test(row[0])));
});

test('current manual watch acknowledgement clears its batch and does not send an unchanged flush again', async () => {
  const h = harness(async () => new Response('{}'));await h.flush();await h.flush();
  assert.equal(h.requests.length, 1);assert.equal(h.batches.length, 1);assert.equal(h.notices.length, 0);assert.equal(h.rows().length, 0);
  assert.equal(h.requests[0].headers['Idempotency-Key'], h.batches[0].idempotencyKey);
});
