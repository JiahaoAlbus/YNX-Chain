import assert from 'node:assert/strict';
import test from 'node:test';
import { NativeMomentIntents, type MomentIntentStorage } from './nativeMomentIntent';
const account = 'ynx1' + 'a'.repeat(38);
function draft() { return { text: 'Original', visibility: 'private' as 'private' | 'public' | 'contacts', media: [{ id: 'original-media', uri: 'file:///original.png' }] }; }
function gate() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
function fixture() {
  const rows = new Map<string, string>(); let nonce = 0;
  const storage: MomentIntentStorage = { read: async key => rows.get(key) ?? null,
    write: async (key, value) => { rows.set(key, value); }, remove: async key => { rows.delete(key); } };
  const next = async () => (++nonce).toString(16).padStart(32, '0');
  return { rows, storage, next, queue: new NativeMomentIntents(storage, next) };
}
test('prepare captures original text, private visibility and nested media before storage await', async () => {
  const f = fixture(), supplied = draft(), expected = draft(), waiting = gate(), finish = gate(), read = f.storage.read;
  f.storage.read = async key => { waiting.resolve(); await finish.promise; return read(key); };
  const pending = f.queue.prepare(account, supplied, () => true); await waiting.promise;
  supplied.text = 'Edited'; supplied.visibility = 'public'; supplied.media[0]!.id = 'replacement-media';
  supplied.media.push({ id: 'new-media', uri: 'file:///new.png' }); finish.resolve();
  const intent = await pending;
  assert.deepEqual({ text: intent.text, visibility: intent.visibility, media: intent.media }, expected);
  assert.equal(Object.isFrozen(supplied), false); assert.equal(Object.isFrozen(supplied.media), false);
});
test('acknowledge uses original intent while caller body, media and key change during read', async () => {
  const f = fixture(), original = await f.queue.prepare(account, draft(), () => true);
  const supplied = { ...original, media: original.media.map(item => ({ ...item })) }, waiting = gate(), finish = gate(), read = f.storage.read;
  f.storage.read = async key => { waiting.resolve(); await finish.promise; return read(key); };
  const pending = f.queue.acknowledge(supplied, 'original-returned-record', () => true); await waiting.promise;
  supplied.text = 'Changed'; supplied.idempotencyKey = 'native-moment-' + 'b'.repeat(32); supplied.media[0]!.id = 'replacement-media';
  finish.resolve(); assert.equal(await pending, true); f.storage.read = read;
  assert.deepEqual(await f.queue.load(account), { ...original, publishedRecordId: 'original-returned-record' });
});
test('prepared and loaded intent snapshots freeze nested media without freezing caller draft', async () => {
  const f = fixture(), supplied = draft(), prepared = await f.queue.prepare(account, supplied, () => true);
  const loaded = await f.queue.load(account); assert.ok(loaded);
  for (const intent of [prepared, loaded]) {
    assert.ok(Object.isFrozen(intent)); assert.ok(Object.isFrozen(intent.media)); assert.ok(Object.isFrozen(intent.media[0]));
    assert.equal(Reflect.set(intent.media[0]!, 'id', 'replacement-media'), false);
  }
  assert.equal(Object.isFrozen(supplied), false); assert.equal(Object.isFrozen(supplied.media[0]), false);
});
test('remounted controller cannot overwrite the original account while native write is pending', async () => {
  const f = fixture(), waiting = gate(), finish = gate(), write = f.storage.write; let writes = 0;
  f.storage.write = async (key, value) => { if (++writes === 1) { waiting.resolve(); await finish.promise; } await write(key, value); };
  const pending = f.queue.prepare(account, draft(), () => true); await waiting.promise;
  try { await assert.rejects(new NativeMomentIntents(f.storage, f.next).prepare(account, { ...draft(), text: 'Replacement' }, () => true), /already pending/); }
  finally { finish.resolve(); await pending; }
  assert.equal(writes, 1); assert.equal((await f.queue.load(account))?.text, 'Original');
});
test('remounted recovery read refuses an incomplete original write instead of reporting no intent', async () => {
  const f = fixture(), waiting = gate(), finish = gate(), write = f.storage.write;
  f.storage.write = async (key, value) => { waiting.resolve(); await finish.promise; await write(key, value); };
  const pending = f.queue.prepare(account, draft(), () => true); await waiting.promise;
  try { await assert.rejects(new NativeMomentIntents(f.storage, f.next).load(account), /already pending/); }
  finally { finish.resolve(); await pending; }
  assert.equal((await f.queue.load(account))?.text, 'Original');
});
