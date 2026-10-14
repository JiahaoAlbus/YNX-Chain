import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {webcrypto, randomUUID} from 'node:crypto';
import {createVideoAPI} from './video-api.js';
import {createRecoveredPlaylist, recoverPlaylistOperation} from './playlist-recovery.js';
const source = await readFile(process.env.YNX_VIDEO_APP_SOURCE || new URL('./app.js', import.meta.url), 'utf8');
const slice = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
const deferred = () => {let resolve;const promise = new Promise(done => resolve = done);return {promise, resolve};};
const storageKey = 'ynx.video.pending-mutations.v1';
function harness({stage, unknown = false, playerOpen = true, pickerOpen = false, connected = true, status = 'connected'} = {}) {
  const values = new Map();let tail = Promise.resolve(), added = false;
  const environment = {isSecureContext: true, crypto: webcrypto,
    localStorage: {getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value)},
    navigator: {locks: {request: (name, {signal, mode}, callback) => {
      assert.equal(name, storageKey);assert.equal(mode, 'exclusive');
      const result = tail.then(() => {signal?.throwIfAborted();return callback({name, mode});});tail = result.catch(() => {});return result;
    }}}};
  const operation = Object.freeze({key: 'video-playlist-change-' + randomUUID(), body: Object.freeze({action: 'add', playlistID: 'pl_owned', videoID: 'vid_owned', name: 'original list'})});
  const entered = deferred(), release = deferred(), notices = [], requests = [], keys = [], disabledWrites = [];
  let closes = 0, pickerCloses = 0, pickerOpens = 0, pauses = 0, focused = 0, scrolled = 0, prepares = 0, operationPending = null;
  const player = {open: playerOpen, close() {closes++;this.open = false;}};
  const picker = {open: pickerOpen, close() {pickerCloses++;this.open = false;}, showModal() {pickerOpens++;this.open = true;}};
  const button = {dataset: {subscribed: 'false'}, textContent: 'Subscribe', set disabled(value) {disabledWrites.push(value);}};
  const openButton = {}, saveForm = {}, input = {value: '', disabled: false}, pickerStatus = {textContent: ''}, choice = {value: 'pl_owned', replaceChildren() {}, append() {}};
  const hold = async name => {if (stage === name) {entered.resolve();await release.promise;}};
  const context = vm.createContext({DOMException, AbortSignal, AbortController, Error, encodeURIComponent, createRecoveredPlaylist, recoverPlaylistOperation,
    productRevision: 1, playbackSelectionRevision: 1, subscriptionRevision: 0, commentsRevision: 0, productSignOutPending: false,
    productRequestAbort: new AbortController(), productState: {status, session: {account: 'owner-a'}}, currentVideo: {id: 'vid_owned', channel_id: 'original-channel'},
    playlistTarget: null, returnPlayerVideo: 'remembered', productConnected: () => connected, requireAccount: () => true, esc: value => value,
    prepareVideoSignIn: () => {prepares++;return Promise.resolve('prepared existing sign-in');},
    field: (row, lower, upper) => row[lower] ?? row[upper], Option: function(text, value) {this.text = text;this.value = value;},
    playlistJournal: {read: async (_account, current) => {current();return {pending: null};}},
    playlistOperations: {
      async read(_account, current) {current();await hold('save-preflight');return {pending: operationPending, history: []};},
      async begin(_account, body, current) {current();assert.deepEqual(body, operation.body);operationPending = operation;return operation;},
      async finish(_account, row, current) {current();assert.equal(row, operation);operationPending = null;},
    },
    $: selector => ({'#player': player, '#video': {pause() {pauses++;}}, '#playlist-picker': picker,
      '#video-account': {scrollIntoView() {scrolled++;}}, '#product-connect': {focus() {focused++;}}, '#subscribe': button,
      '#comments': context.comments, '#playlist': openButton, '#playlist-save-form': saveForm, '#playlist-name': input,
      '#playlist-picker-status': pickerStatus, '#playlist-choice': choice, '#playlist-save': button})[selector],
    notice: (...args) => notices.push(args)});
  context.comments = {innerHTML: 'original comments', textContent: ''};
  let api;
  const initialize = () => api = createVideoAPI({baseURL: 'https://video.ynxweb4.com/video/api', environment, getAccount: () => 'owner-a',
    requestId: () => {const key = randomUUID();keys.push(key);return key;}, authorize: async () => ({}),
    fetch: async (url, options) => {
      requests.push({url, ...options});
      if (options.method === 'PUT') {await hold('subscription');if (unknown) throw new TypeError('Original subscription response lost');return new Response('{}');}
      if (options.method === 'POST') {added = true;return new Response('{"ok":true}');}
      if (url.endsWith('/comments')) {await hold('comments');return new Response('[{"Author":"old","Body":"old body"}]');}
      await hold('picker');return new Response(JSON.stringify([{ID: 'pl_owned', Owner: 'owner-a', Name: 'original list', VideoIDs: added ? ['vid_owned'] : []}]));
    }});
  initialize();context.api = (...args) => api(...args);
  vm.runInContext(slice('const privateAPI = async', '\nconst playlistJournal=') + '\n' +
    slice('function playlistScope(', '\nasync function renderPlaylistOperations') + '\n' +
    slice('function focusSignIn()', '\nfunction requireAccount') + '\n' +
    slice('async function loadComments()', '\nasync function flushWatch') + '\n' +
    slice('$("#subscribe").onclick =', '\n$("#playlist").onclick =') + '\n' +
    slice('$("#playlist").onclick =', '\n$("#playlist-picker-close").onclick=') + '\n' +
    slice('$("#playlist-save-form").onsubmit=', '\n$("#report").onclick ='), context);
  return {context, entered, release, notices, requests, keys, disabledWrites, player, picker, button, input, pickerStatus, operation, initialize,
    focus: () => vm.runInContext('focusSignIn()', context), subscribe: () => button.onclick({currentTarget: button}),
    load: () => vm.runInContext('loadComments()', context), openPicker: () => openButton.onclick(),
    save: () => {context.playlistTarget = context.currentVideo;return saveForm.onsubmit({preventDefault() {}});},
    rows: () => JSON.parse(values.get(storageKey) || '{"records":[]}').records,
    state: () => ({closes, pickerCloses, pickerOpens, pauses, focused, scrolled, prepares, operationPending})};
}

