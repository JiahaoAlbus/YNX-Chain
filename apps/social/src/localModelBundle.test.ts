import assert from 'node:assert/strict';
import test from 'node:test';
import { ed25519 } from '@noble/curves/ed25519.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { LOCAL_MODEL_BUNDLE_ROLES, verifyLocalModelBundleIntegrity, type LocalModelBundleRole } from './localModelBundle';

const hash = (bytes: Uint8Array) => bytesToHex(sha256(bytes));
const key = new Uint8Array(32).fill(7); // Generated deterministic software fixture, never a user/release private key.
const encoder = new TextEncoder();
function fixture(change?: (manifest: Record<string, unknown>) => void) {
  const assets: Record<LocalModelBundleRole, Uint8Array> = {
    'gore-sexual-classifier': new Uint8Array([1, 2, 3]), 'violence-encoder': new Uint8Array([4, 5, 6]),
    'violence-head': new Uint8Array([7, 8, 9]), 'violence-head-data': new Uint8Array([10, 11, 12]),
  };
  const fileNames: Record<LocalModelBundleRole, string> = {
    'gore-sexual-classifier': 'image-safety-classifier-xs.onnx', 'violence-encoder': 'vision_model_q4.onnx',
    'violence-head': 'violence_head.onnx', 'violence-head-data': 'violence_head.onnx.data',
  };
  const calibrationBytes = encoder.encode('{"fixtureOnly":true}');
  const noticesBytes = encoder.encode('Software fixture notices, not an approved license package.');
  const manifest: Record<string, unknown> = { format: 'ynx-social-local-model-bundle-v1', bundleId: 'social/fixture',
    version: 'fixture-1', pipeline: 'xs-siglip2-violence-v1', assets: LOCAL_MODEL_BUNDLE_ROLES.map(role => ({
      role, fileName: fileNames[role], sourceURL: 'https://example.test/models/' + 'a'.repeat(40) + '/' + fileNames[role],
      sourceRevision: 'a'.repeat(40), license: 'Apache-2.0', sha256: hash(assets[role]), bytes: assets[role].byteLength,
    })), calibrationSHA256: hash(calibrationBytes), noticesSHA256: hash(noticesBytes) };
  change?.(manifest);
  const manifestBytes = encoder.encode(JSON.stringify(manifest));
  return { manifestBytes, signature: ed25519.sign(manifestBytes, key), assets, calibrationBytes, noticesBytes,
    expected: { bundleId: 'social/fixture', version: 'fixture-1', manifestSHA256: hash(manifestBytes), signingPublicKey: ed25519.getPublicKey(key) } };
}

test('exact signed four-asset fixture verifies integrity without claiming a usable classifier', () => {
  const f = fixture(); const result = verifyLocalModelBundleIntegrity(f);
  assert.equal(result.manifest.pipeline, 'xs-siglip2-violence-v1');
  assert.equal(result.manifest.assets.length, 4); assert.ok(Object.isFrozen(result.manifest));
  assert.ok(Object.isFrozen(result.manifest.assets));
  for (const role of LOCAL_MODEL_BUNDLE_ROLES) assert.deepEqual(result.assetCopy(role), f.assets[role]);
});

test('caller mutation and returned-copy mutation cannot change verified model/calibration/notices', () => {
  const f = fixture(); const result = verifyLocalModelBundleIntegrity(f);
  f.assets['violence-head'].fill(0); result.assetCopy('violence-head').fill(0);
  f.calibrationBytes.fill(0); result.calibrationCopy().fill(0);
  f.noticesBytes.fill(0); result.noticesCopy().fill(0);
  assert.deepEqual(result.assetCopy('violence-head'), new Uint8Array([7, 8, 9]));
  assert.equal(new TextDecoder().decode(result.calibrationCopy()), '{"fixtureOnly":true}');
  assert.ok(new TextDecoder().decode(result.noticesCopy()).startsWith('Software fixture notices'));
});

test('wrong signature, signer, manifest bytes and release identity are rejected', () => {
  let f = fixture(); f.signature[0] = (f.signature[0] ?? 0) ^ 1; assert.throws(() => verifyLocalModelBundleIntegrity(f), /signature/);
  f = fixture(); f.expected.signingPublicKey = ed25519.getPublicKey(new Uint8Array(32).fill(8));
  assert.throws(() => verifyLocalModelBundleIntegrity(f), /signature/);
  f = fixture(); f.manifestBytes[0] = 0; assert.throws(() => verifyLocalModelBundleIntegrity(f), /manifest digest/);
  f = fixture(); f.expected.version = 'fixture-2'; assert.throws(() => verifyLocalModelBundleIntegrity(f), /release identity/);
  f = fixture(); f.expected.bundleId = 'social/other'; assert.throws(() => verifyLocalModelBundleIntegrity(f), /release identity/);
});

