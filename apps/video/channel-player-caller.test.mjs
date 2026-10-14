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
const channelBody = {channel: {Name: 'Original Channel', Handle: 'original'}, videos: [], subscribers: 3};
function harness(fetch) {
  const values = new Map();let tail = Promise.resolve();
  const environment = {isSecureContext: true, crypto: webcrypto,
    localStorage: {getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value)},
    navigator: {locks: {request: (name, {signal, mode}, callback) => {
      assert.equal(name, storageKey);assert.equal(mode, 'exclusive');
      const result = tail.then(() => {signal?.throwIfAborted();return callback({name, mode});});tail = result.catch(() => {});return result;
    }}}};
  const notices = [], requests = [], keys = [], rendered = [], disabledWrites = [], active = [];
  let pauses = 0, closes = 0, pickerOpens = 0;
  const player = {open: true, close() {closes++;this.open = false;}, showModal() {this.open = true;}, addEventListener() {}};
  const media = {pause() {pauses++;}, replaceChildren() {}, removeAttribute() {}};
  const comments = {innerHTML: '', textContent: ''}, title = {textContent: '', removeAttribute() {}};
  const button = {dataset: {subscribed: 'false'}, textContent: 'Subscribe', set disabled(value) {disabledWrites.push(value);}};
  const pickerButton = {}, pickerInput = {value: '', disabled: false}, choice = {replaceChildren() {}, append() {}, value: ''};
  const context = vm.createContext({DOMException, AbortSignal, AbortController, Error, encodeURIComponent,
    productRevision: 1, playbackSelectionRevision: 1, subscriptionRevision: 0, commentsRevision: 0, productSignOutPending: false,
    libraryEpoch: 0, currentView: 'discover', productRequestAbort: new AbortController(), productState: {session: {account: 'owner-a'}},
    currentVideo: {id: 'vid_owned', channel_id: 'original-channel'}, playlistTarget: null,
    productConnected: () => true, requireAccount: () => true, activate() {}, startWatchProgress() {}, flushWatch: async () => {}, esc: value => value,
    renderVideos: (...args) => rendered.push(args), notice: (...args) => notices.push(args),
    field: (row, lower, upper) => row[lower] ?? row[upper], Option: function(text, value) {this.text = text;this.value = value;},
    playlistJournal: {read: async (_account, current) => {current();return {pending: null};}},
    playlistOperations: {read: async (_account, current) => {current();return {pending: null};}},
    $: selector => ({'#player': player, '#video': media, '#comments': comments, '#page-title': title, '#content': {setAttribute() {}},
      '#subscribe': button, '#playlist': pickerButton, '#playlist-choice': choice, '#playlist-name': pickerInput,
      '#playlist-picker-status': {}, '#playlist-save': {}, '#playlist-picker': {showModal() {pickerOpens++;}}, '#player-title': {}, '#player-state': {}})[selector]});
  let api;
  const initialize = () => api = createVideoAPI({baseURL: 'https://video.ynxweb4.com/video/api', environment, getAccount: () => 'owner-a',
    requestId: () => {const key = randomUUID();keys.push(key);return key;}, authorize: async () => ({}),
    fetch: async (url, options) => {requests.push({url, ...options});return fetch(url, options);}});
  initialize();context.api = (path, options) => {const promise = api(path, options);active.push({path, promise});return promise;};
  vm.runInContext(slice('const privateAPI = async', '\nconst playlistJournal=') + '\n' +
    slice('function playlistScope(', '\nasync function createOriginalPlaylist') + '\n' +
    slice('async function openVideo(', '\nasync function loadComments') + '\n' +
    slice('async function loadComments()', '\nasync function flushWatch') + '\n' +
    slice('async function refreshSubscriptionButton()', '\nasync function showPlaylists') + '\n' +
    slice('$("#subscribe").onclick =', '\n$("#playlist").onclick =') + '\n' +
    slice('$("#playlist").onclick =', '\n$("#playlist-picker-close").onclick='), context);
  return {context, notices, requests, keys, rendered, disabledWrites, player, media, comments, title, button, pickerInput, initialize,
    channel: () => vm.runInContext('showChannel("original-channel")', context),
    subscribe: () => button.onclick({currentTarget: button}), load: () => vm.runInContext('loadComments()', context), picker: () => pickerButton.onclick(),
    openNew: async () => {context.newVideo = {id: 'vid_new', title: 'New video', status: 'published', variants: [], captions: []};await vm.runInContext('openVideo(newVideo)', context);await Promise.all(active.filter(row => row.path !== '/v1/channels/original-channel').map(row => row.promise));},
    rows: () => JSON.parse(values.get(storageKey) || '{"records":[]}').records,
    state: () => ({pauses, closes, pickerOpens})};
}
const channelResponse = () => new Response(JSON.stringify(channelBody));

