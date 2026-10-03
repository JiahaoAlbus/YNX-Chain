import assert from 'node:assert/strict';
import test from 'node:test';
import { LocalClassifierWorker, type ClassifierWorkerPort, type ClassifierWorkerRequest } from './localClassifierWorker';

const scores = { gore: 0.1, explicit_violence: 0.2, sexual_content: 0.3 };
function fixture(options: { timeoutMs?: number; maximumConcurrent?: number; maximumBytes?: number } = {}) {
  const workers: Array<{
    request?: ClassifierWorkerRequest; transferred?: readonly ArrayBuffer[];
    receive?: (data: unknown) => void; fail?: () => void; terminated: number; unsubscribed: number;
  }> = [];
  const classifier = new LocalClassifierWorker(() => {
    const worker: typeof workers[number] = { terminated: 0, unsubscribed: 0 };
    workers.push(worker);
    return {
      subscribe(receive, fail) { worker.receive = receive; worker.fail = fail; return () => { worker.unsubscribed++; }; },
      postMessage(request, transferred) { worker.request = request; worker.transferred = transferred; },
      terminate() { worker.terminated++; },
    } satisfies ClassifierWorkerPort;
  }, { supportedMimeTypes: ['image/png'], ...options });
  const workerAt = (index: number) => {
    const worker = workers[index];
    assert.ok(worker, 'Expected worker to have been created');
    return worker;
  };
  const requestAt = (index: number) => {
    const request = workerAt(index).request;
    assert.ok(request, 'Expected content to have been dispatched');
    return request;
  };
  const respond = (index: number, value: unknown = scores, id = requestAt(index).id) => {
    const receive = workerAt(index).receive;
    assert.ok(receive, 'Expected result subscription');
    receive({ protocol: 'ynx-social-classifier-worker-v1', type: 'scores', id, scores: value });
  };
  return { classifier, workers, workerAt, requestAt, respond };
}

test('worker gets a transferable private copy, not the caller buffer; valid result terminates once', async () => {
  const f = fixture(); const original = new Uint8Array([1, 2, 3]);
  const pending = f.classifier.classify(original, 'image/png', new AbortController().signal);
  assert.notEqual(f.requestAt(0).content, original.buffer);
  assert.deepEqual(Array.from(new Uint8Array(f.requestAt(0).content)), [1, 2, 3]);
  const transferred = f.workerAt(0).transferred;
  assert.ok(transferred, 'Expected transfer list');
  assert.equal(transferred[0], f.requestAt(0).content);
  original[0] = 9;
  assert.equal(new Uint8Array(f.requestAt(0).content)[0], 1);
  f.respond(0); const result = await pending;
  assert.deepEqual(result, scores); assert.ok(Object.isFrozen(result));
  assert.deepEqual(Array.from(original), [9, 2, 3]);
  assert.equal(f.workerAt(0).terminated, 1); assert.equal(f.workerAt(0).unsubscribed, 1);
  f.respond(0); assert.equal(f.workerAt(0).terminated, 1);
});

test('pre-aborted work never creates an engine', async () => {
  const f = fixture(); const abort = new AbortController(); abort.abort();
  await assert.rejects(f.classifier.classify(new Uint8Array([1]), 'image/png', abort.signal), /stopped/);
  assert.equal(f.workers.length, 0);
});

test('abort terminates and late old scores cannot resolve the next job', async () => {
  const f = fixture(); const abort = new AbortController();
  const old = f.classifier.classify(new Uint8Array([1]), 'image/png', abort.signal);
  const rejected = assert.rejects(old, /stopped/); abort.abort(); await rejected;
  const current = f.classifier.classify(new Uint8Array([2]), 'image/png', new AbortController().signal);
  let resolved = false; void current.then(() => { resolved = true; });
  f.respond(0); await Promise.resolve(); assert.equal(resolved, false);
  f.respond(1); assert.deepEqual(await current, scores);
  assert.equal(f.workerAt(0).terminated, 1); assert.equal(f.workerAt(1).terminated, 1);
});

test('a never-ending engine times out, terminates and explicit retry works', async () => {
  const f = fixture({ timeoutMs: 5 });
  await assert.rejects(f.classifier.classify(new Uint8Array([1]), 'image/png', new AbortController().signal), /timed out/);
  assert.equal(f.workerAt(0).terminated, 1);
  const retry = f.classifier.classify(new Uint8Array([1]), 'image/png', new AbortController().signal);
  f.respond(1); assert.deepEqual(await retry, scores);
});

test('current worker failure never becomes a clear score and releases capacity', async () => {
  const f = fixture(); const pending = f.classifier.classify(new Uint8Array([1]), 'image/png', new AbortController().signal);
  const failed = assert.rejects(pending, /worker failed/);
  const fail = f.workerAt(0).fail; assert.ok(fail); fail(); await failed;
  const retry = f.classifier.classify(new Uint8Array([1]), 'image/png', new AbortController().signal);
  f.respond(1); await retry; assert.equal(f.workerAt(0).terminated, 1);
});

test('close terminates every active job and prevents replacement work', async () => {
  const f = fixture({ maximumConcurrent: 2 });
  const a = assert.rejects(f.classifier.classify(new Uint8Array([1]), 'image/png', new AbortController().signal), /stopped/);
  const b = assert.rejects(f.classifier.classify(new Uint8Array([2]), 'image/png', new AbortController().signal), /stopped/);
  f.classifier.close(); await a; await b;
  assert.ok(f.workers.every(worker => worker.terminated === 1));
  await assert.rejects(f.classifier.classify(new Uint8Array([3]), 'image/png', new AbortController().signal), /stopped/);
  assert.equal(f.workers.length, 2);
});

