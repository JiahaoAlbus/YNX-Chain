import assert from 'node:assert/strict';
import test from 'node:test';
import { checkedMatrixBinding, NativeMatrixConsumer, type NativeMatrixBridge, type MatrixBinding, type MatrixNativeEvent } from './nativeMatrix';
import type { MatrixPendingIntent } from './nativeMatrixRecovery';

const binding: MatrixBinding = { account: 'ynx1abc123', homeserverUrl: 'https://hs.example.test', userId: '@original:example.test', deviceId: 'ORIGINAL', authorityId: 'original-authority', expiresAtMs: Date.now() + 3600000 };
const person = 'sp_' + 'a'.repeat(32);
const room = { roomId: '!room:example.test', name: 'Private', encrypted: true, joined: true, members: [binding.userId, '@peer:example.test'] };
function fixture() {
  let current = binding;
  let accepted = true;
  let sendCount = 0;
  let restoreWait: (() => Promise<void>) | undefined;
  let listener: ((event: MatrixNativeEvent) => void) | undefined;
  let originalEntries: MatrixPendingIntent[] = [];
  const bridge: NativeMatrixBridge = {
    async restore() { await restoreWait?.(); return { generation: 7 }; }, invalidate() {}, async suspend() {},
    async rooms() { return [room]; }, async directRoom() { return room; }, async observeRoom() {}, async closeRoom() {},
    async pendingIntents() { return originalEntries.map(entry => ({ ...entry })); },
    async stageFile() { return { uri: 'file:///private/staging/original' }; },
    async sendText(_generation, roomId, intentId, body) { sendCount++; originalEntries.push({ roomId, intentId, body, kind: 'text', state: 'queued', eventId: null }); return { queued: true }; }, async sendFile() { return { queued: true }; },
    async readEvent(_generation, _room, eventId) { const original = originalEntries.find(entry => entry.eventId === eventId); return { eventId, transactionId: null, sender: binding.userId, own: true, remote: true, kind: 'message', body: original?.body ?? 'Original', intentId: original?.intentId }; },
    async requestVerification() { return { attempt: 1 }; }, async verificationAction() {}, async logout() {},
    addListener(_event, callback) { listener = callback; return { remove() { listener = undefined; } }; }
  };
  const consumer = new NativeMatrixConsumer(bridge, async () => current, async () => ({ personId: person, userId: '@peer:example.test', accepted, blocked: false, authorityId: current.authorityId }));
  return { consumer, bridge, setCurrent(value: MatrixBinding) { current = value; }, rejectPeer() { accepted = false; },
    setRestoreWait(value: () => Promise<void>) { restoreWait = value; }, setOriginals(entries: MatrixPendingIntent[]) { originalEntries = entries; },
    originals: () => originalEntries, count: () => sendCount, emit(event: MatrixNativeEvent) { listener?.(event); } };
}

test('binding rejects insecure HS, expired authority, callback URLs and invalid identity', () => {
  for (const value of [{ ...binding, homeserverUrl: 'http://hs.example.test' }, { ...binding, expiresAtMs: 0 },
    { ...binding, homeserverUrl: 'https://hs.example.test/callback' }, { ...binding, userId: 'wallet-address' }]) {
    assert.throws(() => checkedMatrixBinding(value));
  }
});
test('real consumer gate differentiates queue acceptance from delivery', async () => {
  const f = fixture(); await f.consumer.restore(); await f.consumer.open(person);
  assert.deepEqual(await f.consumer.send('native-matrix-' + '1'.repeat(32), 'Original'), { queued: true, delivered: false });
  assert.equal(f.count(), 1);
});
test('same original intent never generates a new SDK queue transaction', async () => {
  const f = fixture(); await f.consumer.restore(); await f.consumer.open(person);
  const intent = 'native-matrix-' + '2'.repeat(32);
  await f.consumer.send(intent, 'Original');
  await assert.rejects(f.consumer.send(intent, 'Original'), /RECONCILIATION/);
  await assert.rejects(f.consumer.send(intent, 'Changed'), /COLLISION/);
  assert.equal(f.count(), 1);
});
test('fresh accepted-peer readback is required before send', async () => {
  const f = fixture(); await f.consumer.restore(); await f.consumer.open(person); f.rejectPeer();
  await assert.rejects(f.consumer.send('native-matrix-' + '3'.repeat(32), 'Original'), /ACCEPTED_PEER/);
  assert.equal(f.count(), 0);
});
test('authority changes during native restoration fence the late result', async () => {
  const f = fixture(); let resolve!: () => void;
  f.setRestoreWait(() => new Promise<void>(r => { resolve = r; }));
  const task = f.consumer.restore();
  await new Promise(r => setImmediate(r));
  f.setCurrent({ ...binding, account: 'ynx1next123', authorityId: 'next-authority' }); resolve();
  await assert.rejects(task, /STALE_AUTHORITY/);
  await assert.rejects(f.consumer.rooms(), /SESSION_REQUIRED/);
});
test('unencrypted or widened room is refused before SDK sending', async () => {
  const f = fixture(); f.bridge.directRoom = async () => ({ ...room, encrypted: false });
  await f.consumer.restore(); await assert.rejects(f.consumer.open(person), /POLICY_MISMATCH/);
  assert.equal(f.count(), 0);
});
test('lock fences old native plaintext callbacks and clears visible view', async () => {
  const f = fixture(); const events: MatrixNativeEvent[] = []; f.consumer.listen(event => events.push(event));
  await f.consumer.restore(); await f.consumer.open(person); f.consumer.lock();
  f.emit({ generation: 7, type: 'timeline', roomId: room.roomId, events: [] });
  assert.equal(events.at(-1)?.type, 'locked');
});

