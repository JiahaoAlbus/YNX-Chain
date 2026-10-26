import test from 'node:test';
import assert from 'node:assert/strict';
import {createPrivateKey, createPublicKey} from 'node:crypto';
import * as y from '../src/index.mjs';
import {createHasher, buildTree, extractPath, pathRoot} from '../src/tree.mjs';
import {metadata, registration, fakeCertificate, messages} from './helpers.mjs';

const nativeAvailable = process.versions.node === '26.7.0' && process.versions.openssl === '3.6.4';
const providers = nativeAvailable ? ['native', 'portable'] : ['portable'];
const wipe = m => { m.pkcs8A.fill(0); m.pkcs8B.fill(0); };
function clone(m) { return {...m, pkcs8A: Buffer.from(m.pkcs8A), pkcs8B: Buffer.from(m.pkcs8B), pkA: Buffer.from(m.pkA), pkB: Buffer.from(m.pkB)}; }

test('explicit providers report actual runtime and reject unsupported selections without fallback', () => {
  assert.equal(y.providerInfo({provider: 'portable'}).version, '0.6.1');
  assert.equal(y.providerInfo({provider: 'portable'}).hashesVersion, '2.2.0');
  assert.equal(y.providerInfo({provider: 'portable'}).node, process.versions.node);
  assert.throws(() => y.keyGen({provider: 'automatic'}));
  if (!nativeAvailable) {
    assert.throws(() => y.keyGen(), /unvalidated crypto runtime/);
    assert.throws(() => y.providerInfo({provider: 'native'}), /unvalidated crypto runtime/);
  }
});

test('original/optimized hashes and all legal tree sizes agree for every available provider', () => {
  for (let N = 1; N <= 1024; N *= 2) {
    const C = y.encodeContext(fakeCertificate(N)), input = messages(N, 17);
    const base = createHasher(C, N, false, providers[0]);
    const expected = {A: buildTree(base.A, input), B: buildTree(base.B, input)};
    for (const provider of providers) for (const optimized of [false, true]) {
      const hash = createHasher(C, N, optimized, provider);
      for (const branch of ['A', 'B']) {
        const tree = buildTree(hash[branch], input); assert.deepEqual(tree, expected[branch]);
        const index = N - 1, path = extractPath(tree, index);
        assert.deepEqual(pathRoot(hash[branch], index, input[index], path), tree.at(-1)[0]);
      }
    }
  }
});

test('fresh native/portable PKCS8 export/import, public key equality and batch AND interoperability', () => {
  for (const source of providers) {
    const original = y.keyGen({provider: source}), material = y.exportKeyMaterial(original.privateKey);
    assert.equal(material.format, y.KEY_MATERIAL_FORMAT);
    assert.equal(material.algorithmVersion, y.VERSION); assert.equal(material.suite, y.SUITE);
    assert.equal(material.pkcs8A.length, 54); assert.equal(material.pkcs8B.length, 150);
    assert.equal(material.pkA.length, 2592); assert.equal(material.pkB.length, 64);
    if (nativeAvailable) {
      for (const branch of ['A', 'B']) {
        const k = createPrivateKey({key: material['pkcs8' + branch], format: 'der', type: 'pkcs8'});
        assert.equal(k.asymmetricKeyType, branch === 'A' ? 'ml-dsa-87' : 'slh-dsa-sha2-256f');
        assert.deepEqual(createPublicKey(k).export({format: 'raw-public'}), material['pk' + branch]);
      }
    }
    for (const destination of providers) {
      const restored = y.importKeyMaterial(material, {provider: destination});
      assert.deepEqual(restored.publicKey, original.publicKey);
      const second = y.exportKeyMaterial(restored.privateKey);
      assert.ok(second.pkcs8A.equals(material.pkcs8A), 'ML PKCS8 roundtrip');
      assert.ok(second.pkcs8B.equals(material.pkcs8B), 'SLH PKCS8 roundtrip'); wipe(second);
      const batch = y.batchSign(restored.privateKey, metadata(), [Buffer.from('TEST ONLY key-material recovery')]);
      const cert = y.decodeCertificate(batch.certificateWire), record = registration(cert);
      for (const verifier of providers) {
        const v = y.createVerifier({provider: verifier, chainId: cert.chainId, resolveTrustedOwner: () => record});
        assert.ok(v.verifyWhole(batch.wholeWire, {height: 7}));
        assert.ok(v.verifyOne(y.encodeMember(y.extract(batch.batch, 0)), {height: 7}));
      }
      y.discardBatch(batch.batch); y.destroyKey(restored.privateKey);
    }
    wipe(material); y.destroyKey(original.privateKey);
  }
});

