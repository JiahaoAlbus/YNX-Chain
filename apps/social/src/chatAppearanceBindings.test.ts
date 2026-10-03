import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { deriveChatAppearanceSlots } from './chatAppearanceBindings';
import { ChatAppearanceStore, effectiveChatBackground } from './chatAppearance';
const hash = async (value: string) => createHash('sha256').update(value).digest('hex');

test('guest global appearance needs no identifier or hashing', async () => {
  const slots = await deriveChatAppearanceSlots(null, null, async () => { throw new Error('unexpected hash'); });
  assert.deepEqual(slots, { slot: 'guest', roomSlot: null });
});
test('guest conversation appearance has its own room slot, not the global destination', async () => {
  const first = await deriveChatAppearanceSlots(null, '!first:example.test', hash);
  const second = await deriveChatAppearanceSlots(null, '!second:example.test', hash);
  assert.equal(first.slot, 'guest'); assert.match(first.roomSlot!, /^r_[a-f0-9]{64}$/);
  assert.notEqual(first.roomSlot, second.roomSlot);
  const disk = new Map<string, string>();
  const store = new ChatAppearanceStore({ read: async slot => disk.get(slot) ?? null,
    write: async (slot, raw) => { disk.set(slot, raw); } });
  await store.open('guest');
  await store.save(first.slot, { room: first.roomSlot, background: { kind: 'preset', preset: 'ocean' } }, () => true);
  await store.save(second.slot, { room: second.roomSlot, background: { kind: 'preset', preset: 'sage' } }, () => true);
  const value = store.snapshot('guest')!;
  assert.deepEqual(value.background, { kind: 'preset', preset: 'mist' });
  assert.deepEqual(effectiveChatBackground(value, first.roomSlot), { kind: 'preset', preset: 'ocean' });
  assert.deepEqual(effectiveChatBackground(value, second.roomSlot), { kind: 'preset', preset: 'sage' });
});
test('account and room bindings remain isolated from guest and other accounts', async () => {
  const first = await deriveChatAppearanceSlots('@first:example.test', '!room:example.test', hash);
  const second = await deriveChatAppearanceSlots('@second:example.test', '!room:example.test', hash);
  const guest = await deriveChatAppearanceSlots(null, '!room:example.test', hash);
  assert.match(first.slot, /^a_[a-f0-9]{64}$/); assert.notEqual(first.slot, second.slot);
  assert.notEqual(first.slot, guest.slot); assert.equal(first.roomSlot, second.roomSlot);
});
test('malformed or empty identifiers refuse before hashing without guest fallback', async () => {
  let hashes = 0;
  for (const invalid of ['', '\uD800', '\uDC00', 'x\uD800z', 'x'.repeat(4097)]) {
    await assert.rejects(deriveChatAppearanceSlots(invalid, '!room:example.test', async value => { hashes++; return hash(value); }), /INVALID_IDENTIFIER/);
    await assert.rejects(deriveChatAppearanceSlots('@account:example.test', invalid, async value => { hashes++; return hash(value); }), /INVALID_IDENTIFIER/);
  }
  assert.equal(hashes, 0);
});
test('valid Unicode and emoji identifiers retain distinct bytes without normalization', async () => {
  const composed = await deriveChatAppearanceSlots('@\u00e9:example.test', '!\uD83D\uDE80:example.test', hash);
  const decomposed = await deriveChatAppearanceSlots('@e\u0301:example.test', '!\uD83D\uDE80:example.test', hash);
  assert.notEqual(composed.slot, decomposed.slot); assert.equal(composed.roomSlot, decomposed.roomSlot);
});
test('hash failures and invalid hash values do not redirect identifiers to guest', async () => {
  const failure = new Error('hash unavailable');
  await assert.rejects(deriveChatAppearanceSlots('@account:example.test', null, async () => { throw failure; }), error => error === failure);
  await assert.rejects(deriveChatAppearanceSlots('@account:example.test', null, async () => 'invalid'), /INVALID_SLOT/);
});
