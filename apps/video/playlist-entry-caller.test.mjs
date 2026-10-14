import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {webcrypto, randomUUID} from 'node:crypto';
import {createVideoAPI} from './video-api.js';
import {createRecoveredPlaylist} from './playlist-recovery.js';
const source = await readFile(process.env.YNX_VIDEO_APP_SOURCE || new URL('./app.js', import.meta.url), 'utf8');
const slice = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
const deferred = () => {let resolve;const promise = new Promise(done => resolve = done);return {promise, resolve};};
const storageKey = 'ynx.video.pending-mutations.v1';
function harness(kind, hold) {
  const values = new Map();let tail = Promise.resolve();
  const environment = {isSecureContext: true, crypto: webcrypto,
    localStorage: {getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value)},
    navigator: {locks: {request: (name, {signal, mode}, callback) => {
      assert.equal(name, storageKey);assert.equal(mode, 'exclusive');
      const result = tail.then(() => {signal?.throwIfAborted();return callback({name, mode});});tail = result.catch(() => {});return result;
    }}}};
  const original = Object.freeze({key: 'video-playlist-' + randomUUID(), body: Object.freeze({Name: 'original draft'})});
  const notices = [], requests = [], calls = [], disabledWrites = [];
  const entered = deferred(), release = deferred();
  const failure = new Error('Original recovery storage failed');
  const input = {value: 'original draft', disabled: false}, submit = {set disabled(value) {disabledWrites.push(value);}};
  const form = {elements: {name: input}, append() {}, querySelector: selector => selector.startsWith('button') ? submit : null};
  const recovery = {replaceChildren() {}, append() {}}, choice = {children: [], replaceChildren() {this.children = [];}, append(value) {this.children.push(value);}};
  const pickerInput = {value: 'original picker draft', disabled: false}, pickerStatus = {textContent: ''};let opens = 0;
  const picker = {showModal() {opens++;}}, pickerButton = {};
  const journal = {
    async begin(account, name, current) {current();calls.push({method: 'begin', account, key: original.key});assert.equal(name, original.body.Name);return original;},
    async read(account, current) {
      calls.push({method: 'read', account});current();
      if (hold === 'read') {entered.resolve();await release.promise;throw failure;}
      return {pending: original, history: []};
    },
    finish: () => assert.fail('UNKNOWN cannot finish the original draft'),
  };
  const context = vm.createContext({DOMException, AbortSignal, AbortController, Error, createRecoveredPlaylist,
    productRevision: 1, productSignOutPending: false, libraryEpoch: 1, epoch: 1,
    productState: {session: {account: 'owner-a'}}, productRequestAbort: new AbortController(),
    currentVideo: {id: 'first'}, playlistTarget: null, productConnected: () => true, requireAccount: () => true,
    playlistJournal: journal, playlistOperations: {read: async (_account, current) => {current();calls.push({method: 'operations'});return {pending: null};}},
    document: {createElement: () => ({dataset: {}, append() {}})}, Option: function(text, value) {this.text = text;this.value = value;},
    field: (value, lower, upper) => value[lower] ?? value[upper], t: key => key, confirm: () => true,
    showPlaylists: () => assert.fail('UNKNOWN must not navigate'), form, recovery,
    $: selector => ({'#playlist': pickerButton, '#playlist-choice': choice, '#playlist-name': pickerInput,
      '#playlist-picker-status': pickerStatus, '#playlist-save': {}, '#playlist-picker': picker})[selector],
    notice: (...args) => notices.push(args)});
  let api;
  const initialize = () => api = createVideoAPI({baseURL: 'https://video.ynxweb4.com/video/api', environment,
    getAccount: () => context.productState.session.account, requestId: () => assert.fail('create must supply original journal key'),
    authorize: async () => ({}), fetch: async (url, options) => {
      requests.push({url, ...options});
      if (options.method === 'POST') {if (hold === 'fetch') {entered.resolve();await release.promise;}throw new TypeError('original create result lost');}
      return new Response('[]');
    }});
  initialize();context.api = (...args) => api(...args);
  vm.runInContext(slice('const privateAPI = async', '\nconst playlistJournal=') + '\n' +
    slice('function playlistScope(', '\nasync function changeOriginalPlaylist') + '\n' +
    slice('async function renderPlaylistRecovery(', '\nconst json =') + '\n' +
    'scope=playlistScope(()=>{if(epoch!==libraryEpoch)throw new DOMException("Video view changed.","AbortError");});', context);
  if (kind === 'create') vm.runInContext(slice('form.onsubmit = async event => {', '\n    const changes=document.createElement'), context);
  else vm.runInContext(slice('$("#playlist").onclick =', '\n$("#playlist-picker-close").onclick='), context);
  return {context, notices, requests, calls, input, pickerInput, pickerStatus, disabledWrites, original, failure, entered, release, initialize,
    submit: () => kind === 'create' ? form.onsubmit({preventDefault() {}}) : pickerButton.onclick(),
    retire(change) {if (change === 'account') {context.productState = {session: {account: 'owner-b'}};context.productRevision++;context.productRequestAbort.abort(new DOMException('Account changed', 'AbortError'));context.productRequestAbort = new AbortController();}else if (change === 'view') context.libraryEpoch++;else context.playlistTarget = null;},
    rows: () => JSON.parse(values.get(storageKey) || '{"records":[]}').records, opens: () => opens};
}

