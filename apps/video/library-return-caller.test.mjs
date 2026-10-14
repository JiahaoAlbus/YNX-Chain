import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {createVideoAPI} from './video-api.js';
const source = await readFile(process.env.YNX_VIDEO_APP_SOURCE || new URL('./app.js', import.meta.url), 'utf8');
const slice = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
const deferred = () => {let resolve;const promise = new Promise(done => resolve = done);return {promise, resolve};};
const channelBody = {channel: {Name: 'Original Channel', Handle: 'original'}, videos: [], subscribers: 3};
function harness(fetch, {view = 'channel', connected = true} = {}) {
  const requests = [], notices = [], rendered = [], active = [], routes = [];let opens = 0, closes = 0, pauses = 0, prepares = 0, storageWrites = 0;
  const player = {open: true, showModal() {opens++;this.open = true;}, close() {closes++;this.open = false;}, addEventListener() {}};
  const media = {pause() {pauses++;}, replaceChildren() {}, removeAttribute() {}};
  const title = {textContent: '', removeAttribute() {}}, comments = {innerHTML: '', textContent: ''}, subscribe = {dataset: {subscribed: 'false'}};
  const context = vm.createContext({DOMException, AbortSignal, AbortController, Error,
    productRevision: 1, playbackSelectionRevision: 1, subscriptionRevision: 0, commentsRevision: 0, productSignOutPending: false,
    libraryEpoch: 0, currentView: view, currentChannelId: 'original-channel', currentPlaylist: null, playlistTarget: null, returnPlayerVideo: null,
    productRequestAbort: new AbortController(), productState: {status: connected ? 'connected' : 'guest', session: connected ? {account: 'owner-a'} : undefined},
    currentVideo: {id: 'vid_owned', channel_id: 'original-channel'}, productConnected: () => connected,
    activate() {}, startWatchProgress() {}, flushWatch: async () => {}, esc: value => value, field: (row, lower, upper) => row[lower] ?? row[upper],
    prepareVideoSignIn: () => {prepares++;return Promise.resolve('original preparation');}, renderVideos: (...args) => rendered.push(args), notice: (...args) => notices.push(args),
    document: {querySelector: () => ({})},
    $: selector => ({'#player': player, '#video': media, '#page-title': title, '#comments': comments, '#subscribe': subscribe,
      '#playlist-picker': {open: false}, '#content': {setAttribute() {}}, '#video-account': {scrollIntoView() {}}, '#product-connect': {focus() {}}, '#player-title': {}, '#player-state': {}})[selector]});
  for (const name of ['showSubscriptions', 'showPlaylist', 'showPlaylists', 'showHistory', 'showSettings']) context[name] = async () => {routes.push(name);context.libraryEpoch++;return 'original library result';};
  const api = createVideoAPI({baseURL: 'https://video.ynxweb4.com/video/api', getAccount: () => context.productState.session?.account ?? null, authorize: async () => ({}),
    requestId: () => assert.fail('library return must not mint write keys'), environment: {localStorage: {getItem: () => null, setItem: () => {storageWrites++;assert.fail('read cannot modify durable fences');}}},
    fetch: async (url, options) => {requests.push({url, ...options});return fetch(url, options);}});
  context.api = (path, options) => {const promise = api(path, options);active.push({path, promise});return promise;};
  // Execute exact normal focus/refresh/channel/player/read functions; no real sign-in.
  vm.runInContext(slice('const privateAPI = async', '\nconst playlistJournal=') + '\n' +
    slice('function focusSignIn()', '\nfunction requireAccount') + '\n' +
    slice('async function refreshLibraryView()', '\nfunction beginLibrary') + '\n' +
    slice('async function openVideo(', '\nasync function loadComments') + '\n' +
    slice('async function loadComments()', '\nasync function flushWatch') + '\n' +
    slice('async function refreshSubscriptionButton()', '\nasync function showPlaylists'), context);
  return {context, requests, notices, rendered, routes, player, title,
    focus: () => vm.runInContext('focusSignIn()', context), refresh: () => vm.runInContext('refreshLibraryView()', context),
    openNew: async () => {context.newVideo = {id: 'vid_new', title: 'New video', status: 'published', variants: [], captions: []};await vm.runInContext('openVideo(newVideo)', context);await Promise.all(active.filter(row => row.path !== '/v1/channels/original-channel').map(row => row.promise));},
    state: () => ({opens, closes, pauses, prepares, storageWrites})};
}
const response = () => new Response(JSON.stringify(channelBody));
function assertReadOnly(h, count) {assert.equal(h.requests.length, count);assert.ok(h.requests.every(row => row.method === 'GET'));assert.equal(h.state().storageWrites, 0);}

