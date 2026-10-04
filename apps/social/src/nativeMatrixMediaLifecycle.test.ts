import assert from 'node:assert/strict';
import test from 'node:test';
import { MatrixMediaPreview, type MatrixMediaLease } from './nativeMatrixMedia';

const room = '!original:example.org', event = '$original';
const original: MatrixMediaLease = { leaseId: '12345678-1234-1234-1234-123456789abc', roomId: room, eventId: event,
  filename: 'Original.png', mimeType: 'image/png', bytes: 100, uri: 'file:///private/cache/original', imagePreview: true };

function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

test('native media lease is captured before awaiting post-download authority', async () => {
  const supplied = { ...original }, waiting = gate(), finish = gate(); let reviewed = 0;
  const viewer = new MatrixMediaPreview({ open: async () => supplied, release: async () => {} }, async () => {
    if (++reviewed === 2) { waiting.resolve(); await finish.promise; }
  });
  const pending = viewer.open(room, event); await waiting.promise;
  supplied.uri = 'file:///private/cache/other'; supplied.filename = 'Other.png'; supplied.bytes = 200;
  finish.resolve(); const received = await pending;
  assert.deepEqual(received, original); assert.ok(Object.isFrozen(received));
  assert.equal(Object.isFrozen(supplied), false); await viewer.close();
});

test('retired late lease releases the original captured handle, not a mutated native DTO', async () => {
  const supplied = { ...original }, waiting = gate(), finish = gate(); const released: string[] = []; let reviewed = 0;
  const viewer = new MatrixMediaPreview({ open: async () => supplied, release: async id => { released.push(id); } }, async () => {
    if (++reviewed === 2) { waiting.resolve(); await finish.promise; }
  });
  const pending = viewer.open(room, event); await waiting.promise;
  supplied.leaseId = '87654321-1234-1234-1234-123456789abc';
  await viewer.close(); finish.resolve(); await assert.rejects(pending, /MATRIX_MEDIA_RETIRED/);
  assert.equal(viewer.snapshot(), undefined); assert.deepEqual(released, [original.leaseId]);
});

test('overlapping close paths share one actual native release', async () => {
  const waiting = gate(), finish = gate(); let attempts = 0;
  const viewer = new MatrixMediaPreview({ open: async () => original, release: async () => {
    ++attempts; waiting.resolve(); await finish.promise;
  } }, async () => {});
  await viewer.open(room, event);
  const first = viewer.close(); await waiting.promise; const second = viewer.close();
  await new Promise<void>(done => setImmediate(done)); finish.resolve();
  await first; await second;
  assert.equal(attempts, 1); assert.equal(viewer.snapshot(), undefined);
});

test('shared cleanup failure retains the original handle for a later successful retry', async () => {
  const waiting = gate(), finish = gate(); let attempts = 0, available = false;
  const viewer = new MatrixMediaPreview({ open: async () => original, release: async () => {
    ++attempts; if (!available) { waiting.resolve(); await finish.promise; throw new Error('NATIVE_RELEASE_UNAVAILABLE'); }
  } }, async () => {});
  await viewer.open(room, event);
  const first = assert.rejects(viewer.close(), /NATIVE_RELEASE_UNAVAILABLE/); await waiting.promise;
  const second = assert.rejects(viewer.close(), /NATIVE_RELEASE_UNAVAILABLE/);
  await new Promise<void>(done => setImmediate(done)); finish.resolve(); await first; await second;
  assert.equal(attempts, 1); assert.equal(viewer.snapshot(), undefined);
  available = true; await viewer.close(); assert.equal(attempts, 2);
  await viewer.close(); assert.equal(attempts, 2);
});