for (const unknown of [false, true]) test(`normal channel closure retires original selection before late subscription ${unknown ? 'UNKNOWN' : 'success'}`, async () => {
  const entered = deferred(), release = deferred();
  const h = harness(async (_url, options) => {if (options.method === 'PUT') {entered.resolve();await release.promise;if (unknown) throw new TypeError('original subscription response lost');return new Response('{}');}return channelResponse();});
  const pending = h.subscribe();await entered.promise;await h.channel();assert.equal(h.player.open, false);assert.equal(h.state().closes, 1);
  h.notices.length = 0;h.button.dataset.subscribed = 'replacement-state';h.button.textContent = 'replacement button';const beforeDisabled = [...h.disabledWrites];release.resolve();await pending;
  assert.equal(h.notices.length, 0);assert.equal(h.button.dataset.subscribed, 'replacement-state');assert.equal(h.button.textContent, 'replacement button');assert.deepEqual(h.disabledWrites, beforeDisabled);
  assert.equal(h.requests.filter(row => row.method === 'PUT').length, 1);assert.equal(h.keys.length, 1);
  if (unknown) {const cause = h.rows()[0].firstCause;assert.equal(h.rows()[0].key, h.keys[0]);assert.equal(h.rows()[0].state, 'UNKNOWN');h.button.dataset.subscribed = 'false';h.initialize();await h.subscribe();assert.equal(h.requests.filter(row => row.method === 'PUT').length, 1);assert.equal(h.keys.length, 1);assert.deepEqual(h.rows()[0].firstCause, cause);}else assert.equal(h.rows().length, 0);
});

test('normal channel closure prevents prior comments GET from writing into retired player', async () => {
  const entered = deferred(), release = deferred();
  const h = harness(async url => {if (url.endsWith('/comments')) {entered.resolve();await release.promise;return new Response('[{"Author":"old","Body":"old body"}]');}return channelResponse();});
  const pending = h.load();await entered.promise;await h.channel();h.comments.innerHTML = 'replacement comments';release.resolve();await pending;
  assert.equal(h.comments.innerHTML, 'replacement comments');assert.equal(h.requests.length, 2);assert.ok(h.requests.every(row => row.method === 'GET'));assert.equal(h.keys.length, 0);
});

test('normal channel closure prevents a prior picker GET from opening or overwriting draft', async () => {
  const entered = deferred(), release = deferred();
  const h = harness(async url => {if (url.endsWith('/playlists')) {entered.resolve();await release.promise;return new Response('[]');}return channelResponse();});
  const pending = h.picker();await entered.promise;await h.channel();h.pickerInput.value = 'replacement draft';release.resolve();await pending;
  assert.equal(h.state().pickerOpens, 0);assert.equal(h.pickerInput.value, 'replacement draft');assert.equal(h.requests.length, 2);assert.ok(h.requests.every(row => row.method === 'GET'));assert.equal(h.keys.length, 0);
});

test('old channel response cannot close a new player opened through actual openVideo', async () => {
  const entered = deferred(), release = deferred();
  const h = harness(async url => {if (url.endsWith('/channels/original-channel')) {entered.resolve();await release.promise;return channelResponse();}return new Response('[]');});
  const pending = h.channel();await entered.promise;await h.openNew();assert.equal(h.context.playbackSelectionRevision, 2);assert.equal(h.player.open, true);release.resolve();await pending;
  assert.equal(h.player.open, true);assert.equal(h.context.currentVideo.id, 'vid_new');assert.equal(h.context.playbackSelectionRevision, 2);assert.equal(h.state().closes, 0);assert.equal(h.state().pauses, 0);assert.equal(h.keys.length, 0);assert.ok(h.requests.every(row => row.method === 'GET'));
});

test('current channel navigation renders original response and closes its original player normally', async () => {
  const h = harness(async () => channelResponse());await h.channel();assert.equal(h.context.currentView, 'channel');assert.equal(h.title.textContent, 'Original Channel');assert.equal(h.rendered.length, 1);assert.equal(h.state().closes, 1);assert.equal(h.state().pauses, 1);assert.equal(h.player.open, false);assert.equal(h.requests.length, 1);assert.equal(h.keys.length, 0);
});
test('current channel error remains visible and does not close the current player', async () => {
  const h = harness(async () => new Response('{broken'));await h.channel();assert.equal(h.notices.length, 1);assert.equal(h.notices[0][1], true);assert.equal(h.player.open, true);assert.equal(h.state().closes, 0);assert.equal(h.requests.length, 1);assert.equal(h.keys.length, 0);
});
test('retired library epoch still suppresses an older channel body and player close', async () => {
  const entered = deferred(), release = deferred();const h = harness(async () => {entered.resolve();await release.promise;return channelResponse();});const pending = h.channel();await entered.promise;h.context.libraryEpoch++;release.resolve();await pending;assert.equal(h.rendered.length, 0);assert.equal(h.notices.length, 0);assert.equal(h.player.open, true);assert.equal(h.state().closes, 0);assert.equal(h.requests.length, 1);assert.equal(h.keys.length, 0);
});