test('strict key material profile rejects wrong suite/version/OID, lengths and either wrong public key', () => {
  const pair = y.keyGen({provider: 'portable'}), original = y.exportKeyMaterial(pair.privateKey);
  const changes = [m => m.format += '-other', m => m.algorithmVersion += '-other', m => m.suite += '-other',
    m => m.pkcs8A[18] ^= 1, m => m.pkcs8B[19] ^= 1,
    m => m.pkcs8A = m.pkcs8A.subarray(0, 53), m => m.pkcs8B = m.pkcs8B.subarray(0, 149),
    m => m.pkA[0] ^= 1, m => m.pkB[0] ^= 1];
  for (const provider of providers) for (const change of changes) {
    const bad = clone(original); change(bad);
    assert.throws(() => y.importKeyMaterial(bad, {provider})); wipe(bad);
  }
  const shared = clone(original); shared.pkcs8A = Buffer.from(new SharedArrayBuffer(54));
  assert.throws(() => y.importKeyMaterial(shared, {provider: 'portable'})); wipe(shared);
  wipe(original); y.destroyKey(pair.privateKey);
});

test('expanded SLH key must match its embedded public root; extracting the public bytes alone is insufficient', () => {
  const pair = y.keyGen({provider: 'portable'}), original = y.exportKeyMaterial(pair.privateKey);
  for (const provider of providers) {
    const bad = clone(original);
    bad.pkcs8B[22] ^= 1; // SK.seed changed; embedded public key is deliberately unchanged.
    assert.throws(() => y.importKeyMaterial(bad, {provider}), /inconsistent/); wipe(bad);
  }
  wipe(original); y.destroyKey(pair.privateKey);
});

test('imports/exports are detached, forged handles fail, destruction disables future use', () => {
  const pair = y.keyGen({provider: 'portable'}), material = y.exportKeyMaterial(pair.privateKey);
  const restored = y.importKeyMaterial(material, {provider: 'portable'});
  wipe(material); material.pkA.fill(0); material.pkB.fill(0);
  const fresh = y.exportKeyMaterial(restored.privateKey);
  assert.deepEqual({pkA: fresh.pkA, pkB: fresh.pkB}, pair.publicKey);
  const other = y.keyGen({provider: 'portable'}), otherMaterial = y.exportKeyMaterial(other.privateKey);
  assert.equal(fresh.pkcs8A.equals(otherMaterial.pkcs8A), false, 'fresh ML key');
  assert.equal(fresh.pkcs8B.equals(otherMaterial.pkcs8B), false, 'fresh SLH key');
  assert.throws(() => y.exportKeyMaterial({})); assert.throws(() => y.batchSign({}, metadata(), [Buffer.alloc(0)]));
  assert.ok(y.destroyKey(restored.privateKey)); assert.equal(y.destroyKey(restored.privateKey), false);
  assert.throws(() => y.exportKeyMaterial(restored.privateKey));
  assert.throws(() => y.batchSign(restored.privateKey, metadata(), [Buffer.alloc(0)]));
  wipe(fresh); wipe(otherMaterial); y.destroyKey(pair.privateKey); y.destroyKey(other.privateKey);
});