test('create form late UNKNOWN after account retirement cannot publish notice or reset its old button', async () => {
  const h = harness('create', 'fetch');const pending = h.submit();await h.entered.promise;h.retire('account');h.input.value = 'new account draft';h.release.resolve();await pending;
  assert.equal(h.notices.length, 0);assert.deepEqual(h.disabledWrites, [true]);assert.equal(h.input.value, 'new account draft');
  assert.equal(h.requests.length, 1);assert.equal(h.requests[0].headers['Idempotency-Key'], h.original.key);assert.equal(h.rows()[0].key, h.original.key);
});

test('create form recovery second await cannot publish original UNKNOWN after its view retires', async () => {
  const h = harness('create', 'read');const pending = h.submit();await h.entered.promise;h.retire('view');h.input.value = 'new view draft';h.release.resolve();await pending;
  assert.equal(h.notices.length, 0);assert.deepEqual(h.disabledWrites, [true]);assert.equal(h.input.value, 'new view draft');
  assert.deepEqual(h.calls.map(row => row.method), ['begin', 'read']);assert.equal(h.rows()[0].key, h.original.key);assert.equal(h.rows()[0].state, 'UNKNOWN');
  assert.equal(h.requests.length, 1);assert.equal(h.requests[0].body, JSON.stringify(h.original.body));
});

test('current create UNKNOWN remains visible and preserves original draft/key through API reinitialization without replay', async () => {
  const h = harness('create');await h.submit();const firstCause = h.rows()[0].firstCause;h.initialize();await h.submit();
  assert.equal(h.notices.length, 2);assert.ok(h.notices.every(row => row[1] === true && /result unconfirmed/.test(row[0])));
  assert.equal(h.requests.length, 1);assert.equal(h.requests[0].headers['Idempotency-Key'], h.original.key);
  assert.equal(h.rows()[0].key, h.original.key);assert.equal(h.rows()[0].state, 'UNKNOWN');assert.deepEqual(h.rows()[0].firstCause, firstCause);
  assert.equal(h.input.value, h.original.body.Name);assert.equal(h.input.disabled, true);assert.deepEqual(h.disabledWrites, [true, false, true, false]);
});

for (const change of ['account', 'target']) test(`picker late non-Abort recovery failure cannot notify after ${change} retires its scope`, async () => {
  const h = harness('picker', 'read');const pending = h.submit();await h.entered.promise;h.retire(change);h.pickerInput.value = 'replacement picker draft';h.release.resolve();await pending;
  assert.equal(h.notices.length, 0);assert.equal(h.pickerInput.value, 'replacement picker draft');assert.equal(h.opens(), 0);
  assert.equal(h.requests.length, 1);assert.equal(h.requests[0].method, 'GET');assert.equal(h.rows().length, 0);
  assert.deepEqual(h.calls, [{method: 'read', account: 'owner-a'}]);
});

test('current picker original storage failure stays visible without overwriting original draft or opening modal', async () => {
  const h = harness('picker', 'read');const pending = h.submit();await h.entered.promise;h.release.resolve();await pending;
  assert.deepEqual(h.notices, [[h.failure.message, true]]);assert.equal(h.pickerInput.value, 'original picker draft');assert.equal(h.opens(), 0);
  assert.equal(h.requests.length, 1);assert.equal(h.rows().length, 0);
});
