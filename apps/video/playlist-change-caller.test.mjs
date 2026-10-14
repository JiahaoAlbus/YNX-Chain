import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {webcrypto, randomUUID} from 'node:crypto';
import {createVideoAPI} from './video-api.js';
import {recoverPlaylistOperation} from './playlist-recovery.js';
const source = await readFile(process.env.YNX_VIDEO_APP_SOURCE || new URL('./app.js', import.meta.url), 'utf8');
const slice = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
const deferred = () => {let resolve;const promise = new Promise(done => resolve = done);return {promise, resolve};};
const storageKey = 'ynx.video.pending-mutations.v1';
function harness(action, held = false, failRead = false) {
  const values = new Map();let tail = Promise.resolve(), reads = 0;
  const environment = {isSecureContext: true, crypto: webcrypto,
    localStorage: {getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value)},
    navigator: {locks: {request: (name, {signal, mode}, callback) => {
      assert.equal(name, storageKey);assert.equal(mode, 'exclusive');
      const result = tail.then(() => {signal?.throwIfAborted();return callback({name, mode});});tail = result.catch(() => {});return result;
    }}}};
  const original = Object.freeze({key: 'video-playlist-change-' + randomUUID(), body: Object.freeze({action, playlistID: 'pl_owned', videoID: action === 'delete' ? null : 'vid_owned', name: 'original list'})});
  const entered = deferred(), release = deferred(), notices = [], requests = [], calls = [], disabledWrites = [];
  const changes = {children: [], replaceChildren() {this.children = [];}, append(...items) {this.children.push(...items);}};
  const button = {set disabled(value) {disabledWrites.push(value);}}, control = {};
  const journal = {
    async read(account, current) {
      calls.push({method: 'read', account});current();
      if (++reads === 2 && held) {entered.resolve();await release.promise;if (failRead) throw new Error('Late operation recovery storage failure');}
      return {pending: original, history: []};
    },
    async begin(account, body, current) {current();assert.equal(body, original.body);calls.push({method: 'begin', account, key: original.key});return original;},
    finish: () => assert.fail('UNKNOWN cannot finish original operation'),
  };
  const context = vm.createContext({DOMException, AbortSignal, AbortController, Error, encodeURIComponent, recoverPlaylistOperation,
    productRevision: 1, productSignOutPending: false, libraryEpoch: 1, epoch: 1, productRequestAbort: new AbortController(),
    productState: {session: {account: 'owner-a'}}, productConnected: () => true, playlistOperations: journal,
    id: action === 'delete' ? 'pl_owned' : 'vid_owned', playlistId: 'pl_owned', changes,
    article: {querySelector: () => control}, row: {querySelector: () => control},
    document: {createElement: () => ({dataset: {}})}, confirm: () => true, t: key => key,
    showPlaylists: () => assert.fail('UNKNOWN must not navigate'), showPlaylist: () => assert.fail('UNKNOWN must not navigate'),
    notice: (...args) => notices.push(args)});
  let api;
  const initialize = () => api = createVideoAPI({baseURL: 'https://video.ynxweb4.com/video/api', environment,
    getAccount: () => context.productState.session.account, requestId: () => assert.fail('original operation key required'),
    authorize: async () => ({}), fetch: async (url, options) => {
      requests.push({url, ...options});if (options.method === 'DELETE') throw new TypeError('Original operation response lost');
      return new Response('[{"ID":"pl_owned","Owner":"owner-a","Name":"original list","VideoIDs":["vid_owned"]}]');
    }});
  initialize();context.api = (...args) => api(...args);
  vm.runInContext(slice('const privateAPI = async', '\nconst playlistJournal=') + '\n' +
    slice('function playlistScope(', '\nasync function createOriginalPlaylist') + '\n' +
    slice('async function changeOriginalPlaylist(', '\nasync function renderPlaylistRecovery') + '\n' +
    'scope=playlistScope(()=>{if(epoch!==libraryEpoch)throw new DOMException("Video view changed.","AbortError");});', context);
  const start = source.indexOf(action === 'delete' ? 'article.querySelector(".delete-list").onclick =' : 'row.querySelector(".remove-saved").onclick=');
  const end = source.indexOf('\n      };', start) + '\n      };'.length;
  vm.runInContext(source.slice(start, end), context);
  return {context, entered, release, notices, requests, calls, original, changes, disabledWrites, initialize,
    submit: () => control.onclick({currentTarget: button}),
    retire(change) {if (change === 'account') {context.productState = {session: {account: 'owner-b'}};context.productRevision++;context.productRequestAbort.abort(new DOMException('Account changed', 'AbortError'));context.productRequestAbort = new AbortController();}else context.libraryEpoch++;},
    rows: () => JSON.parse(values.get(storageKey) || '{"records":[]}').records};
}

for (const action of ['delete', 'remove']) for (const change of ['account', 'epoch']) test(`${action} recovery second await cannot publish old UNKNOWN after ${change} retires the handler`, async () => {
  const h = harness(action, true, change === 'account');const pending = h.submit();await h.entered.promise;
  const beforeDisabled = [...h.disabledWrites];h.retire(change);h.changes.children = ['replacement recovery UI'];h.release.resolve();await pending;
  assert.equal(h.notices.length, 0);assert.deepEqual(h.disabledWrites, beforeDisabled);assert.deepEqual(h.changes.children, ['replacement recovery UI']);
  assert.deepEqual(h.calls.map(row => row.method), ['read', 'begin', 'read']);assert.ok(h.calls.every(row => row.account === 'owner-a'));
  const writes = h.requests.filter(row => row.method === 'DELETE');assert.equal(writes.length, 1);
  assert.match(writes[0].url, action === 'delete' ? /\/playlists\/pl_owned$/ : /\/playlists\/pl_owned\/videos\/vid_owned$/);
  assert.equal(writes[0].headers['Idempotency-Key'], h.original.key);assert.equal(h.rows()[0].key, h.original.key);assert.equal(h.rows()[0].state, 'UNKNOWN');
  assert.deepEqual(h.original.body, {action, playlistID: 'pl_owned', videoID: action === 'delete' ? null : 'vid_owned', name: 'original list'});
  assert.ok(Object.isFrozen(h.original.body));
});

for (const action of ['delete', 'remove']) test(`current ${action} UNKNOWN remains visible with original operation/key and no replay through API reinitialization`, async () => {
  const h = harness(action);await h.submit();const firstCause = h.rows()[0].firstCause;h.initialize();await h.submit();
  assert.equal(h.notices.length, 2);assert.ok(h.notices.every(row => row[1] === true && /result unconfirmed/.test(row[0])));
  assert.equal(h.requests.filter(row => row.method === 'DELETE').length, 1);assert.equal(h.rows()[0].key, h.original.key);
  assert.equal(h.rows()[0].state, 'UNKNOWN');assert.deepEqual(h.rows()[0].firstCause, firstCause);
  assert.deepEqual(h.disabledWrites, [true, false, true, false]);assert.ok(h.calls.filter(row => row.method === 'begin').every(row => row.key === h.original.key));
  assert.equal(h.original.body.action, action);assert.equal(h.original.body.playlistID, 'pl_owned');
});
