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
function harness({stage, create = false, unknown = false} = {}) {
  const values = new Map();let tail = Promise.resolve(), created = !create, added = false, operationReads = 0;
  const environment = {isSecureContext: true, crypto: webcrypto,
    localStorage: {getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value)},
    navigator: {locks: {request: (name, {signal, mode}, callback) => {
      assert.equal(name, storageKey);assert.equal(mode, 'exclusive');
      const result = tail.then(() => {signal?.throwIfAborted();return callback({name, mode});});tail = result.catch(() => {});return result;
    }}}};
  const draft = Object.freeze({key: 'video-playlist-' + randomUUID(), body: Object.freeze({Name: 'original list'})});
  const operation = Object.freeze({key: 'video-playlist-change-' + randomUUID(), body: Object.freeze({action: 'add', playlistID: 'pl_owned', videoID: 'vid_owned', name: 'original list'})});
  let draftPending = null, operationPending = null;
  const entered = deferred(), release = deferred(), notices = [], requests = [], calls = [], disabledWrites = [], events = new Map();
  const hold = async name => {if (stage === name) {entered.resolve();await release.promise;}};
  const journal = {
    async read(account, current) {current();calls.push({method: 'draft.read', account});await hold('open-journal');return {pending: draftPending, history: []};},
    async begin(account, name, current) {current();assert.equal(name, draft.body.Name);calls.push({method: 'draft.begin', account, key: draft.key});draftPending = draft;return draft;},
    async finish(account, row, current) {current();assert.equal(row, draft);calls.push({method: 'draft.finish', account});draftPending = null;},
  };
  const operations = {
    async read(account, current) {current();calls.push({method: 'operation.read', account});if (++operationReads === 1) await hold('save-preflight');return {pending: operationPending, history: []};},
    async begin(account, body, current) {current();assert.deepEqual(body, operation.body);calls.push({method: 'operation.begin', account, key: operation.key});operationPending = operation;return operation;},
    async finish(account, row, current) {current();assert.equal(row, operation);calls.push({method: 'operation.finish', account});operationPending = null;},
  };
  const input = {value: create ? draft.body.Name : '', disabled: false}, status = {textContent: ''};
  const choice = {value: 'pl_owned', children: [], replaceChildren() {this.children = [];}, append(option) {this.children.push(option);}};
  let opens = 0, closes = 0;
  const save = {set disabled(value) {disabledWrites.push(value);}}, openButton = {}, saveForm = {}, close = {};
  const player = {close() {}, addEventListener: (name, handler) => events.set(name, handler)};
  const picker = {showModal() {opens++;}, close() {closes++;}};
  const context = vm.createContext({DOMException, AbortSignal, AbortController, Error, createRecoveredPlaylist, recoverPlaylistOperation,
    productRevision: 1, playbackSelectionRevision: 1, productSignOutPending: false, productRequestAbort: new AbortController(),
    productState: {session: {account: 'owner-a'}}, currentVideo: {id: 'vid_owned'}, playlistTarget: null,
    productConnected: () => true, requireAccount: () => true, flushWatch: async () => {}, playlistJournal: journal, playlistOperations: operations,
    Option: function(text, value) {this.text = text;this.value = value;}, field: (row, lower, upper) => row[lower] ?? row[upper],
    $: selector => ({'#playlist': openButton, '#playlist-choice': choice, '#playlist-name': input, '#playlist-picker-status': status,
      '#playlist-save': save, '#playlist-picker': picker, '#playlist-save-form': saveForm, '#close': close, '#player': player, '#video': {pause() {}}})[selector],
    notice: (...args) => notices.push(args)});
  let api;
  const initialize = () => api = createVideoAPI({baseURL: 'https://video.ynxweb4.com/video/api', environment,
    getAccount: () => context.productState.session.account, requestId: () => assert.fail('original journal key required'), authorize: async () => ({}),
    fetch: async (url, options) => {
      requests.push({url, ...options});
      if (options.method === 'POST') {
        const isCreate = url.endsWith('/v1/playlists');await hold(isCreate ? 'create-post' : 'add-post');
        if (unknown) throw new TypeError('Original playlist response lost');
        if (isCreate) {created = true;return new Response(JSON.stringify({ID: 'pl_owned', Owner: 'owner-a', Name: draft.body.Name}));}
        added = true;return new Response('{"ok":true}');
      }
      await hold('open-get');return new Response(JSON.stringify(created ? [{ID: 'pl_owned', Owner: 'owner-a', Name: draft.body.Name, VideoIDs: added ? ['vid_owned'] : []}] : []));
    }});
  initialize();context.api = (...args) => api(...args);
  // Run unchanged normal scope/private calls, real helper wrappers and player/picker handlers.
  vm.runInContext(slice('const privateAPI = async', '\nconst playlistJournal=') + '\n' +
    slice('function playlistScope(', '\nasync function renderPlaylistOperations') + '\n' +
    slice('$("#close").onclick =', '\n$("#video").addEventListener("timeupdate"') + '\n' +
    slice('$("#playlist").onclick =', '\n$("#playlist-picker-close").onclick=') + '\n' +
    slice('$("#playlist-save-form").onsubmit=', '\n$("#report").onclick ='), context);
  context.playlistTarget = context.currentVideo;
  return {context, entered, release, notices, requests, calls, disabledWrites, input, status, choice, draft, operation, initialize,
    open: () => openButton.onclick(), save: () => saveForm.onsubmit({preventDefault() {}}),
    retire: event => event === 'close' ? close.onclick() : events.get('cancel')(),
    rows: () => JSON.parse(values.get(storageKey) || '{"records":[]}').records,
    state: () => ({draftPending, operationPending, opens, closes})};
}

