import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { ChatAppearanceStorageLimitError, chatAppearanceEnvelopeLimit, createChatAppearanceJournal } from './chatAppearanceJournal';
import { defaultChatAppearance, parseChatAppearance } from './chatAppearance';
const slot = 'a_' + 'a'.repeat(64);
const hash = async (raw: string) => createHash('sha256').update(raw).digest('hex');
test('partial inactive slot preserves the prior valid preference and next save recovers without destroying it', async () => {
  const disk = new Map<string, string>(); let partial = false;
  const port = { read: async (_: string, side: 'a' | 'b') => disk.get(side) ?? null,
    write: async (_: string, side: 'a' | 'b', raw: string) => { disk.set(side, partial ? raw.slice(0, 11) : raw); }, hash };
  const journal = createChatAppearanceJournal(port), original = JSON.stringify(defaultChatAppearance());
  await journal.write(slot, original); partial = true;
  await assert.rejects(journal.write(slot, JSON.stringify({ ...defaultChatAppearance(), theme: 'dark' })), /WRITE_NOT_CONFIRMED/);
  assert.equal(await createChatAppearanceJournal(port).read(slot), original);
  partial = false; await journal.write(slot, JSON.stringify({ ...defaultChatAppearance(), theme: 'dark' }));
  assert.equal(JSON.parse((await createChatAppearanceJournal(port).read(slot))!).theme, 'dark');
  assert.equal(JSON.parse(disk.get('a')!).raw, original);
});
test('both corrupt slots fail closed instead of resetting account preferences', async () => {
  let writes = 0;
  const journal = createChatAppearanceJournal({ read: async () => '{partial', write: async () => { writes++; }, hash });
  await assert.rejects(journal.read(slot), /NEEDS_RECOVERY/);
  await assert.rejects(journal.write(slot, JSON.stringify(defaultChatAppearance())), /NEEDS_RECOVERY/); assert.equal(writes, 0);
});
test('modified bytes without their exact SHA are not accepted as the current setting', async () => {
  const first = JSON.stringify(defaultChatAppearance()), next = JSON.stringify({ ...defaultChatAppearance(), theme: 'dark' });
  const journal = createChatAppearanceJournal({ read: async (_, side) => side === 'a' ? JSON.stringify({ sequence: 1, raw: first, sha256: await hash(first) }) : JSON.stringify({ sequence: 2, raw: next, sha256: await hash(first) }), write: async () => {}, hash });
  assert.equal(await journal.read(slot), first);
});
test('theme arrays and objects cannot impersonate a stored primitive theme', () => {
  for (const theme of [['dark'], ['system'], {}, null, 1])
    assert.throws(() => parseChatAppearance(JSON.stringify({ ...defaultChatAppearance(), theme })), /INVALID_STORAGE/);
  for (const theme of ['system', 'light', 'dark'])
    assert.equal(parseChatAppearance(JSON.stringify({ ...defaultChatAppearance(), theme })).theme, theme);
});
test('oversized inactive envelope preserves exact valid settings without hashing its contents', async () => {
  const original = JSON.stringify({ ...defaultChatAppearance(), theme: 'dark' });
  const valid = JSON.stringify({ sequence: 7, raw: original, sha256: await hash(original) });
  const seen: string[] = [];
  const journal = createChatAppearanceJournal({
    read: async (_, side) => side === 'a' ? ' '.repeat(chatAppearanceEnvelopeLimit + 1) : valid,
    write: async () => { throw new Error('unexpected write'); },
    hash: async raw => { seen.push(raw); return hash(raw); },
  });
  assert.equal(await journal.read(slot), original);
  assert.deepEqual(seen, [original]);
});
test('native pre-read resource limit preserves the other valid journal side', async () => {
  const original = JSON.stringify(defaultChatAppearance());
  const valid = JSON.stringify({ sequence: 2, raw: original, sha256: await hash(original) });
  const journal = createChatAppearanceJournal({
    read: async (_, side) => { if (side === 'a') throw new ChatAppearanceStorageLimitError(); return valid; },
    write: async () => { throw new Error('unexpected write'); }, hash,
  });
  assert.equal(await journal.read(slot), original);
});
test('both native resource-limited sides require recovery without a reset or write', async () => {
  let writes = 0;
  const journal = createChatAppearanceJournal({
    read: async () => { throw new ChatAppearanceStorageLimitError(); },
    write: async () => { writes++; }, hash,
  });
  await assert.rejects(journal.read(slot), /NEEDS_RECOVERY/);
  await assert.rejects(journal.write(slot, JSON.stringify(defaultChatAppearance())), /NEEDS_RECOVERY/);
  assert.equal(writes, 0);
});
test('generic journal I/O errors remain errors instead of silently selecting an old side', async () => {
  const failure = new Error('storage unavailable');
  const journal = createChatAppearanceJournal({ read: async () => { throw failure; }, write: async () => {}, hash });
  await assert.rejects(journal.read(slot), error => error === failure);
});
test('oversized nested preference is rejected before hashing', async () => {
  let hashes = 0;
  const envelope = JSON.stringify({ sequence: 1, raw: ' '.repeat(80001), sha256: 'a'.repeat(64) });
  assert(envelope.length < chatAppearanceEnvelopeLimit);
  const journal = createChatAppearanceJournal({
    read: async (_, side) => side === 'a' ? envelope : null,
    write: async () => { throw new Error('unexpected write'); },
    hash: async raw => { hashes++; return hash(raw); },
  });
  await assert.rejects(journal.read(slot), /NEEDS_RECOVERY/);
  assert.equal(hashes, 0);
});
test('newer valid setting hash infrastructure failure propagates instead of returning the older setting', async () => {
  const original = JSON.stringify(defaultChatAppearance());
  const latest = JSON.stringify({ ...defaultChatAppearance(), theme: 'dark' });
  const disk = new Map([
    ['a', JSON.stringify({ sequence: 1, raw: original, sha256: await hash(original) })],
    ['b', JSON.stringify({ sequence: 2, raw: latest, sha256: await hash(latest) })],
  ]);
  const failure = new Error('SHA provider unavailable'); let writes = 0;
  const journal = createChatAppearanceJournal({
    read: async (_, side) => disk.get(side) ?? null,
    write: async () => { writes++; },
    hash: async raw => { if (raw === latest) throw failure; return hash(raw); },
  });
  await assert.rejects(journal.read(slot), error => error === failure);
  await assert.rejects(journal.write(slot, original), error => error === failure);
  assert.equal(writes, 0);
  assert.equal(JSON.parse(disk.get('b')!).raw, latest);
});
test('invalid hash-provider output is not treated as a corrupt side or confirmed as saved', async () => {
  const original = JSON.stringify(defaultChatAppearance());
  const valid = JSON.stringify({ sequence: 1, raw: original, sha256: await hash(original) });
  let writes = 0;
  for (const digest of ['', 'x'.repeat(64), 'A'.repeat(64)]) {
    const journal = createChatAppearanceJournal({
      read: async (_, side) => side === 'a' ? valid : null,
      write: async () => { writes++; }, hash: async () => digest,
    });
    await assert.rejects(journal.read(slot), /HASH_PROVIDER_INVALID/);
    await assert.rejects(journal.write(slot, original), /HASH_PROVIDER_INVALID/);
  }
  const empty = createChatAppearanceJournal({ read: async () => null,
    write: async () => { writes++; }, hash: async () => 'invalid' });
  await assert.rejects(empty.write(slot, original), /HASH_PROVIDER_INVALID/);
  assert.equal(writes, 0);
});
test('persistence errors propagate without an acknowledgment or automatic retry', async () => {
  const failure = new Error('disk write failed'); let writes = 0;
  const journal = createChatAppearanceJournal({ read: async () => null,
    write: async () => { writes++; throw failure; }, hash });
  await assert.rejects(journal.write(slot, JSON.stringify(defaultChatAppearance())), error => error === failure);
  assert.equal(writes, 1);
});
