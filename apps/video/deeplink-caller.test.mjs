import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {createVideoAPI} from './video-api.js';
const source = await readFile(process.env.YNX_VIDEO_APP_SOURCE || new URL('./app.js', import.meta.url), 'utf8');
const slice = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
const deferred = () => {let resolve;const promise = new Promise(done => resolve = done);return {promise, resolve};};
const turn = () => new Promise(resolve => setImmediate(resolve));
async function harness({error = false, restored = false} = {}) {
  const entered = deferred(), fetchRelease = deferred(), catalog = deferred(), requests = [], promises = [], notices = [], events = new Map();let opens = 0, closes = 0, writes = 0;
  const nav = ['discover', 'subscriptions', 'playlists', 'history'].map(view => ({dataset: {view}}));
  const player = {open: false, showModal() {opens++;this.open = true;}, close() {closes++;this.open = false;}, addEventListener: (name, handler) => events.set(name, handler)};
  const search = {}, close = {}, channel = {}, privacy = {};
  const context = vm.createContext({URLSearchParams, DOMException, Error,
    location: {search: '?video=vid_linked' + (restored ? '&mediaView=channel&mediaPlaylist=pl_restore&mediaChannel=original-channel' : ''), hash: ''},
    playbackSelectionRevision: 0, navigationRevision: 0, libraryEpoch: 0, productRevision: 0, productState: {status: 'guest'},
    currentVideo: null, currentView: 'discover', currentPlaylist: null, currentChannelId: null, playlistTarget: null,
    activate() {}, t: key => key, startWatchProgress() {}, loadComments: async () => {}, refreshSubscriptionButton: async () => {}, flushWatch: async () => {},
    document: {querySelectorAll: () => nav, querySelector: () => ({})},
    $: selector => ({'#search': search, '#close': close, '#channel': channel, '#privacy': privacy, '#player': player,
      '#video': {pause() {}, replaceChildren() {}, removeAttribute() {}}, '#player-title': {}, '#player-state': {}, '#query': {value: 'new search'}})[selector],
    notice: (...args) => notices.push(args),
    loadVideos: () => {context.currentView = 'discover';context.libraryEpoch++;return catalog.promise;}});
  for (const [name, view] of [['showSubscriptions', 'subscriptions'], ['showPlaylists', 'playlists'], ['showHistory', 'history'], ['showSettings', 'settings'], ['showChannel', 'channel']]) context[name] = () => {context.currentView = view;context.libraryEpoch++;return Promise.resolve();};
  context.api = (path, options) => {
    const promise = api(path, options);promises.push(promise);promise.catch(() => {});return promise;
  };
  const api = createVideoAPI({baseURL: 'https://video.ynxweb4.com/video/api', requestId: () => assert.fail('guest deep link must not mint keys'),
    environment: {localStorage: {getItem: () => null, setItem: () => {writes++;assert.fail('deep link GET must not alter fences');}}},
    fetch: async (url, options) => {requests.push({url, ...options});entered.resolve();await fetchRelease.promise;
      return error ? new Response('{broken') : new Response(JSON.stringify({id: 'vid_linked', title: 'Linked video', status: 'published', variants: [], captions: []}));}});
  vm.runInContext(slice('async function openVideo(', '\nasync function loadComments') + '\n' +
    slice('$("#search").onsubmit =', '\n$("#close").onclick =') + '\n' +
    slice('$("#close").onclick =', '\n$("#video").addEventListener("timeupdate"') + '\n' +
    slice('$("#channel").onclick =', '\n$("#subscribe").onclick =') + '\n' +
    slice('const nav =', '\nclearLegacySession();') + '\n' +
    slice('const catalogReady =', '\nvoid restoreVideoAccount();'), context);
  await entered.promise;
  const settleAPI = async () => {await Promise.all(promises.map(promise => promise.catch(() => {})));await turn();};
  return {context, notices, requests, player, fetchRelease, catalog,
    finish: async () => {fetchRelease.resolve();catalog.resolve();await settleAPI();},
    failBeforeCatalog: async () => {fetchRelease.resolve();await settleAPI();},
    finishCatalog: async () => {catalog.resolve();await turn();},
    openNew: async () => {context.newVideo = {id: 'vid_new', title: 'New video', status: 'published', variants: [], captions: []};await vm.runInContext('openVideo(newVideo)', context);},
    retire: event => event === 'close' ? close.onclick() : events.get('cancel')(),
    history: () => nav.find(button => button.dataset.view === 'history').onclick({currentTarget: nav[3]}),
    search: () => search.onsubmit({preventDefault() {}}), state: () => ({opens, closes, writes})};
}
function assertOriginalGET(h) {assert.equal(h.requests.length, 1);assert.equal(h.requests[0].method, 'GET');assert.match(h.requests[0].url, /v1\/videos\/vid_linked$/);assert.equal(h.state().writes, 0);}

