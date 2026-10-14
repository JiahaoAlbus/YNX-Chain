import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {createVideoAPI} from './video-api.js';
const source = await readFile(process.env.YNX_VIDEO_APP_SOURCE || new URL('./app.js', import.meta.url), 'utf8');
const slice = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
const deferred = () => {let resolve;const promise = new Promise(done => resolve = done);return {promise, resolve};};
function harness(fetch) {
  const requests = [], commentWrites = [], buttonWrites = [], events = new Map();let content = 'original comments', text = 'original button', storageWrites = 0;
  const comments = {get innerHTML() {return content;}, set innerHTML(value) {content = value;commentWrites.push(value);}, get textContent() {return content;}, set textContent(value) {content = value;commentWrites.push(value);}};
  const button = {disabled: false, dataset: new Proxy({subscribed: 'false'}, {set(target, name, value) {target[name] = value;buttonWrites.push([name, value]);return true;}}),
    get textContent() {return text;}, set textContent(value) {text = value;buttonWrites.push(['text', value]);}};
  const close = {}, player = {close() {}, addEventListener: (name, handler) => events.set(name, handler)};
  const context = vm.createContext({DOMException, AbortSignal, AbortController, Error,
    productRevision: 1, playbackSelectionRevision: 1, subscriptionRevision: 0, commentsRevision: 0, productSignOutPending: false,
    productRequestAbort: new AbortController(), productState: {session: {account: 'owner-a'}}, currentVideo: {id: 'vid_owned', channel_id: 'original-channel'},
    productConnected: () => true, flushWatch: async () => {}, esc: value => value, field: (row, lower, upper) => row[lower] ?? row[upper],
    $: selector => selector === '#comments' ? comments : selector === '#subscribe' ? button : selector === '#close' ? close : selector === '#player' ? player : {pause() {}}});
  context.api = createVideoAPI({baseURL: 'https://video.ynxweb4.com/video/api', getAccount: () => 'owner-a', authorize: async () => ({}),
    requestId: () => assert.fail('reads must not mint mutation keys'), environment: {localStorage: {getItem: () => null, setItem: () => {storageWrites++;assert.fail('reads cannot change durable fences');}}},
    fetch: async (url, options) => {requests.push({url, ...options});return fetch(url, options);}});
  vm.runInContext(slice('const privateAPI = async', '\nconst playlistJournal=') + '\n' +
    slice('async function loadComments()', '\nasync function flushWatch') + '\n' +
    slice('async function refreshSubscriptionButton()', '\nasync function showChannel') + '\n' +
    slice('$("#close").onclick =', '\n$("#video").addEventListener("timeupdate"'), context);
  return {context, requests, comments, button, commentWrites, buttonWrites,
    load: () => vm.runInContext('loadComments()', context), refresh: () => vm.runInContext('refreshSubscriptionButton()', context),
    retire: event => event === 'close' ? close.onclick() : events.get('cancel')(), storageWrites: () => storageWrites};
}
const response = text => new Response(JSON.stringify([{Author: 'reader', Body: text}]));
function assertReadOnly(h, count) {assert.equal(h.requests.length, count);assert.ok(h.requests.every(row => row.method === 'GET'));assert.equal(h.storageWrites(), 0);}

for (const outcome of ['success', 'error']) test(`old comments ${outcome} cannot publish after actual player close/cancel keeps the same target`, async () => {
  const entered = deferred(), release = deferred();
  const h = harness(async () => {entered.resolve();await release.promise;return outcome === 'success' ? response('old comments') : new Response('{broken');});
  const pending = h.load();await entered.promise;const target = h.context.currentVideo;h.retire(outcome === 'success' ? 'close' : 'cancel');
  assert.equal(h.context.currentVideo, target);assert.equal(h.context.playbackSelectionRevision, 2);h.comments.textContent = 'replacement comments';h.commentWrites.length = 0;release.resolve();await pending;
  assert.equal(h.comments.textContent, 'replacement comments');assert.equal(h.commentWrites.length, 0);assertReadOnly(h, 1);assert.match(h.requests[0].url, /vid_owned\/comments$/);
});

for (const outcome of ['success', 'error']) test(`same-selection newer comments result cannot be overwritten by older ${outcome}`, async () => {
  const entered = deferred(), release = deferred();let calls = 0;
  const h = harness(async () => {if (++calls === 1) {entered.resolve();await release.promise;return outcome === 'success' ? response('old comments') : new Response('{broken');}return response('new comments');});
  const old = h.load();await entered.promise;await h.load();assert.match(h.comments.innerHTML, /new comments/);const accepted = h.comments.innerHTML;h.commentWrites.length = 0;
  release.resolve();await old;assert.equal(h.comments.innerHTML, accepted);assert.equal(h.commentWrites.length, 0);assert.equal(h.context.playbackSelectionRevision, 1);assertReadOnly(h, 2);
});

for (const event of ['close', 'cancel']) test(`subscription read cannot change replacement button after actual player ${event}`, async () => {
  const entered = deferred(), release = deferred();
  const h = harness(async () => {entered.resolve();await release.promise;return new Response('[{"id":"original-channel"}]');});
  const pending = h.refresh();await entered.promise;h.retire(event);h.button.textContent = 'replacement button';h.button.dataset.subscribed = 'replacement-state';h.buttonWrites.length = 0;
  release.resolve();await pending;assert.equal(h.button.textContent, 'replacement button');assert.equal(h.button.dataset.subscribed, 'replacement-state');assert.equal(h.buttonWrites.length, 0);assertReadOnly(h, 1);assert.match(h.requests[0].url, /v1\/subscriptions$/);
});

test('current comments read displays the actual current result', async () => {
  const h = harness(async () => response('current comments'));await h.load();assert.match(h.comments.innerHTML, /current comments/);assertReadOnly(h, 1);
});
test('current comments invalid service response remains visible', async () => {
  const h = harness(async () => new Response('{broken'));await h.load();assert.match(h.comments.textContent, /Invalid Video service response/);assertReadOnly(h, 1);
});
for (const subscribed of [true, false]) test(`current subscription read displays ${subscribed ? 'subscribed' : 'unsubscribed'} state`, async () => {
  const h = harness(async () => new Response(subscribed ? '[{"id":"original-channel"}]' : '[]'));await h.refresh();
  assert.equal(h.button.dataset.subscribed, String(subscribed));assert.equal(h.button.textContent, subscribed ? 'Unsubscribe' : 'Subscribe');assertReadOnly(h, 1);
});
