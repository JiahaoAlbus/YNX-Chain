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
function harness(fetch, flushBoundary) {
  const values = new Map();let tail = Promise.resolve();
  const environment = {isSecureContext: true, crypto: webcrypto,
    localStorage: {getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value)},
    navigator: {locks: {request: (name, {signal, mode}, callback) => {
      assert.equal(name, storageKey);assert.equal(mode, 'exclusive');
      const result = tail.then(() => {signal?.throwIfAborted();return callback({name, mode});});tail = result.catch(() => {});return result;
    }}}};
  const notices = [], requests = [], keys = [], disabledWrites = [], cleared = [];
  const recovery = new Map([['playlist', 'original draft'], ['operation', 'original change']]);
  let disabled = false, discards = 0, refreshes = 0;
  const button = {set disabled(value) {disabled = value;disabledWrites.push(value);}, get disabled() {return disabled;}};
  const context = vm.createContext({DOMException, AbortSignal, AbortController, Error,
    productRevision: 1, playbackSelectionRevision: 1, productSignOutPending: false, libraryEpoch: 0, currentView: 'discover',
    productRequestAbort: new AbortController(), productState: {session: {account: 'owner-a'}}, currentVideo: null,
    currentPlaylist: 'original-playlist', productConnected: () => true, confirm: () => true,
    $: selector => selector === '#delete-viewer-data' ? button : selector === '#video' ? {pause() {}} : {},
    beginLibrary: view => {context.currentView = view;return ++context.libraryEpoch;},
    notice: (...args) => notices.push(args), refreshSubscriptionButton: async () => {refreshes++;},
    startWatchProgress: () => assert.fail('no selected video in this fixture')});
  const makeJournal = name => ({clear: async (account, current) => {current();assert.equal(account, 'owner-a');cleared.push(name);recovery.delete(name);current();}});
  // Scope-aware journal boundary records local recovery changes; not IndexedDB acceptance.
  context.playlistJournal = makeJournal('playlist');context.playlistOperations = makeJournal('operation');
  const tracker = createWatchProgress({send: () => assert.fail('no observed watch time'), signedIn: () => true, idFactory: randomUUID});
  const discard = tracker.discard;tracker.discard = () => {discards++;discard();};context.watchProgress = tracker;
  let api;
  const initialize = () => api = createVideoAPI({baseURL: 'https://video.ynxweb4.com/video/api', environment,
    getAccount: () => context.productState.session.account, requestId: () => {const key = randomUUID();keys.push(key);return key;},
    authorize: async () => ({}), fetch: async (url, options) => {requests.push({url, ...options});return fetch(url, options);}});
  initialize();context.api = (...args) => api(...args);
  vm.runInContext(slice('const privateAPI = async', '\nconst playlistJournal=') + '\n' +
    slice('function playlistScope(', '\nasync function createOriginalPlaylist') + '\n' +
    slice('async function flushWatch(', '\nasync function showSubscriptions') + '\n' +
    slice('function showSettings()', '\n$("#signin").onclick ='), context);
  if (flushBoundary) context.controlledFlush = flushBoundary;
  if (flushBoundary) vm.runInContext('flushWatch = controlledFlush', context);
  vm.runInContext('showSettings()', context);
  return {context, button, notices, requests, keys, disabledWrites, cleared, recovery, initialize,
    submit: () => button.onclick({currentTarget: button}),
    retire() {context.productState = {session: {account: 'owner-b'}};context.productRevision++;context.productRequestAbort.abort(new DOMException('Account changed', 'AbortError'));context.productRequestAbort = new AbortController();},
    rows: () => JSON.parse(values.get(storageKey) || '{"records":[]}').records,
    state: () => ({discards, refreshes, currentPlaylist: context.currentPlaylist})};
}

for (const change of ['account', 'view', 'epoch']) test(`privacy completion cannot change local recovery or publish after ${change} retires settings`, async () => {
  const entered = deferred(), response = deferred();
  const h = harness(async () => {entered.resolve();await response.promise;if (change === 'view') throw new TypeError('response lost after original delete');return new Response('{}');});
  const pending = h.submit();await entered.promise;
  if (change === 'account') h.retire();
  if (change === 'view') h.context.currentView = 'discover';
  if (change === 'epoch') h.context.libraryEpoch++;
  response.resolve();await pending;
  assert.equal(h.notices.length, 0);assert.deepEqual(h.disabledWrites, [true]);assert.equal(h.button.disabled, true);
  assert.equal(h.cleared.length, 0);assert.equal(h.recovery.size, 2);assert.equal(h.context.currentPlaylist, 'original-playlist');
  assert.equal(h.requests.length, 1);assert.equal(h.requests[0].method, 'DELETE');assert.match(h.requests[0].url, /privacy\/account-data$/);
  assert.equal(h.keys.length, 1);assert.equal(h.requests[0].headers['Idempotency-Key'], h.keys[0]);
  if (change !== 'epoch') assert.equal(h.rows()[0].key, h.keys[0]);else assert.equal(h.rows().length, 0);
});

test('settings retirement while its watch flush awaits prevents the privacy DELETE and local discard', async () => {
  const entered = deferred(), response = deferred();
  const h = harness(async () => assert.fail('retired settings must not delete'), async () => {entered.resolve();await response.promise;});
  const pending = h.submit();await entered.promise;h.context.currentView = 'history';response.resolve();await pending;
  assert.equal(h.requests.length, 0);assert.equal(h.keys.length, 0);assert.equal(h.state().discards, 0);assert.equal(h.rows().length, 0);
  assert.equal(h.notices.length, 0);assert.deepEqual(h.disabledWrites, [true]);assert.equal(h.recovery.size, 2);
});

test('current privacy UNKNOWN preserves local recovery and original fence across API reinitialization without replay', async () => {
  const h = harness(async () => {throw new TypeError('original response lost');});await h.submit();
  assert.equal(h.notices.length, 1);assert.match(h.notices[0][0], /result unconfirmed/);assert.equal(h.notices[0][1], true);
  assert.equal(h.recovery.size, 2);assert.equal(h.cleared.length, 0);assert.equal(h.context.currentPlaylist, 'original-playlist');
  const key = h.keys[0];assert.equal(h.rows()[0].key, key);assert.equal(h.rows()[0].state, 'UNKNOWN');
  h.initialize();await h.submit();assert.equal(h.requests.length, 1);assert.equal(h.keys.length, 1);
  assert.equal(h.rows()[0].key, key);assert.equal(h.rows()[0].state, 'UNKNOWN');assert.equal(h.recovery.size, 2);
  assert.equal(h.notices.length, 2);assert.equal(h.button.disabled, false);
});

test('current confirmed privacy DELETE clears scoped local recovery and restores its current button', async () => {
  const h = harness(async () => new Response('{}'));await h.submit();
  assert.equal(h.requests.length, 1);assert.equal(h.keys.length, 1);assert.equal(h.rows().length, 0);
  assert.deepEqual(h.cleared, ['playlist', 'operation']);assert.equal(h.recovery.size, 0);assert.equal(h.context.currentPlaylist, null);
  assert.deepEqual(h.notices, [['Your saved Video data was deleted.']]);assert.deepEqual(h.disabledWrites, [true, false]);
  assert.equal(h.state().discards, 1);assert.equal(h.state().refreshes, 1);
});
