import assert from 'node:assert/strict';
import test from 'node:test';
import { checkedMatrixBinding, NativeMatrixConsumer, type NativeMatrixBridge, type MatrixBinding, type MatrixNativeEvent } from './nativeMatrix';

const binding: MatrixBinding = { account: 'ynx1abc123', homeserverUrl: 'https://hs.example.test', userId: '@original:example.test', deviceId: 'ORIGINAL', authorityId: 'original-authority', expiresAtMs: Date.now() + 3600000 };
const person = 'sp_' + 'a'.repeat(32);
const room = { roomId: '!room:example.test', name: 'Private', encrypted: true, joined: true, members: [binding.userId, '@peer:example.test'] };
function fixture() {
  let current = binding;
  let accepted = true;
  let sendCount = 0;
  let restoreWait: (() => Promise<void>) | undefined;
  let listener: ((event: MatrixNativeEvent) => void) | undefined;
  const bridge: NativeMatrixBridge = {
    async restore() { await restoreWait?.(); return { generation: 7 }; }, invalidate() {}, async suspend() {},
    async rooms() { return [room]; }, async directRoom() { return room; }, async observeRoom() {}, async closeRoom() {},
    async stageFile() { return { uri: 'file:///private/staging/original' }; },
    async sendText() { sendCount++; return { queued: true }; }, async sendFile() { return { queued: true }; },
    async readEvent(_generation, _room, eventId) { return { eventId, transactionId: null, sender: binding.userId, own: true, remote: true, kind: 'message', body: 'Original' }; },
    async requestVerification() {}, async verificationAction() {}, async logout() {},
    addListener(_event, callback) { listener = callback; return { remove() { listener = undefined; } }; }
  };
  const consumer = new NativeMatrixConsumer(bridge, async () => current, async () => ({ personId: person, userId: '@peer:example.test', accepted, blocked: false, authorityId: current.authorityId }));
  return { consumer, bridge, setCurrent(value: MatrixBinding) { current = value; }, rejectPeer() { accepted = false; },
    setRestoreWait(value: () => Promise<void>) { restoreWait = value; }, count: () => sendCount, emit(event: MatrixNativeEvent) { listener?.(event); } };
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