test('restored original journal prevents a changed body or replacement nonce', async () => {
  const f = fixture(); const id = 'native-matrix-' + '4'.repeat(32);
  await f.consumer.restore(); await f.consumer.open(person); await f.consumer.send(id, 'Original');
  f.consumer.lock(); await f.consumer.restore(); await f.consumer.open(person);
  const [original] = await f.consumer.originals();
  assert.ok(original, 'the original intent must survive restoration');
  assert.equal(original.intentId, id);
  await assert.rejects(f.consumer.send(id, 'Changed'), /COLLISION/);
  await assert.rejects(f.consumer.send('native-matrix-' + '5'.repeat(32), 'Replacement'), /RECONCILIATION/);
  await assert.rejects(f.consumer.file('native-matrix-' + '6'.repeat(32), 'file:///private/staging/file', 'image/png', ''), /RECONCILIATION/);
  assert.equal(f.count(), 1);
});
test('an SDK observation does not settle or delete the original journal', async () => {
  const f = fixture(); const id = 'native-matrix-' + '7'.repeat(32);
  f.setOriginals([{ intentId: id, roomId: room.roomId, kind: 'text', body: 'Original', state: 'sdk-observed-needs-authenticated-readback', eventId: '$original' }]);
  await f.consumer.restore(); await f.consumer.open(person);
  const proof = await f.consumer.inspectOriginal(id);
  assert.equal(proof.sdkObserved, true); assert.equal(proof.delivered, false);
  assert.equal(proof.freshServerReadback, false); assert.equal(proof.socialIndexConfirmed, false);
  assert.equal(f.originals().length, 1);
  f.bridge.readEvent = async () => ({ eventId: '$original', transactionId: null, sender: binding.userId, own: true, remote: true, kind: 'message', body: 'Original', intentId: 'native-matrix-' + '8'.repeat(32) });
  await assert.rejects(f.consumer.inspectOriginal(id), /ORIGINAL_EVENT_CONFLICT/);
});
test('an older restore completion cannot invalidate a newer successful restoration', async () => {
  const f = fixture(); let completeOld!: (value: { generation: number }) => void;
  let restores = 0; let invalidations = 0;
  f.bridge.invalidate = () => { invalidations++; };
  f.bridge.restore = async () => ++restores === 1 ? new Promise(resolve => { completeOld = resolve; }) : { generation: 8 };
  const older = f.consumer.restore(); const rejected = assert.rejects(older, /STALE_AUTHORITY/);
  await new Promise(resolve => setImmediate(resolve));
  await f.consumer.restore(); const before = invalidations;
  completeOld({ generation: 7 }); await rejected;
  assert.equal(invalidations, before); assert.equal((await f.consumer.rooms()).length, 1);
});
test('authority expiry clears the view without deleting native original entries', async () => {
  const f = fixture(); const seen: MatrixNativeEvent[] = [];
  f.consumer.listen(event => seen.push(event));
  f.setOriginals([{ intentId: 'native-matrix-' + '9'.repeat(32), roomId: room.roomId, kind: 'file', body: null, state: 'unknown', eventId: null }]);
  f.setCurrent({ ...binding, expiresAtMs: Date.now() + 70 });
  await f.consumer.restore(); await f.consumer.open(person);
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(seen.at(-1)?.type, 'locked'); assert.equal(f.originals().length, 1);
  await assert.rejects(f.consumer.rooms(), /SESSION_REQUIRED/);
});
test('verification rechecks the accepted person before approving SDK trust', async () => {
  const f = fixture(); let actions = 0;
  f.bridge.verificationAction = async () => { actions++; };
  await f.consumer.restore(); await f.consumer.open(person); await f.consumer.requestVerification(person);
  f.rejectPeer(); await assert.rejects(f.consumer.verification('approve', 1), /ACCEPTED_PEER/);
  assert.equal(actions, 0);
});
test('SAS requires matching peer, current SDK revision and one human approval attempt', async () => {
  const f = fixture(); let actions = 0;
  f.bridge.verificationAction = async () => { actions++; };
  await f.consumer.restore(); await f.consumer.open(person); await f.consumer.requestVerification(person);
  await assert.rejects(f.consumer.verification('approve', 1), /CURRENT_SAS/);
  f.emit({ generation: 7, type: 'sas', peerUserId: '@peer:example.test', verificationAttempt: 1, revision: 2, values: ['1234', '2345', '3456'] });
  await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(f.consumer.verification('approve', 1), /CURRENT_SAS/);
  await f.consumer.verification('approve', 2);
  await assert.rejects(f.consumer.verification('approve', 2), /CURRENT_SAS/);
  assert.equal(actions, 1);
});
test('another peer cannot feed comparison values into the reviewed verification flow', async () => {
  const f = fixture(); const seen: MatrixNativeEvent[] = []; f.consumer.listen(event => seen.push(event));
  await f.consumer.restore(); await f.consumer.open(person); await f.consumer.requestVerification(person);
  f.emit({ generation: 7, type: 'sas', peerUserId: '@other:example.test', verificationAttempt: 1, revision: 1, values: ['1234', '2345', '3456'] });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(seen.at(-1)?.type, 'locked');
  await assert.rejects(f.consumer.verification('approve', 1), /FLOW_REQUIRED/);
});

