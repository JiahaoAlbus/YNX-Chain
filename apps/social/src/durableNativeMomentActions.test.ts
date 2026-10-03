import test from 'node:test';
import assert from 'node:assert/strict';
import { DurableNativeMomentActions } from './durableNativeMomentActions';

const account = 'ynx1' + 'a'.repeat(38);
const action = { kind: 'follow' as const, subject: 'alice', active: true };
function fixture() {
  const rows = new Map<string, string>();
  let nonces = 0;
  const storage = { read: async (key: string) => rows.get(key) ?? null, write: async (key: string, value: string) => { rows.set(key, value); } };
  const reopen = () => new DurableNativeMomentActions(async () => (++nonces).toString(16).padStart(32, '0'), storage);
  return { rows, storage, reopen, nonces: () => nonces };
}
test('cold retry preserves exact unknown request identity', async () => {
  const f = fixture(); let original = '';
  await assert.rejects(f.reopen().run(account, action, () => true, async (_, key) => { original = key; throw new Error('unknown'); }));
  assert.equal(await f.reopen().run(account, action, () => true, async (_, key) => { assert.equal(key, original); }), true);
  assert.equal(f.nonces(), 1);
});
test('cold unknown action cannot silently become opposite action', async () => {
  const f = fixture();
  await assert.rejects(f.reopen().run(account, action, () => true, async () => { throw new Error('unknown'); }));
  let calls = 0;
  await assert.rejects(f.reopen().run(account, { ...action, active: false }, () => true, async () => { calls++; }), /original pending/);
  assert.equal(calls, 0); assert.equal(f.nonces(), 1);
});
test('storage failure blocks transport', async () => {
  let calls = 0;
  const runner = new DurableNativeMomentActions(async () => '1'.repeat(32), { read: async () => null, write: async () => { throw new Error('locked'); } });
  await assert.rejects(runner.run(account, action, () => true, async () => { calls++; }), /locked/);
  assert.equal(calls, 0);
});
test('authority loss after persistence retains original and sends nothing', async () => {
  const f = fixture(); let live = true, calls = 0;
  const runner = new DurableNativeMomentActions(async () => '1'.repeat(32), { ...f.storage, write: async (key, value) => { await f.storage.write(key, value); live = false; } });
  assert.equal(await runner.run(account, action, () => live, async () => { calls++; }), false);
  assert.equal(calls, 0); assert.equal(f.rows.size, 1);
});
test('malformed retained record is not replaced or sent', async () => {
  const f = fixture();
  await f.reopen().run(account, action, () => true, async () => {});
  const key = [...f.rows.keys()][0]; assert.ok(key); f.rows.set(key, '{broken'); let calls = 0;
  await assert.rejects(f.reopen().run(account, action, () => true, async () => { calls++; }), /requires recovery/);
  assert.equal(calls, 0); assert.equal(f.rows.get(key), '{broken');
});
test('completed explicit next action gets a new request identity', async () => {
  const f = fixture(), keys: string[] = [];
  await f.reopen().run(account, action, () => true, async (_, key) => { keys.push(key); });
  await f.reopen().run(account, { ...action, active: false }, () => true, async (_, key) => { keys.push(key); });
  assert.notEqual(keys[0], keys[1]); assert.equal(f.nonces(), 2);
});
