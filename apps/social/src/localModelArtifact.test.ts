import assert from 'node:assert/strict';
import test from 'node:test';
import { ed25519 } from '@noble/curves/ed25519.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { VerifiedLocalModelArtifact } from './localModelArtifact';

const hash = (bytes: Uint8Array) => bytesToHex(sha256(bytes));
function fixture(overrides: Record<string, unknown> = {}) {
  // These bytes are not a classification model or measured calibration dataset.
  const model = new Uint8Array([1, 2, 3]);
  const calibration = new TextEncoder().encode('software verification fixture only');
  const secret = new Uint8Array(32).fill(11);
  const manifest = new TextEncoder().encode(JSON.stringify({
    format: 'ynx-social-local-model-v1', modelId: 'fixture/model', version: 'fixture-v1',
    sourceURL: 'https://example.invalid/fixture/model', sourceRevision: 'a'.repeat(40), license: 'Apache-2.0',
    modelSHA256: hash(model), modelBytes: model.length, calibrationSHA256: hash(calibration),
    categories: ['gore', 'explicit_violence', 'sexual_content'], supportedMimeTypes: ['image/png'], ...overrides,
  }));
  return {
    expected: { modelId: 'fixture/model', version: 'fixture-v1', manifestSHA256: hash(manifest), signingPublicKey: ed25519.getPublicKey(secret) },
    input: { manifest, signature: ed25519.sign(manifest, secret), model, calibration },
  };
}

test('actual Ed25519 verification pins release bytes and keeps independent copies', () => {
  const original = fixture();
  const verified = VerifiedLocalModelArtifact.verify(original.expected, original.input);
  original.input.model.fill(9); original.input.calibration.fill(9);
  const copy = verified.copyModelBytes(); assert.deepEqual(copy, new Uint8Array([1, 2, 3]));
  copy.fill(8); assert.deepEqual(verified.copyModelBytes(), new Uint8Array([1, 2, 3]));
  assert.equal(verified.manifest.version, 'fixture-v1'); assert.equal(Object.isFrozen(verified.manifest), true);
});

test('manifest bytes, signer and signature substitution are rejected', () => {
  for (const target of ['manifest', 'signature', 'signer'] as const) {
    const original = fixture();
    if (target === 'signer') original.expected.signingPublicKey.fill(12);
    else original.input[target][0] = original.input[target][0]! ^ 1;
    assert.throws(() => VerifiedLocalModelArtifact.verify(original.expected, original.input), /authenticity/);
  }
});

test('the source-bound expected release cannot be silently replaced or downgraded', () => {
  const original = fixture();
  assert.throws(() => VerifiedLocalModelArtifact.verify({ ...original.expected, version: 'fixture-v2' }, original.input), /release binding/);
  assert.throws(() => VerifiedLocalModelArtifact.verify({ ...original.expected, modelId: 'other/model' }, original.input), /release binding/);
});

test('model and calibration corruption are rejected even with a valid signed manifest', () => {
  for (const target of ['model', 'calibration'] as const) {
    const original = fixture(); original.input[target][0] = original.input[target][0]! ^ 1;
    assert.throws(() => VerifiedLocalModelArtifact.verify(original.expected, original.input), /integrity/);
  }
  const wrongSize = fixture({ modelBytes: 2 });
  assert.throws(() => VerifiedLocalModelArtifact.verify(wrongSize.expected, wrongSize.input), /integrity/);
});

test('unknown license, missing categories and unsupported media stay unaccepted', () => {
  for (const overrides of [{ license: 'unknown' }, { categories: ['sexual_content'] },
    { categories: ['gore', 'explicit_violence', 'political_opinion'] }, { supportedMimeTypes: ['video/mp4'] },
    { supportedMimeTypes: ['image/png', 'image/png'] }, { customOperatorURL: 'https://example.invalid/code.js' }]) {
    const original = fixture(overrides);
    assert.throws(() => VerifiedLocalModelArtifact.verify(original.expected, original.input), /Unsupported/);
  }
});

test('credential URLs, mutable revisions and resource abuse are rejected', () => {
  for (const overrides of [{ sourceURL: 'https://user:password@example.invalid/model' },
    { sourceURL: 'http://example.invalid/model' }, { sourceURL: 'https://example.invalid/model?token=private' },
    { sourceRevision: 'main' }, { modelBytes: 129 * 1024 * 1024 }]) {
    const original = fixture(overrides);
    assert.throws(() => VerifiedLocalModelArtifact.verify(original.expected, original.input));
  }
  const original = fixture();
  assert.throws(() => VerifiedLocalModelArtifact.verify(original.expected, { ...original.input, signature: new Uint8Array(63) }), /limits/);
  assert.throws(() => VerifiedLocalModelArtifact.verify(original.expected, { ...original.input, calibration: new Uint8Array() }), /limits/);
});
