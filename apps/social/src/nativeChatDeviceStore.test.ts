import assert from 'node:assert/strict';
import test from 'node:test';
import { createNativeChatDeviceStore, chatDeviceAccountStorageKey, type ProtectedChatDeviceStorage } from './nativeChatDeviceStore';
import type { StoredChatDevice } from './scopedSessionBridge';

const currentKey = 'ynx.social.device.v1';
const accountA = '0x1111111111111111111111111111111111111111';
const accountB = '0x2222222222222222222222222222222222222222';
const device = (account: string, seed = '1'): StoredChatDevice => ({
  account, deviceId: `social-${seed.repeat(24)}`,
  signingSeed: seed.repeat(64), encryptionSeed: '3'.repeat(64),
});

function fixture() {
  const values = new Map<string, string>();
  const writes: string[] = [];
  let failKey = '', dropKey = '', creates = 0;
  const storage: ProtectedChatDeviceStorage = {
    async get(key) { return values.get(key) ?? null; },
    async set(key, raw) {
      writes.push(key);
      if (key === failKey) throw new Error('protected store unavailable');
      if (key !== dropKey) values.set(key, raw);
    },
  };
  const reopen = () => createNativeChatDeviceStore(storage,
    account => { creates++; return device(account, account === accountA ? '1' : '2'); });
  return { values, writes, store: reopen(), reopen, fail(key: string) { failKey = key; }, drop(key: string) { dropKey = key; }, creates: () => creates };
}

test('switch archives exact original device before selection; cold return never rotates keys', async () => {
  const f = fixture(), original = JSON.stringify(device(accountA));
  f.values.set(currentKey, original);
  await f.store.select(accountB);
  assert.equal(f.values.get(chatDeviceAccountStorageKey(accountA)), original);
  assert.deepEqual(await f.reopen().select(accountA), device(accountA));
  assert.equal(f.creates(), 1);
  assert.equal(f.values.get(currentKey), original);
});

for (const failure of ['throw', 'lost-readback']) {
  test(`old archive ${failure} rejects switch and preserves active keys`, async () => {
    const f = fixture(), original = JSON.stringify(device(accountA));
    f.values.set(currentKey, original);
    const key = chatDeviceAccountStorageKey(accountA);
    if (failure === 'throw') f.fail(key); else f.drop(key);
    await assert.rejects(f.store.select(accountB));
    assert.equal(f.values.get(currentKey), original);
    assert.equal(f.creates(), 0);
    assert.equal(f.values.has(chatDeviceAccountStorageKey(accountB)), false);
  });
}

for (const slot of ['active', 'old-archive', 'target-archive']) {
  test(`empty existing ${slot} is corruption, not permission to generate replacement keys`, async () => {
    const f = fixture(), original = JSON.stringify(device(accountA));
    f.values.set(currentKey, original);
    const key = slot === 'active' ? currentKey
      : chatDeviceAccountStorageKey(slot === 'old-archive' ? accountA : accountB);
    f.values.set(key, '');
    await assert.rejects(f.store.select(accountB));
    assert.equal(f.values.get(key), '');
    if (slot !== 'active') assert.equal(f.values.get(currentKey), original);
    assert.equal(f.creates(), 0);
  });
}

test('conflicting existing same-account archive is not overwritten', async () => {
  const f = fixture(), original = JSON.stringify(device(accountA));
  const alternate = JSON.stringify(device(accountA, '4'));
  f.values.set(currentKey, original);
  f.values.set(chatDeviceAccountStorageKey(accountA), alternate);
  await assert.rejects(f.store.select(accountB), /conflicts/);
  assert.equal(f.values.get(currentKey), original);
  assert.equal(f.values.get(chatDeviceAccountStorageKey(accountA)), alternate);
  assert.deepEqual(f.writes, []);
});

test('legacy owner from original session is retained without rewriting active bytes', async () => {
  const f = fixture();
  const legacy = { ...device(accountA), account: undefined };
  const raw = JSON.stringify(legacy);
  f.values.set(currentKey, raw);
  f.values.set('ynx.social.session.v1', JSON.stringify({ session: { account: accountA } }));
  assert.deepEqual(await f.store.select(accountA), device(accountA));
  assert.equal(f.values.get(currentKey), raw);
  assert.deepEqual(JSON.parse(f.values.get(chatDeviceAccountStorageKey(accountA))!), device(accountA));
  assert.equal(f.creates(), 0);
});

test('unbound legacy device is not rotated or deleted', async () => {
  const f = fixture(), raw = JSON.stringify({ ...device(accountA), account: undefined });
  f.values.set(currentKey, raw);
  await assert.rejects(f.store.select(accountB), /ownership requires recovery/);
  assert.equal(f.values.get(currentKey), raw);
  assert.equal(f.creates(), 0);
  assert.deepEqual(f.writes, []);
});

test('failed target archive does not update selection and an explicit retry recovers', async () => {
  const f = fixture(), original = JSON.stringify(device(accountA));
  f.values.set(currentKey, original);
  f.drop(chatDeviceAccountStorageKey(accountB));
  await assert.rejects(f.store.select(accountB), /readback failed/);
  assert.equal(f.values.get(currentKey), original);
  f.drop('');
  await f.store.select(accountB);
  assert.deepEqual(JSON.parse(f.values.get(currentKey)!), device(accountB, '2'));
  assert.equal(f.values.get(chatDeviceAccountStorageKey(accountA)), original);
});

test('overlapping selections are serialized and retain both original devices', async () => {
  const f = fixture();
  await Promise.all([f.store.select(accountA), f.store.select(accountB), f.store.select(accountA)]);
  assert.equal(f.creates(), 2);
  assert.deepEqual(JSON.parse(f.values.get(currentKey)!), device(accountA));
  assert.deepEqual(JSON.parse(f.values.get(chatDeviceAccountStorageKey(accountB))!), device(accountB, '2'));
});

test('wrong-account archived carrier rejects without replacing the active device', async () => {
  const f = fixture(), original = JSON.stringify(device(accountA));
  f.values.set(currentKey, original);
  f.values.set(chatDeviceAccountStorageKey(accountB), JSON.stringify(device(accountA)));
  await assert.rejects(f.store.select(accountB), /account mismatch/);
  assert.equal(f.values.get(currentKey), original);
});

for (const failure of ['throw', 'lost-readback']) {
  test(`active selection ${failure} retains both archives; explicit cold retry uses existing keys`, async () => {
    const f = fixture(), original = JSON.stringify(device(accountA));
    f.values.set(currentKey, original);
    if (failure === 'throw') f.fail(currentKey); else f.drop(currentKey);
    await assert.rejects(f.store.select(accountB));
    assert.equal(f.values.get(currentKey), original);
    assert.equal(f.values.get(chatDeviceAccountStorageKey(accountA)), original);
    assert.deepEqual(JSON.parse(f.values.get(chatDeviceAccountStorageKey(accountB))!), device(accountB, '2'));
    f.fail(''); f.drop('');
    assert.deepEqual(await f.reopen().select(accountB), device(accountB, '2'));
    assert.equal(f.creates(), 1);
  });
}