test('native timeline input is snapshotted before asynchronous authority review', async () => {
  const f = fixture(), seen: MatrixNativeEvent[] = [];
  f.consumer.listen(event => seen.push(event));
  await f.consumer.restore(); await f.consumer.open(person);
  const message = { eventId: '$original', transactionId: null, sender: '@peer:example.test',
    own: false, remote: true, kind: 'message', body: 'original incoming content' };
  const original: MatrixNativeEvent = { generation: 7, type: 'timeline', roomId: room.roomId, events: [message] };
  f.emit(original);
  message.body = 'changed during authority await';
  original.events?.push({ ...message, eventId: '$injected' });
  await new Promise(resolve => setImmediate(resolve));
  const delivered = seen.find(event => event.type === 'timeline');
  assert.ok(delivered);
  assert.equal(delivered.events?.length, 1);
  assert.equal(delivered.events?.[0]?.body, 'original incoming content');
  assert.equal(message.body, 'changed during authority await');
  assert.equal(Object.isFrozen(message), false);
  f.consumer.lock();
});

test('producer reuse cannot change captured generation or route during review', async () => {
  const f = fixture(), seen: MatrixNativeEvent[] = [];
  f.consumer.listen(event => seen.push(event));
  await f.consumer.restore(); await f.consumer.open(person);
  const original: MatrixNativeEvent = { generation: 7, type: 'timeline', roomId: room.roomId, events: [] };
  f.emit(original);
  original.generation = 8;
  original.roomId = '!other:example.test';
  await new Promise(resolve => setImmediate(resolve));
  const delivered = seen.find(event => event.type === 'timeline');
  assert.ok(delivered);
  assert.equal(delivered.generation, 7);
  assert.equal(delivered.roomId, room.roomId);
  f.consumer.lock();
});

test('SAS values retain the original SDK frame across asynchronous review', async () => {
  const f = fixture(), seen: MatrixNativeEvent[] = [];
  f.consumer.listen(event => seen.push(event));
  await f.consumer.restore(); await f.consumer.open(person); await f.consumer.requestVerification(person);
  const values = ['1234', '2345', '3456'];
  const original: MatrixNativeEvent = { generation: 7, type: 'sas', peerUserId: '@peer:example.test',
    verificationAttempt: 1, revision: 2, values };
  f.emit(original);
  values[0] = 'changed'; values.push('injected');
  await new Promise(resolve => setImmediate(resolve));
  const delivered = seen.find(event => event.type === 'sas');
  assert.ok(delivered);
  assert.deepEqual(delivered.values, ['1234', '2345', '3456']);
  assert.equal(Object.isFrozen(values), false);
  assert.equal(Object.isFrozen(delivered.values), true);
  f.consumer.lock();
});

test('one subscriber cannot rewrite another subscriber native event view', async () => {
  const f = fixture(), seen: MatrixNativeEvent[] = [], mutations: boolean[] = [];
  f.consumer.listen(event => {
    if (event.type !== 'timeline' || !event.events?.[0]) return;
    mutations.push(Reflect.set(event, 'roomId', '!changed:example.test'));
    mutations.push(Reflect.set(event.events[0], 'body', 'changed by subscriber'));
    mutations.push(Reflect.set(event.events, 'length', 0));
  });
  f.consumer.listen(event => seen.push(event));
  await f.consumer.restore(); await f.consumer.open(person);
  f.emit({ generation: 7, type: 'timeline', roomId: room.roomId, events: [{ eventId: '$original',
    transactionId: null, sender: '@peer:example.test', own: false, remote: true,
    kind: 'message', body: 'original incoming content' }] });
  await new Promise(resolve => setImmediate(resolve));
  const delivered = seen.find(event => event.type === 'timeline');
  assert.ok(delivered);
  assert.deepEqual(mutations, [false, false, false]);
  assert.equal(delivered.roomId, room.roomId);
  assert.equal(delivered.events?.[0]?.body, 'original incoming content');
  assert.ok(Object.isFrozen(delivered) && Object.isFrozen(delivered.events) && Object.isFrozen(delivered.events?.[0]));
  f.consumer.lock();
});
