import assert from 'node:assert/strict';
import test from 'node:test';
import { bindMediaPresentation, visibleMediaPresentation } from './nativeMediaPresentation';
import type { MatrixMediaLease } from './nativeMatrixMedia';

function fixture() {
  const scope = { preview: {}, roomId: '!original:example.test', eventId: '$original' };
  const lease = {
    leaseId: '12345678-1234-1234-1234-123456789abc', roomId: scope.roomId,
    eventId: scope.eventId, filename: 'Original.png', mimeType: 'image/png', bytes: 1,
    uri: 'file:///fixture/original.png', imagePreview: true,
  } satisfies MatrixMediaLease;
  return { scope, lease, presentation: bindMediaPresentation(scope, lease) };
}

test('original preview can render only its exact original attachment', () => {
  const f = fixture();
  assert.deepEqual(visibleMediaPresentation(f.scope, f.presentation), f.lease);
  assert.equal(visibleMediaPresentation(f.scope, undefined), undefined);
});

test('room/event/engine transitions suppress old URI synchronously before effects', () => {
  const f = fixture();
  for (const scope of [{ ...f.scope, roomId: '!replacement:example.test' },
    { ...f.scope, eventId: '$replacement' }, { ...f.scope, preview: {} }]) {
    assert.equal(visibleMediaPresentation(scope, f.presentation), undefined);
  }
});

test('returned lease for a different room or event cannot be bound', () => {
  const f = fixture();
  assert.throws(() => bindMediaPresentation(f.scope, { ...f.lease, roomId: '!wrong:example.test' }), /SCOPE_MISMATCH/);
  assert.throws(() => bindMediaPresentation(f.scope, { ...f.lease, eventId: '$wrong' }), /SCOPE_MISMATCH/);
});

test('later changes to caller records cannot retarget the captured presentation', () => {
  const f = fixture();
  f.scope.eventId = '$replacement'; f.lease.uri = 'file:///fixture/replacement.png';
  assert.equal(visibleMediaPresentation(f.scope, f.presentation), undefined);
  const original = { ...f.scope, eventId: '$original' };
  assert.equal(visibleMediaPresentation(original, f.presentation)?.uri, 'file:///fixture/original.png');
  assert.ok(Object.isFrozen(f.presentation)); assert.ok(Object.isFrozen(f.presentation.scope));
  assert.ok(Object.isFrozen(f.presentation.lease));
});

test('a new original-scoped presentation is usable after a rejected stale result', () => {
  const f = fixture(); const next = { ...f.scope, eventId: '$next' };
  assert.equal(visibleMediaPresentation(next, f.presentation), undefined);
  const recovered = bindMediaPresentation(next, { ...f.lease, eventId: '$next' });
  assert.equal(visibleMediaPresentation(next, recovered)?.eventId, '$next');
});
