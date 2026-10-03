import assert from 'node:assert/strict';
import test from 'node:test';
import { NativeMatrixConsumer, type MatrixBinding, type NativeMatrixBridge } from './nativeMatrix';
import type { MatrixMediaLease } from './nativeMatrixMedia';

// Controller-only unit fixtures; not a native download, canonical enrollment,
// decrypted file, installed app, delivery receipt or account authorization.
function fixture() {
  const binding: MatrixBinding = { account: 'ynx1original', userId: '@original:example.test', deviceId: 'ORIGINAL',
    homeserverUrl: 'https://hs.example.test', authorityId: 'original', expiresAtMs: Date.now() + 3600000 };
  const person = 'sp_' + 'a'.repeat(32), peer = '@peer:example.test';
  const room = { roomId: '!original:example.test', name: 'Original', encrypted: true, joined: true, members: [binding.userId, peer] };
  let generation = 0, accepted = true, opens = 0, cleanupFails = false, currentPeer = peer;
  const released: number[] = [];
  let onOpen: () => Promise<void> = async () => {};
  const lease: MatrixMediaLease = { leaseId: '12345678-1234-1234-1234-123456789abc', roomId: room.roomId,
    eventId: '$original', filename: 'Original.png', mimeType: 'image/png', bytes: 1, uri: 'file:///fixture/original.png', imagePreview: true };
  const bridge: NativeMatrixBridge = {
    restore: async () => ({ generation: ++generation }), invalidate() {}, suspend: async () => {},
    rooms: async () => [room], directRoom: async () => room, observeRoom: async () => {}, closeRoom: async () => {},
    pendingIntents: async () => [], stageFile: async () => ({ uri: 'file:///fixture' }), sendText: async () => ({ queued: true }),
    sendFile: async () => ({ queued: true }), readEvent: async () => ({ eventId: '$original', transactionId: null, sender: peer, own: false, remote: true, kind: 'message', body: null }),
    requestVerification: async () => ({ attempt: 1 }), verificationAction: async () => {}, logout: async () => {}, addListener: () => ({ remove() {} }),
    openReceivedMedia: async (gen, id, user, event) => {
      assert.equal(gen, generation); assert.equal(id, room.roomId); assert.equal(user, peer); assert.equal(event, lease.eventId);
      opens++; await onOpen(); return lease;
    },
    releaseReceivedMedia: async gen => { if (cleanupFails) { cleanupFails = false; throw new Error('CLEANUP_RETRY'); } released.push(gen); },
  };
  const consumer = new NativeMatrixConsumer(bridge, async () => binding,
    async () => ({ personId: person, userId: currentPeer, authorityId: binding.authorityId, accepted, blocked: false }));
  return { consumer, bridge, person, room, opens: () => opens, released, reject: () => { accepted = false; },
    onOpen: (callback: () => Promise<void>) => { onOpen = callback; }, failCleanup: () => { cleanupFails = true; },
    changePeer: () => { currentPeer = '@replacement:example.test'; } };
}
async function opened() { const f = fixture(); await f.consumer.restore(); await f.consumer.open(f.person); return f; }

test('received media is pinned to original room, event, peer and native generation', async () => {
  const f = await opened(), target = f.consumer.receivedMedia('$original');
  await assert.rejects(target.preview.open('!other:example.test', '$original'), /RETIRED/);
  await assert.rejects(target.preview.open(target.roomId, '$different'), /EVENT_MISMATCH/);
  assert.equal(f.opens(), 0);
  const lease = await target.preview.open(target.roomId, '$original');
  assert.equal(lease.filename, 'Original.png'); await target.preview.close(); assert.deepEqual(f.released, [1]);
});
test('missing native media exports never use a synthetic port', async () => {
  const f = await opened(); delete f.bridge.openReceivedMedia;
  assert.throws(() => f.consumer.receivedMedia('$original'), /NATIVE_MEDIA_BUILD_REQUIRED/);
  assert.equal(f.opens(), 0);
});
test('revoke during native download hides the returned file and releases original generation', async () => {
  const f = await opened(); f.onOpen(async () => f.reject()); const target = f.consumer.receivedMedia('$original');
  await assert.rejects(target.preview.open(target.roomId, '$original'), /ACCEPTED_PEER/);
  assert.deepEqual(f.released, [1]); await assert.rejects(f.consumer.rooms(), /SESSION_REQUIRED/);
});
test('late download cleanup cannot release or invalidate a newer restored generation', async () => {
  const f = await opened(); let resolve: (() => void) | undefined;
  f.onOpen(() => new Promise<void>(done => { resolve = done; }));
  const target = f.consumer.receivedMedia('$original'), task = target.preview.open(target.roomId, '$original');
  await new Promise(done => setImmediate(done));
  await f.consumer.restore(); await f.consumer.open(f.person);
  assert.ok(resolve); resolve(); await assert.rejects(task, /RETIRED/);
  assert.deepEqual(f.released, [1]); assert.equal((await f.consumer.rooms())[0]?.roomId, f.room.roomId);
});
test('failed cleanup retains original generation for explicit retry', async () => {
  const f = await opened(), target = f.consumer.receivedMedia('$original');
  await target.preview.open(target.roomId, '$original'); f.failCleanup();
  await assert.rejects(target.preview.close(), /CLEANUP_RETRY/);
  await target.preview.close(); assert.deepEqual(f.released, [1]);
});
test('accepted profile cannot substitute its Matrix identity during download even in a self-only room', async () => {
  const f = await opened(); f.room.members = f.room.members.slice(0, 1);
  f.onOpen(async () => f.changePeer()); const target = f.consumer.receivedMedia('$original');
  await assert.rejects(target.preview.open(target.roomId, '$original'), /STALE_PEER/);
  assert.deepEqual(f.released, [1]);
});
test('native failure without a returned lease retires only the original Matrix scope', async () => {
  const f = await opened(); f.onOpen(async () => { throw new Error('NATIVE_DOWNLOAD_FAILED'); });
  const target = f.consumer.receivedMedia('$original');
  await assert.rejects(target.preview.open(target.roomId, '$original'), /NATIVE_DOWNLOAD_FAILED/);
  await assert.rejects(f.consumer.rooms(), /SESSION_REQUIRED/);
});
