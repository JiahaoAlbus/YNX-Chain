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
const turn = () => new Promise(done => setImmediate(done));
const storageKey = 'ynx.video.pending-mutations.v1';
function harness(fetch, {connected = true} = {}) {
  const values = new Map();let tail = Promise.resolve(), now = -1000;
  const environment = {isSecureContext: true, crypto: webcrypto,
    localStorage: {getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value)},
    navigator: {locks: {request: (name, {signal, mode}, callback) => {
      assert.equal(name, storageKey);assert.equal(mode, 'exclusive');
      const result = tail.then(() => {signal?.throwIfAborted();return callback({name, mode});});tail = result.catch(() => {});return result;
    }}}};
  const notices = [], requests = [], trackers = [], events = new Map();
  const player = {open: true, close() {this.open = false;}, showModal() {this.open = true;}, addEventListener: (name, handler) => events.set(name, handler)}, close = {};
  const context = vm.createContext({DOMException, AbortSignal, AbortController, Error,
    currentVideo: {id: 'vid_owned', title: 'Original', status: 'published', variants: [], captions: []}, watchProgress: null,
    playbackSelectionRevision: 1, productRevision: 1, productSignOutPending: false, productRequestAbort: new AbortController(),
    productState: {session: {account: 'owner-a'}}, productConnected: () => connected, notice: (...args) => notices.push(args),
    loadComments: async () => {}, refreshSubscriptionButton: async () => {}, flushWatch: async () => {},
    $: selector => selector === '#player' ? player : selector === '#close' ? close : selector === '#video' ? {pause() {}, replaceChildren() {}, removeAttribute() {}} : {}});
  // Inject only clock/IDs/observers at constructor boundary; run the real tracker.
  context.createWatchProgress = options => {
    const row = {tracker: null, batches: [], sends: [], callbacks: [], dispatched: deferred()};
    row.tracker = createWatchProgress({...options, clock: () => now, idFactory: randomUUID,
      send: (body, metadata) => {row.batches.push({body, metadata});const promise = options.send(body, metadata);row.sends.push(promise);promise.catch(() => {});return promise;},
      onError: error => {row.callbacks.push(error);return options.onError(error);}});
    trackers.push(row);return row.tracker;
  };
  let api;
  const initialize = () => api = createVideoAPI({baseURL: 'https://video.ynxweb4.com/video/api', environment,
    getAccount: () => context.productState.session.account, requestId: () => assert.fail('watch must retain original batch key'), authorize: async () => ({}),
    fetch: async (url, options) => {requests.push({url, ...options});trackers.find(row => row.batches.some(batch => batch.metadata.idempotencyKey === options.headers['Idempotency-Key']))?.dispatched.resolve();return fetch(url, options);}});
  initialize();context.api = (...args) => api(...args);
  vm.runInContext(slice('function invalidateProductRequests()', '\nlet productSignOutPending') + '\n' +
    slice('const privateAPI = async', '\nconst playlistJournal=') + '\n' +
    slice('function startWatchProgress(', '\nasync function loadComments') + '\n' +
    slice('const json =', '\nfunction notice') + '\n' +
    slice('$("#close").onclick =', '\n$("#video").addEventListener("timeupdate"'), context);
  vm.runInContext('startWatchProgress(currentVideo)', context);
  const checkpoint = async row => {
    for (let position = 0; position <= 15; position++) {now += 1000;row.tracker.sample({position, paused: false, seeking: false});}
    await turn();
    if (row.sends.length) await Promise.race([row.dispatched.promise, row.sends[0].then(() => {}, () => {})]);
  };
  const settle = async row => {assert.equal(row.sends.length, 1);const error = await row.sends[0].then(() => null, error => error);await turn();return error;};
  return {context, notices, requests, trackers, initialize, checkpoint, settle,
    retire: event => event === 'close' ? close.onclick() : events.get('cancel')(),
    reopen: async same => {context.nextVideo = same ? context.currentVideo : {id: 'vid_new', title: 'New', status: 'published', variants: [], captions: []};await vm.runInContext('openVideo(nextVideo)', context);},
    reinitializeTracker: () => vm.runInContext('startWatchProgress(currentVideo)', context),
    retireAccount: () => {vm.runInContext('invalidateProductRequests()', context);context.productState = {session: {account: 'owner-b'}};},
    rows: () => JSON.parse(values.get(storageKey) || '{"records":[]}').records};
}
function assertBatch(h, row, error) {
  assert.equal(row.batches.length, 1);const {body, metadata} = row.batches[0];assert.ok(Object.isFrozen(body));assert.deepEqual([body.seconds, body.completed], [15, false]);
  const request = h.requests.find(request => request.headers['Idempotency-Key'] === metadata.idempotencyKey);assert.ok(request);assert.equal(request.body, JSON.stringify(body));assert.equal(request.method, 'POST');
  if (error) {assert.equal(error.code, 'VIDEO_MUTATION_UNKNOWN');assert.equal(error.pending.key, metadata.idempotencyKey);assert.equal(error.pending.body, request.body);assert.equal(h.rows().find(row => row.key === metadata.idempotencyKey).state, 'UNKNOWN');}
}

