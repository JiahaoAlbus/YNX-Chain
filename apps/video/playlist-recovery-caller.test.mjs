import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const source = await readFile(process.env.YNX_VIDEO_APP_SOURCE || new URL('./app.js', import.meta.url), 'utf8');
const slice = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
const deferred = () => {let resolve;const promise = new Promise(done => resolve = done);return {promise, resolve};};
async function harness(action, stage) {
  const entered = deferred(), release = deferred(), notices = [], calls = [];
  const original = Object.freeze({key: 'video-playlist-00000000-0000-4000-8000-000000000001', body: Object.freeze({Name: 'original draft'})});
  let saved = action === 'pause' ? {pending: original, history: []} : {pending: null, history: [original]};
  let reads = 0, http = 0;
  const failure = Object.assign(new Error('Original recovery storage failed'), {code: 'RECOVERY_STORAGE_UNAVAILABLE'});
  const journal = {
    async read(account, current) {
      calls.push({method: 'read', account});current();
      if (++reads === 2 && stage === 'render') {entered.resolve();await release.promise;throw failure;}
      return saved;
    },
    async [action](account, row, current) {
      calls.push({method: action, account, key: row.key});current();assert.equal(row, original);
      if (stage === 'journal') {entered.resolve();await release.promise;throw failure;}
      saved = action === 'pause' ? {pending: null, history: [original]} : {pending: original, history: []};
    },
  };
  const elements = [];
  const createElement = tag => {
    const node = {tag, dataset: {}, children: [], append(...children) {this.children.push(...children);}, remove() {}};
    elements.push(node);return node;
  };
  const input = {value: '', disabled: false}, submit = {};
  const form = {elements: {name: input}, children: [], querySelector: selector => selector.startsWith('button') ? submit : null, append(node) {this.children.push(node);}};
  const box = {children: [], replaceChildren() {this.children = [];}, append(...nodes) {this.children.push(...nodes);}};
  const context = vm.createContext({DOMException, Error, productRevision: 1, productSignOutPending: false,
    libraryEpoch: 1, productState: {session: {account: 'owner-a'}}, productConnected: () => true,
    playlistJournal: journal, document: {createElement}, confirm: () => true, t: key => key,
    notice: (...args) => notices.push(args), api: () => {http++;assert.fail('local recovery caller must not issue HTTP');},
    form, box});
  // Execute exact scope and recovery renderer with controlled journal boundary only.
  vm.runInContext(slice('function playlistScope(', '\nasync function createOriginalPlaylist') + '\n' +
    slice('async function renderPlaylistRecovery(', '\nconst json =') + '\n' +
    'scope=playlistScope(()=>{if(libraryEpoch!==1)throw new DOMException("Video view changed.","AbortError");});', context);
  await vm.runInContext('renderPlaylistRecovery(form,box,scope)', context);
  const button = elements.find(node => node.tag === 'button');assert.ok(button);
  return {entered, release, notices, calls, original, failure, context, input, form, box,
    submit: () => button.onclick(), state: () => saved, http: () => http,
    retire(change) {if (change === 'account') {context.productState = {session: {account: 'owner-b'}};context.productRevision++;}else context.libraryEpoch++;}};
}

for (const action of ['pause', 'restore']) for (const stage of ['journal', 'render']) test(`${action} ${stage} late non-Abort storage failure cannot publish into a retired recovery form`, async () => {
  const h = await harness(action, stage), initialCalls = h.calls.length;
  const pending = h.submit();await h.entered.promise;h.retire(stage === 'journal' ? 'account' : 'view');
  h.input.value = 'new context draft';h.input.disabled = false;h.box.children = ['new context recovery'];
  h.release.resolve();await pending;
  assert.equal(h.notices.length, 0);assert.equal(h.input.value, 'new context draft');assert.equal(h.input.disabled, false);
  assert.deepEqual(h.box.children, ['new context recovery']);assert.equal(h.http(), 0);
  assert.equal(h.calls[initialCalls].method, action);assert.equal(h.calls[initialCalls].account, 'owner-a');assert.equal(h.calls[initialCalls].key, h.original.key);
  assert.deepEqual(h.calls.map(row => row.method), stage === 'journal' ? ['read', action] : ['read', action, 'read']);
  const saved = h.state();
  const stillPending = (action === 'pause' && stage === 'journal') || (action === 'restore' && stage === 'render');
  assert.equal(saved.pending, stillPending ? h.original : null);
  assert.deepEqual(saved.history, stillPending ? [] : [h.original]);
  assert.ok(Object.isFrozen(h.original));assert.ok(Object.isFrozen(h.original.body));assert.equal(h.original.body.Name, 'original draft');
});

for (const action of ['pause', 'restore']) test(`current ${action} storage failure remains visible and preserves the original recovery record`, async () => {
  const h = await harness(action, 'journal');const pending = h.submit();await h.entered.promise;h.release.resolve();await pending;
  assert.deepEqual(h.notices, [[h.failure.message, true]]);assert.equal(h.http(), 0);
  assert.deepEqual(h.calls.map(row => row.method), ['read', action]);assert.equal(h.calls[1].key, h.original.key);
  assert.equal(h.state().pending, action === 'pause' ? h.original : null);
  assert.deepEqual(h.state().history, action === 'pause' ? [] : [h.original]);
  assert.equal(h.input.value, action === 'pause' ? 'original draft' : '');
});
