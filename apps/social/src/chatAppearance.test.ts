import test from 'node:test';
import assert from 'node:assert/strict';
import { ChatAppearanceStore, chatCanvas, checkedChatBackground, defaultChatAppearance, effectiveChatBackground, parseChatAppearance } from './chatAppearance';
const A = 'a_' + 'a'.repeat(64), B = 'a_' + 'b'.repeat(64), R = 'r_' + 'c'.repeat(64), S = 'r_' + 'd'.repeat(64);
function fixture() {
  const storage = new Map<string, string>(); let failure = false;
  const store = new ChatAppearanceStore({ read: async slot => storage.get(slot) ?? null, write: async (slot, raw) => { if (failure) throw Error('LOCAL_DISK_FULL'); storage.set(slot, raw); } });
  return { storage, store, fail: () => { failure = true; }, recover: () => { failure = false; } };
}
test('global defaults, room override and reset are distinct and survive a fresh store', async () => {
  const f = fixture(); await f.store.save(A, { background: { kind: 'preset', preset: 'ocean' } }, () => true);
  await f.store.save(A, { room: R, background: { kind: 'preset', preset: 'sage' } }, () => true);
  const reopened = new ChatAppearanceStore({ read: async slot => f.storage.get(slot) ?? null, write: async () => {} });
  const saved = await reopened.open(A);
  assert.deepEqual(effectiveChatBackground(saved, R), { kind: 'preset', preset: 'sage' });
  assert.deepEqual(effectiveChatBackground(saved, S), { kind: 'preset', preset: 'ocean' });
  await f.store.save(A, { room: R, background: null }, () => true);
  assert.deepEqual(effectiveChatBackground(f.store.snapshot(A)!, R), saved.background);
});
test('guest and two account scopes never share a preference', async () => {
  const f = fixture(); await f.store.save('guest', { background: { kind: 'preset', preset: 'ink' } }, () => true);
  await f.store.save(A, { background: { kind: 'image', id: '1'.repeat(32) }, theme: 'dark' }, () => true);
  assert.deepEqual(await f.store.open(B), defaultChatAppearance());
  assert.notDeepEqual(f.store.snapshot(A), f.store.snapshot('guest'));
});
test('cancel or stale selection never writes a setting', async () => {
  const f = fixture(); await assert.rejects(f.store.save(A, { room: R, background: null }, () => false), /STALE_VIEW/);
  assert.equal(f.storage.size, 0);
});
test('storage failure keeps the original background and can be retried', async () => {
  const f = fixture(); await f.store.open(A); f.fail();
  await assert.rejects(f.store.save(A, { background: { kind: 'preset', preset: 'ink' } }, () => true), /LOCAL_DISK_FULL/);
  assert.deepEqual(f.store.snapshot(A), defaultChatAppearance()); f.recover();
  await f.store.save(A, { background: { kind: 'preset', preset: 'ink' } }, () => true);
  assert.equal(f.store.snapshot(A)?.background.kind, 'preset');
});
test('queued room changes merge without dropping global or other room preferences', async () => {
  const f = fixture(); const first = f.store.save(A, { room: R, background: { kind: 'preset', preset: 'sage' } }, () => true);
  const second = f.store.save(A, { room: S, background: { kind: 'preset', preset: 'ocean' }, theme: 'dark' }, () => true);
  await first; await second; assert.equal(Object.keys(f.store.snapshot(A)!.rooms).length, 2);
  assert.equal(f.store.snapshot(A)?.theme, 'dark');
});
test('a write finishing after account change belongs only to the original account', async () => {
  let finish: (() => void) | undefined, current = true;
  const data = new Map<string, string>();
  const store = new ChatAppearanceStore({ read: async slot => data.get(slot) ?? null, write: async (slot, raw) => { await new Promise<void>(resolve => { finish = resolve; }); data.set(slot, raw); } });
  const pending = store.save(A, { background: { kind: 'preset', preset: 'ocean' } }, () => current);
  for (let i = 0; i < 8 && !finish; i++) await Promise.resolve();
  assert.ok(finish); current = false; finish(); await assert.rejects(pending, /STALE_VIEW/);
  assert.deepEqual(await store.open(B), defaultChatAppearance()); assert.ok(data.has(A)); assert.equal(data.has(B), false);
});
test('raw paths, remote URLs, forged schemas, prototype slots and unsupported backgrounds are rejected', () => {
  for (const entry of [{ kind: 'image', id: 'https://example.test/a.png' }, { kind: 'image', id: 'file:///private/a' }, { kind: 'preset', preset: 'mist', uri: 'file:///a' }, { kind: 'preset', preset: 'purple' }])
    assert.throws(() => checkedChatBackground(entry), /INVALID_BACKGROUND/);
  assert.throws(() => parseChatAppearance(JSON.stringify({ ...defaultChatAppearance(), rooms: { __proto__: null, 'raw-private-room': { kind: 'preset', preset: 'mist' } } })), /INVALID_SLOT/);
  assert.throws(() => parseChatAppearance('{broken'));
  assert.throws(() => parseChatAppearance(JSON.stringify({ ...defaultChatAppearance(), token: 'NO' })), /INVALID_STORAGE/);
});
test('corrupt local data is not silently replaced or overwritten', async () => {
  let writes = 0;
  const store = new ChatAppearanceStore({ read: async () => '{broken', write: async () => { writes++; } });
  await assert.rejects(store.open(A)); await assert.rejects(store.save(A, { theme: 'light' }, () => true)); assert.equal(writes, 0);
});
test('snapshot mutation cannot change saved settings', async () => {
  const f = fixture(); const value = await f.store.open(A); value.theme = 'dark';
  assert.equal(f.store.snapshot(A)?.theme, 'system');
});
test('system dark and explicit light produce the defined readable chat canvases', () => {
  assert.equal(chatCanvas({ kind: 'preset', preset: 'mist' }, 'system', true), '#152332');
  assert.equal(chatCanvas({ kind: 'preset', preset: 'mist' }, 'light', true), '#e9eff5');
});