for (const change of ['close', 'cancel', 'same-video', 'new-video', 'tracker']) test(`old automatic watch UNKNOWN cannot notify after ${change} retires its UI owner`, async () => {
  const response = deferred();const h = harness(async () => {await response.promise;throw new TypeError('original automatic response lost');});
  const old = h.trackers[0];await h.checkpoint(old);assert.equal(h.requests.length, 1);
  if (change === 'close' || change === 'cancel') h.retire(change);else if (change === 'tracker') h.reinitializeTracker();else await h.reopen(change === 'same-video');
  response.resolve();const error = await h.settle(old);assert.equal(h.notices.length, 0);assert.equal(old.callbacks.length, 1, 'real tracker automatic catch must invoke original onError');assertBatch(h, old, error);
  await assert.rejects(old.tracker.flush(), value => value === error);await assert.rejects(old.tracker.flush(true), value => value === error);assert.equal(h.requests.length, 1);assert.equal(old.batches.length, 1);
});

test('current automatic UNKNOWN stays visible and retains exact batch/key/firstCause through API reinitialization without replay', async () => {
  const h = harness(async () => {throw new TypeError('original automatic response lost');});const row = h.trackers[0];await h.checkpoint(row);const error = await h.settle(row);assertBatch(h, row, error);
  assert.equal(h.notices.length, 1);assert.equal(h.notices[0][1], true);assert.match(h.notices[0][0], /result unconfirmed/);
  const original = row.batches[0], cause = h.rows()[0].firstCause;h.initialize();h.reinitializeTracker();const current = h.trackers[1];await h.checkpoint(current);await h.settle(current);
  assert.equal(h.requests.length, 1);assert.equal(h.rows()[0].key, original.metadata.idempotencyKey);assert.deepEqual(h.rows()[0].firstCause, cause);assert.equal(h.rows()[0].state, 'UNKNOWN');assert.equal(h.notices.length, 2);
});

test('new video tracker can report its own automatic UNKNOWN while old tracker remains pending', async () => {
  const oldResponse = deferred();const h = harness(async url => {if (url.includes('/vid_owned/')) await oldResponse.promise;throw new TypeError('original automatic response lost');});
  const old = h.trackers[0];await h.checkpoint(old);await h.reopen(false);const current = h.trackers[1];await h.checkpoint(current);const currentError = await h.settle(current);
  assert.equal(h.notices.length, 1);assert.equal(current.callbacks.length, 1);assertBatch(h, current, currentError);
  oldResponse.resolve();const oldError = await h.settle(old);assert.equal(h.notices.length, 1);assertBatch(h, old, oldError);assert.equal(h.requests.length, 2);assert.equal(h.rows().length, 2);assert.notEqual(old.batches[0].metadata.idempotencyKey, current.batches[0].metadata.idempotencyKey);
});

test('account retirement preserves original dispatched key and suppresses automatic old-account UI without discard', async () => {
  const response = deferred();const h = harness(async () => {await response.promise;throw new TypeError('old response lost');});const row = h.trackers[0];await h.checkpoint(row);h.retireAccount();response.resolve();await h.settle(row);
  assert.equal(h.notices.length, 0);assert.equal(row.callbacks.length, 0, 'real tracker existing signedIn guard suppresses retired account');assert.equal(h.requests.length, 1);assert.equal(h.rows()[0].key, row.batches[0].metadata.idempotencyKey);assert.ok(['DISPATCHED', 'UNKNOWN'].includes(h.rows()[0].state));assertBatch(h, row);
});

test('current automatic confirmed checkpoint counts 15 legal seconds, clears its batch and emits no duplicate or notice', async () => {
  const h = harness(async () => new Response('{}'));const row = h.trackers[0];await h.checkpoint(row);assert.equal(await h.settle(row), null);assertBatch(h, row);await row.tracker.flush();assert.equal(h.requests.length, 1);assert.equal(row.batches.length, 1);assert.equal(h.rows().length, 0);assert.equal(h.notices.length, 0);
});
