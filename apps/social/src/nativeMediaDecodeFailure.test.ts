import assert from 'node:assert/strict';
import test from 'node:test';
import { bindMediaPresentation, markMediaPresentationDecodeFailure, visibleMediaPresentation } from './nativeMediaPresentation';
import type { MatrixMediaLease } from './nativeMatrixMedia';

function fixture() {
  const scope = { preview: {}, roomId: '!original:example.test', eventId: '$original' };
  const lease: MatrixMediaLease = { leaseId: '12345678-1234-1234-1234-123456789abc', roomId: scope.roomId,
    eventId: scope.eventId, filename: 'Original.png', mimeType: 'image/png', bytes: 100,
    uri: 'file:///fixture/original.png', imagePreview: true };
  return { scope, lease, original: bindMediaPresentation(scope, lease) };
}

test('only the exact displayed presentation receives an image decode failure', () => {
  const f = fixture(), failed = markMediaPresentationDecodeFailure(f.original, f.original);
  assert.ok(failed); assert.equal(failed.imageDecodeFailed, true); assert.ok(Object.isFrozen(failed));
  assert.equal(failed.lease, f.original.lease); assert.equal(f.original.imageDecodeFailed, undefined);
  assert.equal(visibleMediaPresentation(f.scope, failed)?.uri, f.lease.uri);
});

test('a late old callback cannot fail a retry of the same room, event, handle and URI', () => {
  const f = fixture(), recovered = bindMediaPresentation(f.scope, f.lease);
  assert.equal(markMediaPresentationDecodeFailure(recovered, f.original), recovered);
  assert.equal(recovered.imageDecodeFailed, undefined);
});

test('an older callback cannot clear a current error or retarget its file', () => {
  const f = fixture(), recovered = bindMediaPresentation(f.scope, f.lease);
  const failed = markMediaPresentationDecodeFailure(recovered, recovered);
  assert.ok(failed); assert.equal(markMediaPresentationDecodeFailure(failed, f.original), failed);
  assert.equal(markMediaPresentationDecodeFailure(failed, recovered), failed);
  assert.equal(failed.imageDecodeFailed, true);
});

test('close and background hiding do not resurrect a failed presentation', () => {
  const f = fixture();
  assert.equal(markMediaPresentationDecodeFailure(undefined, f.original), undefined);
  assert.equal(markMediaPresentationDecodeFailure(undefined, undefined), undefined);
  assert.equal(markMediaPresentationDecodeFailure(f.original, undefined), f.original);
});

test('a fresh retry remains displayable after a current decode error', () => {
  const f = fixture(), failed = markMediaPresentationDecodeFailure(f.original, f.original);
  assert.ok(failed); const recovered = bindMediaPresentation(f.scope, f.lease);
  assert.equal(recovered.imageDecodeFailed, undefined);
  assert.equal(visibleMediaPresentation(f.scope, recovered)?.uri, f.lease.uri);
  assert.equal(visibleMediaPresentation({ ...f.scope, eventId: '$other' }, failed), undefined);
});