for (const stage of ['open-get', 'open-journal']) test(`picker ${stage} cannot open or modify draft after actual player retirement`, async () => {
  const h = harness({stage});const pending = h.open();await h.entered.promise;const target = h.context.playlistTarget;
  h.retire(stage === 'open-get' ? 'close' : 'cancel');assert.equal(h.context.playlistTarget, target);h.input.value = 'replacement draft';h.release.resolve();await pending;
  assert.equal(h.state().opens, 0);assert.equal(h.input.value, 'replacement draft');assert.equal(h.notices.length, 0);assert.deepEqual(h.disabledWrites, []);
  assert.equal(h.requests.filter(row => row.method === 'POST').length, 0);assert.equal(h.rows().length, 0);
});

test('save preflight await cannot start a new write after actual close', async () => {
  const h = harness({stage: 'save-preflight'});const pending = h.save();await h.entered.promise;h.retire('close');h.status.textContent = 'replacement status';h.release.resolve();await pending;
  assert.equal(h.requests.length, 0);assert.equal(h.input.value, '');assert.equal(h.status.textContent, 'replacement status');assert.equal(h.state().closes, 0);assert.equal(h.notices.length, 0);assert.deepEqual(h.disabledWrites, [true]);
  assert.equal(h.state().operationPending, null);assert.equal(h.rows().length, 0);
});

test('save original add UNKNOWN cannot update retired picker and preserves original durable operation', async () => {
  const h = harness({stage: 'add-post', unknown: true});const pending = h.save();await h.entered.promise;h.retire('cancel');h.input.value = 'replacement draft';h.status.textContent = 'replacement status';h.release.resolve();await pending;
  assert.equal(h.input.value, 'replacement draft');assert.equal(h.status.textContent, 'replacement status');assert.equal(h.state().closes, 0);assert.equal(h.notices.length, 0);assert.deepEqual(h.disabledWrites, [true]);
  const writes = h.requests.filter(row => row.method === 'POST');assert.equal(writes.length, 1);assert.equal(writes[0].headers['Idempotency-Key'], h.operation.key);assert.equal(writes[0].body, '{"video_id":"vid_owned"}');
  assert.equal(h.state().operationPending, h.operation);assert.equal(h.rows()[0].key, h.operation.key);assert.equal(h.rows()[0].state, 'UNKNOWN');
});

test('save completed original create cannot clear new draft or continue to add after close', async () => {
  const h = harness({stage: 'create-post', create: true});const pending = h.save();await h.entered.promise;h.retire('close');h.input.value = 'replacement draft';h.release.resolve();await pending;
  assert.equal(h.input.value, 'replacement draft');assert.equal(h.state().closes, 0);assert.equal(h.notices.length, 0);assert.deepEqual(h.disabledWrites, [true]);
  assert.equal(h.requests.filter(row => row.method === 'POST').length, 1);assert.equal(h.requests[0].headers['Idempotency-Key'], h.draft.key);
  assert.equal(h.state().draftPending, h.draft);assert.equal(h.state().operationPending, null);assert.equal(h.rows().length, 0, 'complete original HTTP response remains complete despite retired caller');
});

test('current add succeeds with original body/key and normal picker close/notice', async () => {
  const h = harness();await h.save();assert.equal(h.state().closes, 1);assert.deepEqual(h.notices, [['Video saved to your playlist.']]);
  const writes = h.requests.filter(row => row.method === 'POST');assert.equal(writes.length, 1);assert.equal(writes[0].headers['Idempotency-Key'], h.operation.key);assert.equal(h.state().operationPending, null);assert.equal(h.rows().length, 0);
});

test('current add UNKNOWN remains visible and preserves firstCause/key without replay through API reinitialization', async () => {
  const h = harness({unknown: true});await h.save();const firstCause = h.rows()[0].firstCause;h.initialize();await h.save();
  assert.match(h.status.textContent, /result unconfirmed/);assert.equal(h.state().closes, 0);assert.equal(h.notices.length, 0);assert.equal(h.requests.filter(row => row.method === 'POST').length, 1);
  assert.equal(h.state().operationPending, h.operation);assert.equal(h.rows()[0].key, h.operation.key);assert.deepEqual(h.rows()[0].firstCause, firstCause);assert.deepEqual(h.disabledWrites, [true, false, true, false]);
});

test('current create then add preserves distinct original journal keys and completes normal save', async () => {
  const h = harness({create: true});await h.save();const writes = h.requests.filter(row => row.method === 'POST');
  assert.deepEqual(writes.map(row => row.headers['Idempotency-Key']), [h.draft.key, h.operation.key]);assert.equal(writes[0].body, JSON.stringify(h.draft.body));assert.equal(writes[1].body, '{"video_id":"vid_owned"}');
  assert.equal(h.state().draftPending, null);assert.equal(h.state().operationPending, null);assert.equal(h.rows().length, 0);assert.equal(h.state().closes, 1);assert.deepEqual(h.notices, [['Video saved to your playlist.']]);
});