test('every actual asset is hashed; mixed and truncated external weights are rejected', () => {
  for (const role of LOCAL_MODEL_BUNDLE_ROLES) {
    const f = fixture(); f.assets[role] = new Uint8Array([99, 99, 99]);
    assert.throws(() => verifyLocalModelBundleIntegrity(f), /asset digest\/size/);
  }
  const f = fixture(); f.assets['violence-head-data'] = new Uint8Array([10]);
  assert.throws(() => verifyLocalModelBundleIntegrity(f), /asset digest\/size/);
});

test('calibration and notices must belong to the same signed release', () => {
  let f = fixture(); f.calibrationBytes = encoder.encode('other calibration');
  assert.throws(() => verifyLocalModelBundleIntegrity(f), /calibration\/notices/);
  f = fixture(); f.noticesBytes = encoder.encode('other notice');
  assert.throws(() => verifyLocalModelBundleIntegrity(f), /calibration\/notices/);
});

function withAsset(manifest: Record<string, unknown>, role: LocalModelBundleRole, change: (asset: Record<string, unknown>) => void) {
  const assets = manifest.assets;
  assert.ok(Array.isArray(assets));
  const asset: unknown = assets.find(value => typeof value === 'object' && value !== null && value.role === role);
  assert.ok(typeof asset === 'object' && asset !== null && !Array.isArray(asset));
  change(asset as Record<string, unknown>);
}

test('signed malformed schemas, unknown fields, duplicate roles and unexpected filenames fail closed', () => {
  for (const change of [
    (m: Record<string, unknown>) => { m.extra = true; },
    (m: Record<string, unknown>) => { m.pipeline = 'unknown'; },
    (m: Record<string, unknown>) => { m.assets = []; },
    (m: Record<string, unknown>) => withAsset(m, 'violence-head', a => { a.role = 'violence-encoder'; }),
    (m: Record<string, unknown>) => withAsset(m, 'violence-head-data', a => { a.fileName = '../foreign.data'; }),
    (m: Record<string, unknown>) => withAsset(m, 'violence-head', a => { a.license = 'unknown'; }),
    (m: Record<string, unknown>) => withAsset(m, 'violence-head', a => { a.bytes = 128 * 1024 * 1024 + 1; }),
  ]) assert.throws(() => verifyLocalModelBundleIntegrity(fixture(change)));
});

test('graph and external weights cannot claim different source revisions or repositories', () => {
  const f = fixture(m => withAsset(m, 'violence-head-data', a => {
    a.sourceRevision = 'b'.repeat(40); a.sourceURL = 'https://example.test/models/' + 'b'.repeat(40) + '/violence_head.onnx.data';
  }));
  assert.throws(() => verifyLocalModelBundleIntegrity(f), /graph\/data source/);
  const other = fixture(m => withAsset(m, 'violence-head-data', a => {
    a.sourceURL = 'https://other.test/models/' + 'a'.repeat(40) + '/violence_head.onnx.data';
  }));
  assert.throws(() => verifyLocalModelBundleIntegrity(other), /graph\/data source/);
});

test('mutable, credentialed, scheme and unbound source metadata are denied without fetching anything', () => {
  for (const source of ['http://example.test/model', 'file:///model', 'https://user:secret@example.test/model',
    'https://example.test/models/main/violence_head.onnx',
    'https://example.test/models/' + 'a'.repeat(40) + '/violence_head.onnx?mutable=1']) {
    const f = fixture(m => withAsset(m, 'violence-head', a => { a.sourceURL = source; }));
    assert.throws(() => verifyLocalModelBundleIntegrity(f), /source/);
  }
});

test('missing trust and empty or oversized documents cannot create an integrity result', () => {
  let f = fixture(); f.expected.signingPublicKey = new Uint8Array(); assert.throws(() => verifyLocalModelBundleIntegrity(f), /trusted/);
  f = fixture(); f.manifestBytes = new Uint8Array(16 * 1024 + 1); assert.throws(() => verifyLocalModelBundleIntegrity(f), /manifest/);
  f = fixture(); f.calibrationBytes = new Uint8Array(); assert.throws(() => verifyLocalModelBundleIntegrity(f), /calibration/);
  f = fixture(); f.noticesBytes = new Uint8Array(128 * 1024 + 1); assert.throws(() => verifyLocalModelBundleIntegrity(f), /notices/);
});
