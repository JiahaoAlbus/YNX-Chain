import assert from 'node:assert/strict';
import test from 'node:test';
import { NativeContactIntents, checkedNativeContactIntent, type NativeContactIntent, type NativeContactStorage } from './nativeContactIntent';
const account = 'ynx1' + 'a'.repeat(38);
const original: NativeContactIntent = { schemaVersion: 1, account, source: 'handle', value: 'original',
  personId: 'sp_' + 'A'.repeat(32), idempotencyKey: 'native-contact-' + 'a'.repeat(32), message: 'Original message' };
function gate() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
function fixture() {
  const rows = new Map<string, string>();
  const storage: NativeContactStorage = { read: async key => rows.get(key) ?? null, write: async (key, value) => { rows.set(key, value); } };
  return { rows, storage, intents: new NativeContactIntents(storage) };
}
test('returned operation uses its original intent despite caller edits during storage read', async () => {
  const f = fixture(); await f.intents.prepare(original, () => true);
  const supplied = { ...original }, waiting = gate(), finish = gate(), read = f.storage.read;
  f.storage.read = async key => { waiting.resolve(); await finish.promise; return read(key); };
  const pending = f.intents.returned(supplied, () => true); await waiting.promise;
  supplied.message = 'Changed after original operation'; supplied.personId = 'sp_' + 'B'.repeat(32);
  supplied.idempotencyKey = 'native-contact-' + 'b'.repeat(32); finish.resolve();
  assert.equal(await pending, true); f.storage.read = read;
  const stored = await f.intents.load(account);
  assert.deepEqual(stored, { ...original, operationReturned: true });
  assert.equal(Object.isFrozen(supplied), false);
});
test('validated intent is a detached immutable snapshot without freezing caller input', () => {
  const supplied = { ...original }, captured = checkedNativeContactIntent(supplied, account);
  assert.notEqual(captured, supplied); assert.equal(Object.isFrozen(supplied), false);
  assert.ok(Object.isFrozen(captured)); assert.equal(Reflect.set(captured, 'message', 'Changed'), false);
  assert.equal(captured.message, original.message);
});
test('prepared and loaded recovery snapshots cannot be edited into a different request', async () => {
  const f = fixture(), prepared = await f.intents.prepare({ ...original }, () => true);
  const loaded = await new NativeContactIntents(f.storage).load(account); assert.ok(loaded);
  assert.ok(Object.isFrozen(prepared)); assert.ok(Object.isFrozen(loaded));
  assert.equal(Reflect.set(loaded, 'personId', 'sp_' + 'B'.repeat(32)), false);
  assert.equal(Reflect.set(prepared, 'idempotencyKey', 'native-contact-' + 'b'.repeat(32)), false);
  assert.deepEqual(await f.intents.load(account), original);
});
