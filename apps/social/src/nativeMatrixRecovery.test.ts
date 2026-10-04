import test from 'node:test';
import assert from 'node:assert/strict';
import { checkedOriginals, checkedOriginalObservation, type MatrixPendingIntent } from './nativeMatrixRecovery';
import type { MatrixEvent } from './nativeMatrix';

const self = '@alice:example.test';
const makeOriginal = () => ({
  intentId: `native-matrix-${'a'.repeat(32)}`, roomId: '!room:example.test',
  kind: 'text' as const, body: 'original retained content',
  state: 'sdk-sent-needs-readback' as const, eventId: '$original',
});
const makeEvent = (): MatrixEvent => ({
  eventId: '$original', transactionId: 'sdk-original-transaction', sender: self,
  own: true, remote: true, kind: 'message', body: 'original retained content',
  intentId: `native-matrix-${'a'.repeat(32)}`, mediaKind: null,
});

test('validated original observation retains detached original and event snapshots', () => {
  const original = makeOriginal(), event = makeEvent();
  const result = checkedOriginalObservation(original, event, self);
  original.body = 'changed after check';
  original.intentId = `native-matrix-${'b'.repeat(32)}`;
  original.eventId = '$changed';
  event.body = 'changed after check';
  event.intentId = `native-matrix-${'b'.repeat(32)}`;
  event.eventId = '$changed';
  event.sender = '@mallory:example.test';
  event.remote = false;
  assert.equal(result.original.body, 'original retained content');
  assert.equal(result.original.intentId, `native-matrix-${'a'.repeat(32)}`);
  assert.equal(result.original.eventId, '$original');
  assert.equal(result.event.body, 'original retained content');
  assert.equal(result.event.intentId, `native-matrix-${'a'.repeat(32)}`);
  assert.equal(result.event.eventId, '$original');
  assert.equal(result.event.sender, self);
  assert.equal(result.event.remote, true);
});

test('observation snapshots are frozen without freezing or reusing producer objects', () => {
  const original = makeOriginal(), event = makeEvent();
  const result = checkedOriginalObservation(original, event, self);
  assert.notStrictEqual(result.original, original);
  assert.notStrictEqual(result.event, event);
  assert.ok(Object.isFrozen(result) && Object.isFrozen(result.original) && Object.isFrozen(result.event));
  assert.equal(Object.isFrozen(original), false);
  assert.equal(Object.isFrozen(event), false);
  assert.equal(Reflect.set(result.event, 'remote', false), false);
});

test('original observation remains only an SDK observation, not delivery or private server proof', () => {
  const result = checkedOriginalObservation(makeOriginal(), makeEvent(), self);
  assert.equal(result.sdkObserved, true);
  assert.equal(result.delivered, false);
  assert.equal(result.freshServerReadback, false);
  assert.equal(result.socialIndexConfirmed, false);
});

test('readback conflicts still reject rather than retaining an unverified snapshot', () => {
  for (const change of [
    { eventId: '$other' }, { intentId: `native-matrix-${'b'.repeat(32)}` },
    { sender: '@mallory:example.test' }, { own: false }, { remote: false },
    { kind: 'local-echo' }, { body: 'changed content' },
  ]) assert.throws(() => checkedOriginalObservation(makeOriginal(), { ...makeEvent(), ...change }, self), /MATRIX_ORIGINAL_EVENT_CONFLICT/);
  assert.throws(() => checkedOriginalObservation({ ...makeOriginal(), eventId: null }, makeEvent(), self), /MATRIX_ORIGINAL_EVENT_CONFLICT/);
});

test('checked original list remains detached, immutable and room scoped', () => {
  const original = makeOriginal();
  const result = checkedOriginals([original], original.roomId);
  original.body = 'changed producer content';
  const retained = result[0];
  assert.ok(retained, 'the checked original is present');
  assert.equal(retained.body, 'original retained content');
  assert.ok(Object.isFrozen(result) && Object.isFrozen(result[0]));
  assert.throws(() => checkedOriginals([makeOriginal()], '!other:example.test'), /MATRIX_ORIGINAL_JOURNAL_INVALID/);
  assert.throws(() => checkedOriginals([makeOriginal(), makeOriginal()], '!room:example.test'), /MATRIX_ORIGINAL_JOURNAL_INVALID/);
  const bad: MatrixPendingIntent = { ...makeOriginal(), eventId: '$bad event' };
  assert.throws(() => checkedOriginals([bad], bad.roomId), /MATRIX_ORIGINAL_JOURNAL_INVALID/);
});