test('focusSignIn to channel refresh reopens return video only after channel refresh and keeps it open', async () => {
  const entered = deferred(), release = deferred();const h = harness(async () => {entered.resolve();await release.promise;return response();});h.focus();
  assert.equal(h.context.returnPlayerVideo, 'vid_owned');const pending = h.refresh();await entered.promise;const waiting = {open: h.player.open, marker: h.context.returnPlayerVideo};release.resolve();await pending;
  assert.deepEqual(waiting, {open: false, marker: 'vid_owned'});assert.equal(h.player.open, true);assert.equal(h.context.returnPlayerVideo, null);assert.equal(h.state().closes, 1);assert.equal(h.state().opens, 1);assert.equal(h.title.textContent, 'Original Channel');assertReadOnly(h, 1);
});

for (const change of ['view', 'account']) test(`library return waiting channel refresh cannot open old player or consume new marker after ${change} changes`, async () => {
  const entered = deferred(), release = deferred();const h = harness(async () => {entered.resolve();await release.promise;return response();});h.focus();const pending = h.refresh();await entered.promise;
  const waitingOpen = h.player.open;
  if (change === 'view') {h.context.currentView = 'history';h.context.libraryEpoch++;}else {h.context.productState = {status: 'connected', session: {account: 'owner-b'}};h.context.productRevision++;}
  h.context.returnPlayerVideo = 'new-context-return';release.resolve();await pending;
  assert.equal(waitingOpen, false);assert.equal(h.player.open, false);assert.equal(h.context.returnPlayerVideo, 'new-context-return');assert.equal(h.state().opens, 0);assert.equal(h.state().closes, 1);assertReadOnly(h, 1);
});

test('old return refresh preserves new video marker after actual openVideo then focusSignIn', async () => {
  const entered = deferred(), release = deferred();const h = harness(async url => {if (url.endsWith('/channels/original-channel')) {entered.resolve();await release.promise;return response();}return new Response('[]');});h.focus();const pending = h.refresh();await entered.promise;
  await h.openNew();h.focus();const currentSelection = h.context.playbackSelectionRevision;assert.equal(h.context.returnPlayerVideo, 'vid_new');release.resolve();await pending;
  assert.equal(h.player.open, false);assert.equal(h.context.currentVideo.id, 'vid_new');assert.equal(h.context.returnPlayerVideo, 'vid_new');assert.equal(h.context.playbackSelectionRevision, currentSelection);assert.equal(h.state().closes, 2);assertReadOnly(h, 3);
});

test('new same-view refresh consumes its return marker once and old refresh cannot close its accepted player', async () => {
  const entered = deferred(), release = deferred();let channelCalls = 0;const h = harness(async () => {if (++channelCalls === 1) {entered.resolve();await release.promise;}return response();});h.focus();const old = h.refresh();await entered.promise;await h.refresh();const accepted = {open: h.player.open, marker: h.context.returnPlayerVideo, selection: h.context.playbackSelectionRevision};release.resolve();await old;
  assert.equal(accepted.open, true);assert.equal(accepted.marker, null);assert.equal(h.player.open, true);assert.equal(h.context.returnPlayerVideo, null);assert.equal(h.context.playbackSelectionRevision, accepted.selection);assert.equal(h.state().closes, 1);assert.equal(h.state().opens, 1);assertReadOnly(h, 2);
});

test('current channel error remains visible while its current return video opens', async () => {
  const h = harness(async () => new Response('{broken'));h.focus();await h.refresh();assert.equal(h.player.open, true);assert.equal(h.context.returnPlayerVideo, null);assert.equal(h.notices.length, 1);assert.equal(h.notices[0][1], true);assert.match(h.notices[0][0], /Invalid Video service response/);assertReadOnly(h, 1);
});

test('current other library delegation retains its result and reopens owned return video', async () => {
  const h = harness(async () => assert.fail('controlled library route does not use network'), {view: 'subscriptions'});h.focus();assert.equal(await h.refresh(), 'original library result');assert.deepEqual(h.routes, ['showSubscriptions']);assert.equal(h.player.open, true);assert.equal(h.context.returnPlayerVideo, null);assertReadOnly(h, 0);
});

test('guest discover return remains available without private reads or repeated preparation', async () => {
  const h = harness(async () => assert.fail('guest discover return needs no API'), {view: 'discover', connected: false});await h.focus();await h.refresh();assert.equal(h.player.open, true);assert.equal(h.context.returnPlayerVideo, null);assert.equal(h.context.currentVideo.id, 'vid_owned');assert.equal(h.state().prepares, 1);assertReadOnly(h, 0);
});
