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
function harness(fetch) {
  const values = new Map();let tail = Promise.resolve(), now = -1000;
  const environment = {isSecureContext: true, crypto: webcrypto,
    localStorage: {getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value)},
    navigator: {locks: {request: (name, {signal, mode}, callback) => {
      assert.equal(name, storageKey);assert.equal(mode, 'exclusive');
      const result = tail.then(() => {signal?.throwIfAborted();return callback({name, mode});});tail = result.catch(() => {});return result;
    }}}};
  const notices = [], requests = [], trackers = [], events = new Map();let pauseEvents = 0;
  class Media extends EventTarget {
    paused = false;seeking = false;playbackRate = 1;currentTime = 0;
    pause() {if (!this.paused) {this.paused = true;pauseEvents++;this.dispatchEvent(new Event('pause'));}}
    replaceChildren() {} removeAttribute() {}
  }
  const media = new Media(), close = {}, player = {open: true, close() {this.open = false;}, showModal() {this.open = true;}, addEventListener: (name, handler) => events.set(name, handler)};
  const context = vm.createContext({DOMException, AbortSignal, AbortController, Error,
    currentVideo: {id: 'vid_owned', title: 'Original', status: 'published', variants: [], captions: []}, watchProgress: null, watchProgressSelection: 0,
    playbackSelectionRevision: 1, productRevision: 1, productSignOutPending: false, productRequestAbort: new AbortController(),
    productState: {session: {account: 'owner-a'}}, productConnected: () => true, notice: (...args) => notices.push(args),
    loadComments: async () => {}, refreshSubscriptionButton: async () => {},
    $: selector => selector === '#player' ? player : selector === '#close' ? close : selector === '#video' ? media : {}});
  context.createWatchProgress = options => {
    const row = {tracker: null, batches: [], sends: [], callbacks: [], dispatched: deferred()};
    row.tracker = createWatchProgress({...options, clock: () => now, idFactory: randomUUID,
      send: (body, metadata) => {row.batches.push({body, metadata});const promise = options.send(body, metadata);row.sends.push(promise);promise.catch(() => {});return promise;},
      onError: error => {row.callbacks.push(error);return options.onError(error);}});
    trackers.push(row);return row.tracker;
  };
  let api;
  const initialize = () => api = createVideoAPI({baseURL: 'https://video.ynxweb4.com/video/api', environment,
    getAccount: () => context.productState.session.account, requestId: () => assert.fail('watch batch must provide original key'), authorize: async () => ({}),
    fetch: async (url, options) => {requests.push({url, ...options});trackers.find(row => row.batches.some(batch => batch.metadata.idempotencyKey === options.headers['Idempotency-Key']))?.dispatched.resolve();return fetch(url, options);}});
  initialize();context.api = (...args) => api(...args);
  // Run exact player lifecycle and media timeupdate/pause/ended handlers, including real flushWatch.
  vm.runInContext(slice('function invalidateProductRequests()', '\nlet productSignOutPending') + '\n' +
    slice('const privateAPI = async', '\nconst playlistJournal=') + '\n' +
    slice('function startWatchProgress(', '\nasync function loadComments') + '\n' +
    slice('async function flushWatch(', '\nasync function showSubscriptions') + '\n' +
    slice('const json =', '\nfunction notice') + '\n' +
    slice('$("#close").onclick =', '\n$("#channel").onclick ='), context);
  vm.runInContext('startWatchProgress(currentVideo)', context);
  const samples = async seconds => {
    for (let position = 0; position <= seconds; position++) {now += 1000;media.currentTime = position;media.paused = false;media.dispatchEvent(new Event('timeupdate'));}
    await turn();const row = trackers.at(-1);if (row.sends.length) await Promise.race([row.dispatched.promise, row.sends[0].then(() => {}, () => {})]);
  };
  const settle = async row => {assert.equal(row.sends.length, 1);const error = await row.sends[0].then(() => null, error => error);await turn();return error;};
  return {context, media, player, notices, requests, trackers, initialize, samples, settle,
    close: event => event === 'close' ? close.onclick() : events.get('cancel')(),
    pause: () => media.pause(), flush: () => vm.runInContext('flushWatch(false)', context),
    reopen: async same => {context.nextVideo = same ? context.currentVideo : {id: 'vid_new', title: 'New', status: 'published', variants: [], captions: []};await vm.runInContext('openVideo(nextVideo)', context);},
    retireAccount: () => {vm.runInContext('invalidateProductRequests()', context);context.productState = {session: {account: 'owner-b'}};},
    rows: () => JSON.parse(values.get(storageKey) || '{"records":[]}').records, pauseEvents: () => pauseEvents};
}
function assertOriginal(h, row, seconds, error) {
  assert.equal(row.batches.length, 1);const {body, metadata} = row.batches[0];assert.ok(Object.isFrozen(body));assert.deepEqual([body.seconds, body.completed], [seconds, false]);
  assert.equal(h.requests[0].body, JSON.stringify(body));assert.equal(h.requests[0].headers['Idempotency-Key'], metadata.idempotencyKey);assert.equal(h.requests[0].method, 'POST');assert.match(h.requests[0].url, /vid_owned\/watch$/);
  if (error) {assert.equal(error.code, 'VIDEO_MUTATION_UNKNOWN');assert.equal(error.pending.key, metadata.idempotencyKey);assert.equal(error.pending.body, h.requests[0].body);}
}