test('mime, byte and parallel-work limits reject before engine creation', async () => {
  const f = fixture({ maximumBytes: 2 });
  await assert.rejects(f.classifier.classify(new Uint8Array([1]), 'video/mp4', new AbortController().signal), /input/);
  await assert.rejects(f.classifier.classify(new Uint8Array(), 'image/png', new AbortController().signal), /input/);
  await assert.rejects(f.classifier.classify(new Uint8Array([1, 2, 3]), 'image/png', new AbortController().signal), /input/);
  assert.equal(f.workers.length, 0);
  const pending = f.classifier.classify(new Uint8Array([1]), 'image/png', new AbortController().signal);
  await assert.rejects(f.classifier.classify(new Uint8Array([1]), 'image/png', new AbortController().signal), /capacity/);
  f.respond(0); await pending;
});

for (const invalid of [null, {}, { ...scores, gore: NaN }, { ...scores, explicit_violence: -1 },
  { ...scores, sexual_content: 2 }, { ...scores, extra: 1 }, { gore: 0, sexual_content: 0 },
  Object.defineProperty({ ...scores }, 'gore', { get: () => 0 })]) {
  test('malformed or incomplete scores cannot pass the worker boundary ' + String(invalid), async () => {
    const f = fixture(); const pending = f.classifier.classify(new Uint8Array([1]), 'image/png', new AbortController().signal);
    const rejected = assert.rejects(pending, /Invalid local classifier result/); f.respond(0, invalid); await rejected;
    assert.equal(f.workerAt(0).terminated, 1);
  });
}

test('wrong job identity is ignored until its own bounded valid result', async () => {
  const f = fixture(); const pending = f.classifier.classify(new Uint8Array([1]), 'image/png', new AbortController().signal);
  let done = false; void pending.then(() => { done = true; });
  f.respond(0, scores, 999); await Promise.resolve(); assert.equal(done, false);
  f.respond(0); await pending;
});

test('abort inside the engine factory terminates without dispatching content', async () => {
  const abort = new AbortController(); let dispatched = false, terminated = false;
  const classifier = new LocalClassifierWorker(() => {
    abort.abort();
    return { subscribe() { return () => {}; }, postMessage() { dispatched = true; }, terminate() { terminated = true; } };
  }, { supportedMimeTypes: ['image/png'] });
  await assert.rejects(classifier.classify(new Uint8Array([1]), 'image/png', abort.signal), /stopped/);
  assert.equal(dispatched, false); assert.equal(terminated, true);
});

test('factory failure is bounded and a fresh factory attempt can recover', async () => {
  let attempts = 0; let receive: ((data: unknown) => void) | undefined; let request: ClassifierWorkerRequest | undefined;
  const classifier = new LocalClassifierWorker(() => {
    if (++attempts === 1) throw new Error('Fixture creation failed');
    return { subscribe(result) { receive = result; return () => {}; }, postMessage(value) { request = value; }, terminate() {} };
  }, { supportedMimeTypes: ['image/png'] });
  await assert.rejects(classifier.classify(new Uint8Array([1]), 'image/png', new AbortController().signal), /worker failed/);
  const retry = classifier.classify(new Uint8Array([1]), 'image/png', new AbortController().signal);
  assert.ok(receive); assert.ok(request);
  receive({ protocol: 'ynx-social-classifier-worker-v1', type: 'scores', id: request.id, scores }); await retry;
});

test('invalid worker budgets and unsupported capability declarations are rejected', () => {
  const factory = (): ClassifierWorkerPort => { throw new Error('Must not create'); };
  for (const options of [{ supportedMimeTypes: [] }, { supportedMimeTypes: ['image/png', 'image/png'] },
    { supportedMimeTypes: ['video/mp4'] }, { supportedMimeTypes: ['image/png'], timeoutMs: 0 },
    { supportedMimeTypes: ['image/png'], maximumConcurrent: 3 }, { supportedMimeTypes: ['image/png'], maximumBytes: 9 * 1024 * 1024 }]) {
    assert.throws(() => new LocalClassifierWorker(factory, options));
  }
});


test('close inside the engine factory reclaims its returned worker without dispatch', async () => {
  let terminated = 0, dispatched = 0;
  const classifier = new LocalClassifierWorker(() => {
    classifier.close();
    return { subscribe() { return () => {}; }, postMessage() { dispatched++; }, terminate() { terminated++; } };
  }, { supportedMimeTypes: ['image/png'] });
  await assert.rejects(classifier.classify(new Uint8Array([1]), 'image/png', new AbortController().signal), /stopped/);
  assert.equal(terminated, 1); assert.equal(dispatched, 0);
});

test('abort during subscription terminates and detaches without dispatch', async () => {
  const abort = new AbortController(); let terminated = 0, detached = 0, dispatched = 0;
  const classifier = new LocalClassifierWorker(() => ({
    subscribe() { abort.abort(); return () => { detached++; }; },
    postMessage() { dispatched++; }, terminate() { terminated++; },
  }), { supportedMimeTypes: ['image/png'] });
  await assert.rejects(classifier.classify(new Uint8Array([1]), 'image/png', abort.signal), /stopped/);
  assert.equal(terminated, 1); assert.equal(detached, 1); assert.equal(dispatched, 0);
});