for (const unknown of [false, true]) test(`focusSignIn closure retires pending subscription ${unknown ? 'UNKNOWN' : 'success'} without changing replacement UI`, async () => {
  const h = harness({stage: 'subscription', unknown});const pending = h.subscribe();await h.entered.promise;h.focus();
  assert.equal(h.context.returnPlayerVideo, 'vid_owned');assert.equal(h.state().focused, 1);assert.equal(h.state().scrolled, 1);assert.equal(h.state().prepares, 0);
  h.button.dataset.subscribed = 'replacement-state';h.button.textContent = 'replacement button';const before = [...h.disabledWrites];h.release.resolve();await pending;
  assert.equal(h.notices.length, 0);assert.equal(h.button.dataset.subscribed, 'replacement-state');assert.equal(h.button.textContent, 'replacement button');assert.deepEqual(h.disabledWrites, before);assert.equal(h.requests.length, 1);
  if (unknown) {const cause = h.rows()[0].firstCause;assert.equal(h.rows()[0].key, h.keys[0]);assert.equal(h.rows()[0].state, 'UNKNOWN');h.button.dataset.subscribed = 'false';h.initialize();await h.subscribe();assert.equal(h.requests.length, 1);assert.equal(h.keys.length, 1);assert.deepEqual(h.rows()[0].firstCause, cause);}else assert.equal(h.rows().length, 0);
});

test('focusSignIn player closure prevents prior comments GET from writing into replacement UI', async () => {
  const h = harness({stage: 'comments'});const pending = h.load();await h.entered.promise;h.focus();h.context.comments.innerHTML = 'replacement comments';h.release.resolve();await pending;
  assert.equal(h.context.comments.innerHTML, 'replacement comments');assert.equal(h.requests.length, 1);assert.equal(h.requests[0].method, 'GET');assert.equal(h.keys.length, 0);
});

test('focusSignIn retires pending picker target even when its modal/player was not yet open', async () => {
  const h = harness({stage: 'picker', playerOpen: false});const pending = h.openPicker();await h.entered.promise;h.focus();h.input.value = 'replacement draft';h.release.resolve();await pending;
  assert.equal(h.context.playlistTarget, null);assert.equal(h.context.playbackSelectionRevision, 1);assert.equal(h.state().pickerOpens, 0);assert.equal(h.input.value, 'replacement draft');assert.equal(h.requests.length, 1);assert.equal(h.keys.length, 0);
});

test('focusSignIn closing picker stops an unissued save after its journal preflight await', async () => {
  const h = harness({stage: 'save-preflight', playerOpen: false, pickerOpen: true});const pending = h.save();await h.entered.promise;h.focus();h.pickerStatus.textContent = 'replacement status';h.release.resolve();await pending;
  assert.equal(h.requests.length, 0);assert.equal(h.keys.length, 0);assert.equal(h.context.playlistTarget, null);assert.equal(h.state().operationPending, null);assert.equal(h.state().pickerCloses, 1);assert.equal(h.notices.length, 0);assert.equal(h.pickerStatus.textContent, 'replacement status');assert.deepEqual(h.disabledWrites, [true]);
});

test('current account entry still pauses/closes original surfaces, saves return video and focuses without preparing again', async () => {
  const h = harness({playerOpen: true, pickerOpen: true});h.focus();assert.equal(h.context.returnPlayerVideo, 'vid_owned');assert.equal(h.state().pauses, 1);assert.equal(h.state().closes, 1);assert.equal(h.state().pickerCloses, 1);assert.equal(h.state().focused, 1);assert.equal(h.state().scrolled, 1);assert.equal(h.state().prepares, 0);assert.equal(h.requests.length, 0);
});
test('guest account entry with no surfaces open preserves selection/return ID and delegates original preparation once', async () => {
  const h = harness({playerOpen: false, connected: false, status: 'guest'});assert.equal(await h.focus(), 'prepared existing sign-in');assert.equal(h.context.playbackSelectionRevision, 1);assert.equal(h.context.returnPlayerVideo, 'remembered');assert.equal(h.state().closes, 0);assert.equal(h.state().pickerCloses, 0);assert.equal(h.state().prepares, 1);assert.equal(h.state().focused, 1);assert.equal(h.state().scrolled, 1);assert.equal(h.requests.length, 0);
});
test('checking existing connected session still does not issue another preparation', async () => {
  const h = harness({playerOpen: false, connected: false, status: 'connected'});h.focus();assert.equal(h.state().prepares, 0);assert.equal(h.context.playbackSelectionRevision, 1);assert.equal(h.context.returnPlayerVideo, 'remembered');assert.equal(h.requests.length, 0);
});