test('late startup linked video cannot replace a video opened through actual openVideo', async () => {
  const h = await harness();await h.openNew();const selection = h.context.playbackSelectionRevision;await h.finish();
  assert.equal(h.context.currentVideo.id, 'vid_new');assert.equal(h.context.playbackSelectionRevision, selection);assert.equal(h.state().opens, 1);assertOriginalGET(h);
});
for (const event of ['close', 'cancel']) test(`late startup linked success cannot reopen player after actual ${event}`, async () => {
  const h = await harness();h.retire(event);const selection = h.context.playbackSelectionRevision;await h.finish();
  assert.equal(h.player.open, false);assert.equal(h.context.currentVideo, null);assert.equal(h.context.playbackSelectionRevision, selection);assert.equal(h.state().opens, 0);assertOriginalGET(h);
});
test('late startup linked success cannot open after actual history navigation', async () => {
  const h = await harness();h.history();await h.finish();assert.equal(h.context.currentView, 'history');assert.equal(h.player.open, false);assert.equal(h.state().opens, 0);assertOriginalGET(h);
});
test('startup error waiting on catalog cannot notify after actual same-view search navigation', async () => {
  const h = await harness({error: true});await h.failBeforeCatalog();assert.equal(h.notices.length, 0);h.search();await h.finishCatalog();assert.equal(h.notices.length, 0);assertOriginalGET(h);
});
test('late startup error cannot notify after close retires the original selection', async () => {
  const h = await harness({error: true});h.retire('close');await h.finish();assert.equal(h.notices.length, 0);assert.equal(h.player.open, false);assertOriginalGET(h);
});
test('normal guest linked video survives synchronous restored mediaView/mediaPlaylist/mediaChannel', async () => {
  const h = await harness({restored: true});assert.equal(h.context.currentView, 'channel');assert.equal(h.context.currentPlaylist, 'pl_restore');assert.equal(h.context.currentChannelId, 'original-channel');await h.finish();assert.equal(h.player.open, true);assert.equal(h.context.currentVideo.id, 'vid_linked');assert.equal(h.notices.length, 0);assertOriginalGET(h);
});
test('ordinary Auth/library recovery does not cancel guest linked playback with unchanged navigation', async () => {
  const h = await harness({restored: true});h.context.productRevision++;h.context.libraryEpoch++;h.context.productState = {status: 'connected', session: {account: 'owner-a'}};await h.finish();assert.equal(h.player.open, true);assert.equal(h.context.currentVideo.id, 'vid_linked');assertOriginalGET(h);
});
test('current startup error waits for catalog and remains visible once it finishes', async () => {
  const h = await harness({error: true});await h.failBeforeCatalog();assert.equal(h.notices.length, 0);await h.finishCatalog();assert.equal(h.notices.length, 1);assert.equal(h.notices[0][1], true);assert.match(h.notices[0][0], /Invalid Video service response/);assertOriginalGET(h);
});
test('same discover view search retires startup ownership even when view string remains unchanged', async () => {
  const h = await harness();h.search();assert.equal(h.context.currentView, 'discover');await h.finish();assert.equal(h.player.open, false);assert.equal(h.state().opens, 0);assertOriginalGET(h);
});