for (const event of ['close', 'cancel']) for (const follow of ['none', 'same-video', 'new-video']) test(`${event} actual pause/manual flush cannot publish old automatic UNKNOWN after ${follow}`, async () => {
  const response = deferred();const h = harness(async () => {await response.promise;throw new TypeError('original checkpoint response lost');});const old = h.trackers[0];await h.samples(15);h.close(event);
  assert.equal(h.pauseEvents(), 1, 'real modeled pause event must invoke exact production pause handler');
  if (follow !== 'none') await h.reopen(follow === 'same-video');response.resolve();const error = await h.settle(old);
  assert.equal(h.notices.length, 0);assert.equal(old.callbacks.length, 1, 'actual automatic catch also executes');assertOriginal(h, old, 15, error);
  assert.equal(h.rows()[0].key, old.batches[0].metadata.idempotencyKey);assert.equal(h.rows()[0].state, 'UNKNOWN');const cause = h.rows()[0].firstCause;
  await assert.rejects(old.tracker.flush(), value => value === error);await assert.rejects(old.tracker.flush(true), value => value === error);h.initialize();assert.equal(h.requests.length, 1);assert.equal(h.rows()[0].state, 'UNKNOWN');assert.deepEqual(h.rows()[0].firstCause, cause);
});

test('current ordinary pause manual UNKNOWN remains visible and preserves original 1-second batch/key with no replay', async () => {
  const h = harness(async () => {throw new TypeError('original manual response lost');});const row = h.trackers[0];await h.samples(1);h.pause();await row.dispatched.promise;const error = await h.settle(row);assertOriginal(h, row, 1, error);
  assert.equal(row.callbacks.length, 0, 'one-second save was manual, not automatic');assert.equal(h.notices.length, 1);assert.equal(h.notices[0][1], true);assert.match(h.notices[0][0], /result unconfirmed/);
  const cause = h.rows()[0].firstCause;h.initialize();await h.flush();assert.equal(h.notices.length, 2);assert.equal(h.requests.length, 1);assert.equal(h.rows()[0].key, row.batches[0].metadata.idempotencyKey);assert.deepEqual(h.rows()[0].firstCause, cause);await assert.rejects(row.tracker.flush(), value => value === error);
});

for (const event of ['close', 'cancel']) test(`${event} actual pause/manual flush still lets confirmed original checkpoint clean up exactly once`, async () => {
  const response = deferred();const h = harness(async () => {await response.promise;return new Response('{}');});const row = h.trackers[0];await h.samples(15);h.close(event);response.resolve();assert.equal(await h.settle(row), null);assertOriginal(h, row, 15);await row.tracker.flush();assert.equal(h.requests.length, 1);assert.equal(h.rows().length, 0);assert.equal(h.notices.length, 0);assert.equal(h.pauseEvents(), 1);
});

test('account retirement during real pause/manual wait suppresses UI and retains original dispatched fence without discard', async () => {
  const response = deferred();const h = harness(async () => {await response.promise;throw new TypeError('old response lost');});const row = h.trackers[0];await h.samples(15);h.pause();h.retireAccount();response.resolve();const error = await h.settle(row);assertOriginal(h, row, 15, error);assert.equal(h.notices.length, 0);assert.equal(h.requests.length, 1);assert.equal(h.rows()[0].key, row.batches[0].metadata.idempotencyKey);assert.ok(['DISPATCHED', 'UNKNOWN'].includes(h.rows()[0].state));
});

test('current ordinary pause confirms one legal second and repeats an empty flush without duplicate writes', async () => {
  const h = harness(async () => new Response('{}'));const row = h.trackers[0];await h.samples(1);h.pause();await row.dispatched.promise;assert.equal(await h.settle(row), null);assertOriginal(h, row, 1);await h.flush();assert.equal(h.requests.length, 1);assert.equal(h.rows().length, 0);assert.equal(h.notices.length, 0);assert.equal(h.pauseEvents(), 1);
});
