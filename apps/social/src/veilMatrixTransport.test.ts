import test from 'node:test';
import assert from 'node:assert/strict';
import { VEIL_MATRIX_EVENT, checkedVeilMatrixContent, encodeVeilMatrixContent, decodeVeilMatrixContent,
  selectVeilMatrixReader, prepareVeilMatrixPending, markVeilMatrixAttempted,
  veilMatrixRetryDecision, observeVeilMatrixOriginal } from './veilMatrixTransport';

const sender = '11111111-1111-4111-8111-111111111111';
const operation = '22222222-2222-4222-8222-222222222222';
const content = () => ({ version: 2, suite: 'signal-session-0.104.0', ciphertext_type: 3,
  sender_message_id: sender, ciphertext: { url: 'mxc://example.org/opaque_cipher', sha256: 'a'.repeat(64), size: 2 * 1024 * 1024 } });
const pending = () => prepareVeilMatrixPending({ localOperationId: operation, senderMessageId: sender,
  matrixTransactionId: 'sdk-original-transaction', roomId: '!room:example.org', senderUserId: '@alice:example.org',
  contentJson: encodeVeilMatrixContent(content()) });

test('maximum opaque ciphertext uses small descriptor, not inline base64', () => {
  const raw = encodeVeilMatrixContent(content());
  assert.ok(new TextEncoder().encode(raw).length < 4096);
  assert.equal(decodeVeilMatrixContent(raw).ciphertext.size, 2097152);
  assert.equal(selectVeilMatrixReader(VEIL_MATRIX_EVENT, raw).reader, 'veil-v2');
});
test('wire output is immutable snapshot and never accepts secret/context extras', () => {
  const source = content(), result = checkedVeilMatrixContent(source);
  source.ciphertext.url = 'mxc://elsewhere.org/changed';
  assert.equal(result.ciphertext.url, 'mxc://example.org/opaque_cipher');
  assert.ok(Object.isFrozen(result) && Object.isFrozen(result.ciphertext));
  assert.throws(() => checkedVeilMatrixContent({ ...content(), key: 'secret' }));
  assert.throws(() => checkedVeilMatrixContent({ ...content(), epoch: 1 }));
});
test('unknown new version or suite cannot fall back to legacy', () => {
  assert.throws(() => selectVeilMatrixReader(VEIL_MATRIX_EVENT, JSON.stringify({ ...content(), version: 3 })), /VERSION_UNSUPPORTED/);
  assert.throws(() => selectVeilMatrixReader(VEIL_MATRIX_EVENT, JSON.stringify({ ...content(), suite: 'm.megolm.v1.aes-sha2' })), /SUITE_UNSUPPORTED/);
  assert.throws(() => selectVeilMatrixReader('com.ynx.social.veil.encrypted.v3', '{}'), /VERSION_UNSUPPORTED/);
});
test('legacy JSON preserved byte-for-byte with read-only routing', () => {
  for (const algorithm of ['m.olm.v1.curve25519-aes-sha2', 'm.megolm.v1.aes-sha2', 'x25519-hkdf-sha256-xchacha20poly1305']) {
    const raw = JSON.stringify({ algorithm, ciphertext: 'unchanged' }, null, 2);
    assert.deepEqual(selectVeilMatrixReader('m.room.encrypted', raw), { reader: 'legacy-read-only', algorithm, originalJson: raw });
  }
  assert.equal(selectVeilMatrixReader('m.room.message', '{}').reader, 'not-encrypted');
  assert.throws(() => selectVeilMatrixReader('m.room.encrypted', '{"algorithm":"unknown"}'));
});
test('descriptor refuses remote HTTP, malformed fields, fractions, caps, secrets and unsupported sender-key type', () => {
  for (const cipher of [
    { ...content().ciphertext, url: 'https://example.org/cipher' },
    { ...content().ciphertext, url: 'mxc://user@example.org/cipher' },
    { ...content().ciphertext, url: 'mxc://example.org/../cipher' },
    { ...content().ciphertext, sha256: 'A'.repeat(64) },
    { ...content().ciphertext, size: 1.5 }, { ...content().ciphertext, size: 0 },
    { ...content().ciphertext, size: 2097153 }, { ...content().ciphertext, key: 'secret' },
  ]) assert.throws(() => checkedVeilMatrixContent({ ...content(), ciphertext: cipher }));
  assert.throws(() => checkedVeilMatrixContent({ ...content(), ciphertext_type: 7 }));
  assert.throws(() => decodeVeilMatrixContent('x'.repeat(4097)));
  assert.throws(() => decodeVeilMatrixContent('[]'));
});
test('sender/local operation/Matrix txn namespaces remain distinct and immutable', () => {
  const record = pending();
  assert.equal(record.localOperationId, operation); assert.equal(record.senderMessageId, sender);
  assert.equal(record.matrixTransactionId, 'sdk-original-transaction');
  assert.ok(Object.isFrozen(record));
  assert.throws(() => prepareVeilMatrixPending({ ...record, senderMessageId: operation }), /MESSAGE_REUSE/);
  assert.throws(() => prepareVeilMatrixPending({ ...record, matrixTransactionId: 'bad\ud800' }));
});
test('unknown send must read original, not regenerate or repost', () => {
  const record = pending(), attempted = markVeilMatrixAttempted(record);
  assert.equal(veilMatrixRetryDecision(record), 'send-original');
  assert.equal(veilMatrixRetryDecision(attempted), 'readback-only');
  assert.equal(attempted.contentJson, record.contentJson);
  assert.equal(attempted.matrixTransactionId, record.matrixTransactionId);
  assert.throws(() => markVeilMatrixAttempted(attempted), /READBACK_REQUIRED/);
});
test('readback requires exact original room, sender, type and ciphertext reference', () => {
  const record = markVeilMatrixAttempted(pending());
  const event = { eventId: '$original', roomId: record.roomId, sender: record.senderUserId, type: VEIL_MATRIX_EVENT, contentJson: record.contentJson };
  const observed = observeVeilMatrixOriginal(record, event);
  assert.equal(veilMatrixRetryDecision(observed), 'already-observed');
  for (const altered of [{ ...event, roomId: '!elsewhere:example.org' }, { ...event, sender: '@mallory:example.org' },
    { ...event, type: 'm.room.message' }, { ...event, contentJson: encodeVeilMatrixContent({ ...content(), ciphertext: { ...content().ciphertext, sha256: 'b'.repeat(64) } }) }]) {
    assert.throws(() => observeVeilMatrixOriginal(record, altered), /READBACK_MISMATCH/);
  }
  assert.throws(() => observeVeilMatrixOriginal(observed, { ...event, eventId: '$second' }), /MESSAGE_REUSE/);
});
