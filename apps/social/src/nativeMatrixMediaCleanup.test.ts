import assert from 'node:assert/strict';
import test from 'node:test';
import { MatrixMediaPreview, type MatrixMediaLease } from './nativeMatrixMedia';

const room = '!original:example.org', event = '$original';
const original: MatrixMediaLease = { leaseId: '12345678-1234-1234-1234-123456789abc', roomId: room, eventId: event,
  filename: 'Original.png', mimeType: 'image/png', bytes: 100, uri: 'file:///private/cache/original', imagePreview: true };

test('failed close immediately hides plaintext but retains the original cleanup lease for retry', async () => {
  const attempts: string[] = [];
  const viewer = new MatrixMediaPreview({ open: async () => original, release: async id => {
    attempts.push(id); if (attempts.length === 1) throw new Error('NATIVE_RELEASE_UNAVAILABLE');
  } }, async () => {});
  await viewer.open(room, event); await assert.rejects(viewer.close(), /RELEASE_UNAVAILABLE/);
  assert.equal(viewer.snapshot(), undefined);
  await viewer.close(); assert.deepEqual(attempts, [original.leaseId, original.leaseId]);
  await viewer.close(); assert.equal(attempts.length, 2);
});

test('a replacement cannot download while the original cleanup still fails', async () => {
  let available = false, opened = 0; const attempts: string[] = [];
  const viewer = new MatrixMediaPreview({ open: async (_room, requested) => {
    ++opened; return { ...original, eventId: requested };
  }, release: async id => { attempts.push(id); if (!available) throw new Error('NATIVE_RELEASE_UNAVAILABLE'); } }, async () => {});
  await viewer.open(room, event);
  await assert.rejects(viewer.open(room, '$next'), /RELEASE_UNAVAILABLE/);
  assert.equal(opened, 1); assert.equal(viewer.snapshot(), undefined);
  available = true; await viewer.open(room, '$next'); assert.equal(opened, 2);
  assert.deepEqual(attempts, [original.leaseId, original.leaseId]);
  await viewer.close();
});

test('a retired download whose release fails is still cleaned by the next close', async () => {
  let finish!: (lease: MatrixMediaLease) => void; let released = 0;
  const viewer = new MatrixMediaPreview({ open: () => new Promise(resolve => { finish = resolve; }),
    release: async () => { if (++released === 1) throw new Error('NATIVE_RELEASE_UNAVAILABLE'); } }, async () => {});
  const pending = viewer.open(room, event); await new Promise(r => setImmediate(r));
  await viewer.close(); finish(original); await assert.rejects(pending, /RELEASE_UNAVAILABLE/);
  assert.equal(viewer.snapshot(), undefined); await viewer.close(); assert.equal(released, 2);
});
