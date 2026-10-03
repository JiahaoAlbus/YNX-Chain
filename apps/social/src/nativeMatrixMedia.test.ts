import assert from 'node:assert/strict';
import test from 'node:test';
import { MatrixMediaPreview, type MatrixMediaLease, type MatrixMediaPort } from './nativeMatrixMedia';

const room = '!original:example.org', event = '$original';
const lease: MatrixMediaLease = { leaseId: '12345678-1234-1234-1234-123456789abc', roomId: room, eventId: event,
  filename: '../original name.png', mimeType: 'image/png', bytes: 100, uri: 'file:///private/cache/sdk-file', imagePreview: true };

test('a received media preview retains the native handle until explicit close', async () => {
  const released: string[] = []; let reviewed = 0;
  const viewer = new MatrixMediaPreview({ open: async () => lease, release: async id => { released.push(id); } }, async () => { ++reviewed; });
  const original = await viewer.open(room, event);
  assert.equal(original.filename, '../original name.png'); // label, not a filesystem path
  assert.ok(Object.isFrozen(original)); assert.equal(reviewed, 2); assert.deepEqual(released, []);
  await viewer.close(); assert.equal(viewer.snapshot(), undefined); assert.deepEqual(released, [lease.leaseId]);
});

test('closing an in-flight native download releases its late handle without exposing it', async () => {
  let finish!: (value: MatrixMediaLease) => void; const released: string[] = [];
  const viewer = new MatrixMediaPreview({ open: () => new Promise(resolve => { finish = resolve; }), release: async id => { released.push(id); } }, async () => {});
  const pending = viewer.open(room, event); await new Promise(r => setImmediate(r));
  await viewer.close(); finish(lease); await assert.rejects(pending, /RETIRED/);
  assert.equal(viewer.snapshot(), undefined); assert.deepEqual(released, [lease.leaseId]);
});

test('revoked accepted contact releases downloaded plaintext before exposure', async () => {
  let reviewed = 0; const released: string[] = [];
  const viewer = new MatrixMediaPreview({ open: async () => lease, release: async id => { released.push(id); } }, async () => {
    if (++reviewed === 2) throw new Error('CONTACT_REVOKED');
  });
  await assert.rejects(viewer.open(room, event), /CONTACT_REVOKED/);
  assert.equal(viewer.snapshot(), undefined); assert.deepEqual(released, [lease.leaseId]);
});

test('event substitution, external URIs, unbounded files and active content cannot become image previews', async () => {
  for (const patch of [{ eventId: '$other' }, { roomId: '!other:example.org' }, { uri: 'https://example.org/file' },
    { bytes: Number.MAX_SAFE_INTEGER }, { bytes: 0 }, { mimeType: 'image/svg+xml', imagePreview: true },
    { mimeType: 'text/html', imagePreview: true }, { filename: 'bad\0name' }]) {
    const released: string[] = [];
    const port: MatrixMediaPort = { open: async () => ({ ...lease, ...patch }), release: async id => { released.push(id); } };
    const viewer = new MatrixMediaPreview(port, async () => {});
    await assert.rejects(viewer.open(room, event), /LEASE_INVALID/);
    assert.equal(viewer.snapshot(), undefined); assert.deepEqual(released, [lease.leaseId]);
  }
});

test('a second request retires a late earlier download without releasing the newer preview', async () => {
  let finish!: (value: MatrixMediaLease) => void; let count = 0; const released: string[] = [];
  const newer = { ...lease, eventId: '$new', leaseId: '87654321-1234-1234-1234-123456789abc' };
  const viewer = new MatrixMediaPreview({ open: () => ++count === 1 ? new Promise(resolve => { finish = resolve; }) : Promise.resolve(newer),
    release: async id => { released.push(id); } }, async () => {});
  const old = viewer.open(room, event); await new Promise(r => setImmediate(r));
  await viewer.open(room, '$new'); finish(lease); await assert.rejects(old, /RETIRED/);
  assert.equal(viewer.snapshot()?.eventId, '$new'); assert.deepEqual(released, [lease.leaseId]);
  await viewer.close(); assert.deepEqual(released, [lease.leaseId, newer.leaseId]);
});
