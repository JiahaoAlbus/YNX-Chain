import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_CONTENT_FILTER, LocalContentDisplay, type ContentScores, type DeviceContentClassifier } from './localContentDisplay';

const safe: ContentScores = { gore: 0.01, explicit_violence: 0.02, sexual_content: 0.03 };
const bytes = new TextEncoder().encode('Original authorized fixture content');
const enabled = { ...DEFAULT_CONTENT_FILTER, enabled: true };
function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
function port(classify: DeviceContentClassifier['classify']): DeviceContentClassifier {
  return { supportedMimeTypes: ['text/plain', 'image/png'], classify };
}

test('default off never invokes a classifier; missing model is not protection', async () => {
  let calls = 0;
  const gate = new LocalContentDisplay(port(async () => { ++calls; return safe; }));
  const off = gate.begin('event', bytes, 'text/plain');
  assert.equal(off.initial.status, 'disabled');
  assert.equal(gate.canDisplay('event', bytes, await off.completed), true);
  assert.equal(calls, 0);
  const unavailable = new LocalContentDisplay(); unavailable.configure(enabled);
  const missing = unavailable.begin('event', bytes, 'text/plain');
  assert.equal(missing.initial.reason, 'model_unavailable');
  assert.equal(unavailable.canDisplay('event', bytes, await missing.completed), false);
});

test('pending content cannot flash; original-byte and generation fences survive awaits', async () => {
  const result = deferred<ContentScores>();
  const gate = new LocalContentDisplay(port(() => result.promise)); gate.configure(enabled);
  const job = gate.begin('event', bytes, 'text/plain');
  assert.equal(job.initial.status, 'pending');
  assert.equal(gate.canDisplay('event', bytes, job.initial), false);
  result.resolve(safe);
  const clear = await job.completed;
  assert.equal(clear.status, 'clear');
  assert.equal(gate.canDisplay('event', bytes, clear), true);
  assert.equal(gate.canDisplay('event', new Uint8Array([1]), clear), false);
  assert.equal(gate.canDisplay('another', bytes, clear), false);
  gate.configure(enabled);
  assert.equal(gate.canDisplay('event', bytes, clear), false);
});

for (const category of ['gore', 'explicit_violence', 'sexual_content'] as const) {
  test(`${category} folds locally without changing original content`, async () => {
    const original = bytes.slice();
    const gate = new LocalContentDisplay(port(async () => ({ ...safe, [category]: 0.9 })));
    gate.configure(enabled);
    const folded = await gate.begin('event', original, 'text/plain').completed;
    assert.equal(folded.status, 'folded'); assert.deepEqual(folded.flagged, [category]);
    assert.equal(gate.canDisplay('event', original, folded), false);
    assert.deepEqual(original, bytes);
  });
}

test('GIF, video and audio are not certified from a still-image capability', async () => {
  let calls = 0;
  const gate = new LocalContentDisplay(port(async () => { ++calls; return safe; })); gate.configure(enabled);
  for (const mime of ['image/gif', 'video/mp4', 'audio/ogg']) {
    const job = gate.begin(mime, bytes, mime);
    assert.equal(job.initial.reason, 'unsupported');
    assert.equal(gate.canDisplay(mime, bytes, await job.completed), false);
  }
  assert.equal(calls, 0);
});

test('disable cancels original work and late results cannot rescue it', async () => {
  const result = deferred<ContentScores>(); let signal: AbortSignal | undefined;
  const gate = new LocalContentDisplay(port((_bytes, _mime, current) => { signal = current; return result.promise; }));
  gate.configure(enabled); const job = gate.begin('event', bytes, 'text/plain');
  await Promise.resolve(); gate.configure(DEFAULT_CONTENT_FILTER);
  assert.equal(signal?.aborted, true);
  const stale = await job.completed; assert.equal(stale.reason, 'stale');
  result.resolve(safe);
  assert.equal(gate.canDisplay('event', bytes, stale), false);
  assert.equal((await gate.begin('event', bytes, 'text/plain').completed).status, 'disabled');
});

test('replacement of the same content ID retires the old inference', async () => {
  const first = deferred<ContentScores>(); let calls = 0;
  const gate = new LocalContentDisplay(port(() => ++calls === 1 ? first.promise : Promise.resolve(safe)));
  gate.configure(enabled); const old = gate.begin('event', bytes, 'text/plain'); await Promise.resolve();
  const currentBytes = new Uint8Array([2]); const current = gate.begin('event', currentBytes, 'image/png');
  assert.equal((await old.completed).reason, 'stale');
  const clear = await current.completed; first.resolve(safe);
  assert.equal(gate.canDisplay('event', currentBytes, clear), true);
  assert.equal(gate.canDisplay('event', bytes, clear), false);
});

test('bounded concurrency rejects overload, then accepts recovery', async () => {
  const result = deferred<ContentScores>();
  const gate = new LocalContentDisplay(port(() => result.promise), { maxConcurrent: 1, maxBytes: 1024, timeoutMs: 1000 });
  gate.configure(enabled); const first = gate.begin('first', bytes, 'text/plain');
  assert.equal(gate.begin('second', bytes, 'text/plain').initial.reason, 'resource_limit');
  first.cancel(); assert.equal((await first.completed).reason, 'cancelled');
  const retry = gate.begin('second', bytes, 'text/plain'); assert.equal(retry.initial.status, 'pending');
  result.resolve(safe); assert.equal((await retry.completed).status, 'clear');
});

test('timeout with an uncooperative classifier settles without showing content', async () => {
  const never = deferred<ContentScores>();
  const gate = new LocalContentDisplay(port(() => never.promise), { maxConcurrent: 1, maxBytes: 1024, timeoutMs: 10 });
  gate.configure(enabled); const job = gate.begin('event', bytes, 'text/plain');
  const decision = await job.completed; assert.equal(decision.reason, 'timeout');
  assert.equal(gate.canDisplay('event', bytes, decision), false);
  never.resolve(safe);
});

test('errors, NaN and missing categories never become a clear decision', async () => {
  for (const classify of [
    async () => { throw new Error('fixture failure'); },
    async () => ({ ...safe, gore: Number.NaN }),
    async () => ({ ...safe, sexual_content: 1.1 }),
  ]) {
    const gate = new LocalContentDisplay(port(classify)); gate.configure(enabled);
    const decision = await gate.begin('event', bytes, 'text/plain').completed;
    assert.equal(decision.reason, 'classification_failed');
    assert.equal(gate.canDisplay('event', bytes, decision), false);
  }
});

test('invalid settings and oversized content are rejected without scanning', () => {
  let calls = 0;
  const gate = new LocalContentDisplay(port(async () => { ++calls; return safe; }), { maxConcurrent: 1, maxBytes: 1, timeoutMs: 1000 });
  assert.throws(() => gate.configure({ ...enabled, thresholds: { ...enabled.thresholds, gore: 0 } }), /Invalid/);
  gate.configure(enabled); assert.equal(gate.begin('event', bytes, 'text/plain').initial.reason, 'resource_limit');
  assert.equal(calls, 0); gate.dispose();
});
