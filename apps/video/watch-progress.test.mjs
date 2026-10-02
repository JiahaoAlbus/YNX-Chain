import test from 'node:test';
import assert from 'node:assert/strict';
import {createWatchProgress} from './watch-progress.js';
import {createVideoAPI} from './video-api.js';

const deferred = () => {let resolve, reject;const promise = new Promise((yes, no) => {resolve = yes;reject = no;});return {promise, resolve, reject};};
const tick = () => new Promise(resolve => setImmediate(resolve));
function progress(options = {}) {
  let now = 0, sequence = 0;
  const watch = createWatchProgress({clock: () => now, signedIn: () => true,
    idFactory: () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}`, ...options});
  return {watch, sample(position, at, extra = {}) {now = at;watch.sample({position, paused: false, seeking: false, ...extra});}};
}

test('ending during a pending ordinary flush persists completion for the same playback exactly once', async () => {
  const delivery = deferred(), writes = [];
  const {watch, sample} = progress({send: (body, metadata) => {writes.push({body, metadata});return writes.length === 1 ? delivery.promise : Promise.resolve();}});
  sample(0, 0);sample(1, 1000);
  const ordinary = watch.flush(false);
  await tick();
  const terminal = watch.flush(true);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].body.completed, false);
  delivery.resolve();
  await Promise.all([ordinary, terminal]);
  assert.deepEqual(writes.map(({body}) => [body.seconds, body.completed]), [[1, false], [0, true]]);
  assert.equal(writes[0].body.playback_id, writes[1].body.playback_id);
  assert.notEqual(writes[0].metadata.idempotencyKey, writes[1].metadata.idempotencyKey);
  await watch.flush(true);await watch.flush(false);
  assert.equal(writes.length, 2);
});

test('a lost response after service commit reuses the exact mutation across API retries and later flushes', async () => {
  let deliveries = 0, proofs = 0;
  const committed = new Map(), requests = [];
  const api = createVideoAPI({baseURL: 'https://video.ynxweb4.com/video/api',
    requestId: () => {throw new Error('watch batch must supply its persisted idempotency key');},
    authorize: async () => ({'X-YNX-Product-Session-Proof-V2': `proof-${++proofs}`}),
    fetch: async (_url, options) => {
      const key = options.headers['Idempotency-Key'];
      requests.push({key, body: options.body, proof: options.headers['X-YNX-Product-Session-Proof-V2']});
      if (!committed.has(key)) committed.set(key, JSON.parse(options.body));
      if (++deliveries <= 2) throw new Error('response lost after commit');
      return {ok: true, status: 200, json: async () => ({ok: true})};
    }});
  const {watch, sample} = progress({send: (body, {idempotencyKey}) => api('/v1/videos/owned/watch', {
    private: true, method: 'POST', headers: {'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey}, body: JSON.stringify(body)})});
  sample(0, 0);sample(1, 1000);
  await assert.rejects(watch.flush(), /response lost/);
  sample(2, 2000);sample(3, 3000);
  await watch.flush();
  assert.equal(committed.size, 1);
  assert.deepEqual(requests.map(request => request.key), [requests[0].key, requests[0].key, requests[0].key]);
  assert.equal(new Set(requests.map(request => request.body)).size, 1);
  assert.equal(new Set(requests.map(request => request.proof)).size, 3);
  await watch.flush();
  assert.equal(committed.size, 2);
  assert.deepEqual([...committed.values()].map(body => body.seconds), [1, 2]);
  assert.equal(new Set([...committed.values()].map(body => body.playback_id)).size, 1);
});

test('an unreadable success response retains the same batch until a valid acknowledgement', async () => {
  const requests = [];
  const api = createVideoAPI({baseURL:'https://video.ynxweb4.com/video/api',authorize:async()=>({}),fetch:async(_url,options)=>{
    requests.push(options);
    return {ok:true,status:200,json:async()=>{if(requests.length===1)throw new SyntaxError('truncated JSON');return {ok:true};}};
  }});
  const {watch,sample}=progress({send:(body,{idempotencyKey})=>api('/v1/videos/owned/watch',{
    private:true,method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':idempotencyKey},body:JSON.stringify(body)})});
  sample(0,0);sample(1,1000);
  await assert.rejects(watch.flush(),/Invalid Video service response/);
  await watch.flush();
  assert.equal(requests.length,2);
  assert.equal(requests[0].body,requests[1].body);
  assert.equal(requests[0].headers['Idempotency-Key'],requests[1].headers['Idempotency-Key']);
});

test('failed completion retains its immutable zero-second batch and key for retry', async () => {
  let attempt = 0;
  const writes = [];
  const {watch, sample} = progress({send: async (body, metadata) => {
    writes.push({body, metadata});
    if (body.completed && ++attempt === 1) throw new Error('completion acknowledgement lost');
  }});
  sample(0, 0);sample(1, 1000);await watch.flush(false);
  await assert.rejects(watch.flush(true), /acknowledgement lost/);
  sample(2, 2000);
  await watch.flush(false);
  assert.equal(writes[1].body, writes[2].body);
  assert.equal(writes[1].metadata.idempotencyKey, writes[2].metadata.idempotencyKey);
  assert.ok(Object.isFrozen(writes[1].body));
  assert.deepEqual([writes[2].body.seconds, writes[2].body.completed], [0, true]);
  await watch.flush();
  assert.equal(writes[3].body.seconds, 1);
  assert.equal(writes[3].body.completed, false);
});

test('discard while a request is pending cancels queued completion and never restores accumulated playback', async () => {
  const delivery = deferred(), writes = [];
  const {watch, sample} = progress({send: body => {writes.push(body);return delivery.promise;}});
  sample(0, 0);sample(1, 1000);
  const pending = watch.flush();await tick();
  watch.flush(true);watch.discard();delivery.resolve();await pending;
  sample(2, 2000);await watch.flush(true);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].completed, false);
});

test('guests, seeking and unobserved time cannot create completion records', async () => {
  const writes = [];
  let signedIn = false;
  const {watch, sample} = progress({signedIn: () => signedIn, send: async body => writes.push(body)});
  sample(0, 0);sample(1, 1000);await watch.flush(true);
  signedIn = true;sample(1, 1000);sample(10, 2000);await watch.flush(true);
  sample(11, 2000);await watch.flush(true);
  assert.equal(writes.length, 0);
  sample(11.5, 2500);await watch.flush(true);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].seconds, 0);
  assert.equal(writes[0].completed, true);
});

test('long playback automatically saves two observed checkpoints as one playback with separate batches', async () => {
  const writes = [];
  const {watch, sample} = progress({send: async (body, metadata) => writes.push({body, metadata})});
  for (let seconds = 0; seconds <= 30; seconds++) {sample(seconds, seconds * 1000);await tick();}
  assert.deepEqual(writes.map(write => write.body.seconds), [15, 15]);
  assert.equal(writes[0].body.playback_id, writes[1].body.playback_id);
  assert.notEqual(writes[0].metadata.idempotencyKey, writes[1].metadata.idempotencyKey);
  for (let seconds = 31; seconds <= 35; seconds++) {sample(seconds, seconds * 1000);await tick();}
  assert.equal(writes.length, 2); // The shorter tail still requires a normal pause/end flush.
  await watch.flush();
  assert.equal(writes[2].body.seconds, 5);
});

test('automatic failures are throttled by newly observed playback and retry the immutable batch', async () => {
  const writes = [], errors = [];
  const {sample} = progress({send: async (body, metadata) => {
    writes.push({body, metadata});
    if (writes.length === 1) throw new Error('temporary save failure');
  }, onError: error => {errors.push(error.message);throw new Error('UI callback failed');}});
  for (let seconds = 0; seconds <= 15; seconds++) {sample(seconds, seconds * 1000);await tick();}
  assert.equal(writes.length, 1);
  assert.deepEqual(errors, ['temporary save failure']);
  for (let seconds = 16; seconds < 30; seconds++) {sample(seconds, seconds * 1000);await tick();}
  assert.equal(writes.length, 1);
  sample(30, 30_000);await tick();
  assert.equal(writes.length, 3);
  assert.equal(writes[0].body, writes[1].body);
  assert.equal(writes[0].metadata.idempotencyKey, writes[1].metadata.idempotencyKey);
  assert.notEqual(writes[1].metadata.idempotencyKey, writes[2].metadata.idempotencyKey);
  assert.deepEqual(writes.map(write => write.body.seconds), [15, 15, 15]);
  assert.equal(errors.length, 1);
});

test('discard prevents periodic work and suppresses an older automatic failure', async () => {
  const delivery = deferred(), writes = [], errors = [];
  const {watch, sample} = progress({send: body => {writes.push(body);return delivery.promise;}, onError: error => errors.push(error)});
  for (let seconds = 0; seconds <= 15; seconds++) {sample(seconds, seconds * 1000);await tick();}
  assert.equal(writes.length, 1);
  watch.discard();delivery.reject(new Error('old playback failed'));await tick();
  for (let seconds = 16; seconds <= 45; seconds++) {sample(seconds, seconds * 1000);await tick();}
  assert.equal(writes.length, 1);
  assert.equal(errors.length, 0);
});

test('a retained automatic failure cannot retry from paused playback or seeking', async () => {
  let writes = 0;
  const {sample} = progress({send: async () => {writes++;throw new Error('offline');}});
  for (let seconds = 0; seconds <= 15; seconds++) {sample(seconds, seconds * 1000);await tick();}
  for (let seconds = 16; seconds <= 60; seconds++) {sample(seconds * 100, seconds * 1000, {paused: seconds % 2 === 0, seeking: true});await tick();}
  assert.equal(writes, 1);
});
