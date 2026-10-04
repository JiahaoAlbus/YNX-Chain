import assert from 'node:assert/strict';
import test from 'node:test';
import { ReceivedAttachmentCleanups } from './receivedAttachmentCleanup';

function fixture(id: string) {
  let available = false, calls = 0;
  const preview = { async close() { ++calls; if (!available) throw new Error(`CLEANUP_${id}_UNAVAILABLE`); } };
  const source = { client: { id }, eventId: `$${id}`, target: { preview } };
  return { source, calls: () => calls, recover: () => { available = true; } };
}
type Source = ReturnType<typeof fixture>['source'];

test('A and B failures preserve both original obligations and retry both original ports', async () => {
  const a = fixture('A'), b = fixture('B'), queue = new ReceivedAttachmentCleanups<Source>();
  queue.retain(a.source); queue.retain(b.source);
  await assert.rejects(queue.retry(), /CLEANUP_A/);
  assert.deepEqual(queue.snapshot().map(entry => entry.source), [a.source, b.source]);
  assert.equal(a.calls(), 1); assert.equal(b.calls(), 1);
  a.recover(); await assert.rejects(queue.retry(), /CLEANUP_B/);
  assert.deepEqual(queue.snapshot().map(entry => entry.source), [b.source]);
  b.recover(); await queue.retry(); assert.equal(queue.snapshot().length, 0);
  assert.equal(a.calls(), 2); assert.equal(b.calls(), 3);
});

test('repeated failure callbacks do not replace or duplicate the same captured source', () => {
  const a = fixture('A'), b = fixture('B'), queue = new ReceivedAttachmentCleanups<Source>();
  const original = queue.retain(a.source); queue.retain(b.source);
  assert.equal(queue.retain(a.source), original); assert.equal(queue.snapshot().length, 2);
  assert.ok(Object.isFrozen(original)); assert.ok(Object.isFrozen(queue.snapshot()));
});

test('late completion of an old obligation cannot remove its replacement token', () => {
  const a = fixture('A'), queue = new ReceivedAttachmentCleanups<Source>();
  const original = queue.retain(a.source); queue.complete(original);
  const replacement = queue.retain(a.source); queue.complete(original);
  assert.deepEqual(queue.snapshot(), [replacement]);
});

test('cleanup retains the original port even when a caller target later changes', async () => {
  const a = fixture('A'), b = fixture('B'), queue = new ReceivedAttachmentCleanups<Source>();
  const original = queue.retain(a.source); a.source.target.preview = b.source.target.preview; a.recover();
  await queue.close(original); assert.equal(a.calls(), 1); assert.equal(b.calls(), 0);
});

test('unsubscribing a row does not discard failures observed by a remounted row', async () => {
  const a = fixture('A'), queue = new ReceivedAttachmentCleanups<Source>(); let first = 0, next = 0;
  const stop = queue.subscribe(() => { ++first; }); queue.retain(a.source); stop();
  await assert.rejects(queue.retry(), /CLEANUP_A/);
  assert.equal(queue.snapshot()[0]?.source, a.source);
  const stopNext = queue.subscribe(() => { ++next; }); a.recover(); await queue.retry(); stopNext();
  assert.equal(first, 1); assert.equal(next, 1);
});

test('overlapping retries share the close operation and retain failure for a later retry', async () => {
  const queue = new ReceivedAttachmentCleanups<Source>(); let finish!: () => void, calls = 0, available = false;
  const waiting = new Promise<void>(resolve => { finish = resolve; });
  const source: Source = { client: { id: 'A' }, eventId: '$A', target: { preview: { async close() {
    ++calls; if (!available) { await waiting; throw new Error('RELEASE_UNAVAILABLE'); }
  } } } };
  queue.retain(source);
  const first = assert.rejects(queue.retry(), /UNAVAILABLE/), second = assert.rejects(queue.retry(), /UNAVAILABLE/);
  finish(); await first; await second; assert.equal(calls, 1); assert.equal(queue.snapshot().length, 1);
  available = true; await queue.retry(); assert.equal(calls, 2); assert.equal(queue.snapshot().length, 0);
});

test('new unrelated obligations remain when an earlier original close finishes', async () => {
  const b = fixture('B'), queue = new ReceivedAttachmentCleanups<Source>(); let finish!: () => void;
  const waiting = new Promise<void>(resolve => { finish = resolve; });
  const source: Source = { client: { id: 'A' }, eventId: '$A', target: { preview: { close: () => waiting } } };
  const original = queue.retain(source), closing = queue.close(original);
  const next = queue.retain(b.source); finish(); await closing;
  assert.deepEqual(queue.snapshot(), [next]);
});

test('two selections of the same preview retain distinct original-source tokens', async () => {
  const a = fixture('A'), queue = new ReceivedAttachmentCleanups<Source>();
  const first = queue.retain(a.source), second = queue.retain({ ...a.source });
  queue.complete(first); assert.deepEqual(queue.snapshot(), [second]);
  a.recover(); await queue.retry(); assert.equal(queue.snapshot().length, 0);
});
