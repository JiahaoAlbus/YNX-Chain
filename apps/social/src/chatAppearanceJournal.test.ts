import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createChatAppearanceJournal } from './chatAppearanceJournal';
import { defaultChatAppearance } from './chatAppearance';
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
