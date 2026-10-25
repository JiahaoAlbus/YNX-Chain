import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync, randomBytes} from 'node:crypto';
import * as ynx from '../src/index.mjs';
import {messages, metadata, registration, reference, refCodec} from './helpers.mjs';
const at = {height: 7};
const pair = ynx.keyGen(), meta = metadata(), ms = messages(128, 1024);
const result = ynx.batchSign(pair.privateKey, meta, ms), cert = ynx.decodeCertificate(result.certificateWire);
const baseRecord = registration(cert);
const verifier = () => ynx.createVerifier({chainId: meta.chainId, resolveTrustedOwner: () => baseRecord});

test('fresh native keys, both signatures, original reference interoperability and all 128 members', () => {
  const ref = reference(), v = verifier(), h = v.authenticateCertificate(result.certificateWire, at);
  assert.ok(h); const refHandle = ref.authenticateCertificate(cert, cert); assert.ok(refHandle);
  assert.ok(ref.verifyWholeBatch(cert, ms, cert)); assert.ok(v.verifyWhole(result.wholeWire, at));
  for (let i = 0; i < 128; i++) {
    const m = ynx.extract(result.batch, i), b = ynx.encodeMember(m);
    assert.ok(v.verifyMember(h, m, at)); assert.ok(ref.verifyMember(refHandle, refCodec.decodeMember(b)));
  }
  assert.ok(v.verifyOne(ynx.encodeMember(ynx.extract(result.batch, 127)), at));
  assert.equal(v.stats().signatureChecks, 2);
});

test('reference signer -> independent decoder and authenticator, both tree modes', () => {
  const ref = reference(), keys = {A: generateKeyPairSync('ml-dsa-87'), B: generateKeyPairSync('slh-dsa-sha2-256f')};
  const c = {...metadata(), batchId: randomBytes(16), pkA: keys.A.publicKey.export({format: 'raw-public'}), pkB: keys.B.publicKey.export({format: 'raw-public'})};
  const input = messages(2), b = ref.createBatch(keys, c, input), record = registration(c);
  for (const optimized of [false, true]) {
    const v = ynx.createVerifier({chainId: c.chainId, resolveTrustedOwner: () => record, optimized});
    assert.ok(v.verifyWhole(refCodec.encodeWhole(b.certificate, input), at));
    assert.ok(v.verifyOne(refCodec.encodeMember(ref.extract(b, 1)), at));
  }
});

test('all legal N sign and verify with exact depth, including empty-message N=1 and N=1024', () => {
  for (let N = 1; N <= 1024; N *= 2) {
    const b = ynx.batchSign(pair.privateKey, meta, messages(N, N === 1 || N === 1024 ? 0 : 8));
    const v = verifier(), m = ynx.extract(b.batch, N - 1);
    assert.equal(m.pathA.length, Math.log2(N)); assert.ok(v.verifyWhole(b.wholeWire, at));
    assert.ok(v.verifyOne(ynx.encodeMember(m), at)); ynx.discardBatch(b.batch);
  }
});

test('either corrupt signature, either root, either key, metadata and cross-batch mixing fail AND', () => {
  const v = verifier(); assert.ok(v.authenticateCertificate(result.certificateWire, at));
  const other = ynx.batchSign(pair.privateKey, meta, ms), c2 = ynx.decodeCertificate(other.certificateWire);
  for (const field of ['sigmaA', 'sigmaB', 'rootA', 'rootB', 'pkA', 'pkB', 'chainId', 'batchId']) {
    const c = ynx.decodeCertificate(result.certificateWire); c[field][0] ^= 1;
    assert.equal(v.authenticateCertificate(ynx.encodeCertificate(c), at), null, field);
  }
  for (const fields of [{N: 64}, {owner: cert.owner.toUpperCase()}, {owner: ' ' + cert.owner}, {purpose: 'REGISTER'}, {sigmaA: c2.sigmaA}, {sigmaB: c2.sigmaB}])
    assert.equal(v.authenticateCertificate(ynx.encodeCertificate({...cert, ...fields}), at), null);
  assert.equal(v.stats().cachedCertificates, 1, 'only successful certificate cached');
});

test('tampered/reordered/missing messages, paths and indexes fail even with cached certificate', () => {
  const v = verifier(), h = v.authenticateCertificate(result.certificateWire, at);
  for (const mutate of [m => m.message[0] ^= 1, m => m.index = 1, m => m.pathA[0][0] ^= 1,
    m => m.pathB[0][0] ^= 1, m => m.pathA.reverse(), m => m.pathB.pop(), m => m.index = -1]) {
    const m = ynx.extract(result.batch, 0); mutate(m); assert.equal(v.verifyMember(h, m, at), false);
  }
  for (const mutate of [m => m[0][0] ^= 1, m => [m[0], m[1]] = [m[1], m[0]], m => m.pop()]) {
    const copy = ms.map(m => Buffer.from(m)); mutate(copy); assert.equal(v.verifyWholeBatch(result.certificateWire, copy, at), false);
  }
  const other = ynx.batchSign(pair.privateKey, meta, ms), mixed = ynx.extract(result.batch, 0);
  mixed.pathB = ynx.extract(other.batch, 0).pathB; assert.equal(v.verifyMember(h, mixed, at), false);
});

test('private handles cannot be forged/transferred; all external buffers are detached', () => {
  const v = verifier(), wire = Buffer.from(result.certificateWire), h = v.authenticateCertificate(wire, at);
  wire.fill(0); const m = ynx.extract(result.batch, 0); assert.ok(v.verifyMember(h, m, at));
  assert.equal(v.verifyMember({verified: true}, m, at), false);
  assert.equal(verifier().verifyMember(h, m, at), false);
  m.certificate.rootA.fill(0); m.pathA[0].fill(0); m.message.fill(0);
  assert.ok(v.verifyMember(h, ynx.extract(result.batch, 0), at));
  const original = messages(2), smallMeta = {...meta, chainId: Buffer.from(meta.chainId)}, signed = ynx.batchSign(pair.privateKey, smallMeta, original);
  original[0].fill(0); smallMeta.chainId.fill(0); signed.certificateWire.fill(0); signed.wholeWire.fill(0);
  assert.ok(v.verifyOne(ynx.encodeMember(ynx.extract(signed.batch, 0)), at));
  v.clear(); assert.equal(v.verifyMember(h, ynx.extract(result.batch, 0), at), false); assert.equal(v.stats().cachedCertificates, 0);
});

test('each handle/cache use rechecks revocation, activation, policy revision and key rotation', () => {
  let r = registration(cert); const v = ynx.createVerifier({chainId: meta.chainId, resolveTrustedOwner: () => r});
  const h = v.authenticateCertificate(result.certificateWire, at), m = ynx.extract(result.batch, 0);
  assert.ok(h); assert.equal(v.verifyMember(h, m, {height: 2}), false);
  for (const change of [{enabled: false}, {revokedAt: 7}, {policyRevision: 'TEST-ONLY-2'}, {activeFrom: 8}, {pkA: Buffer.alloc(2592)}, {pkB: Buffer.alloc(64)}]) {
    r = registration(cert, change); assert.equal(v.verifyMember(h, m, at), false);
  }
  r = registration(cert, {revokedAt: 8}); assert.equal(v.verifyMember(h, m, at), false, 'old handle bound to old policy snapshot');
  const fresh = v.authenticateCertificate(result.certificateWire, at); assert.ok(fresh);
  assert.equal(v.verifyMember(fresh, m, {height: 8}), false);
  assert.equal(v.authenticateCertificate(result.certificateWire, {height: 8}), null);
  for (const context of [undefined, {}, {height: -1}, {height: 1.1}]) assert.equal(v.verifyMember(fresh, m, context), false);
});

test('bounded success-only exact-certificate LRU and explicit zero cache', () => {
  const v = ynx.createVerifier({chainId: meta.chainId, resolveTrustedOwner: () => baseRecord, cacheEntries: 1});
  assert.ok(v.authenticateCertificate(result.certificateWire, at)); assert.ok(v.authenticateCertificate(result.certificateWire, at));
  assert.equal(v.stats().cacheHits, 1); assert.equal(v.stats().signatureChecks, 2);
  const b = ynx.batchSign(pair.privateKey, meta, messages(1)); assert.ok(v.authenticateCertificate(b.certificateWire, at));
  assert.equal(v.stats().cachedCertificates, 1); assert.ok(v.authenticateCertificate(result.certificateWire, at));
  assert.equal(v.stats().signatureChecks, 6);
  assert.equal(v.stats().publicKeyImports, 2); assert.equal(v.stats().cachedPublicKeyPairs, 1);
  const noCache = ynx.createVerifier({chainId: meta.chainId, resolveTrustedOwner: () => baseRecord, cacheEntries: 0});
  assert.ok(noCache.authenticateCertificate(result.certificateWire, at)); assert.ok(noCache.authenticateCertificate(result.certificateWire, at));
  assert.equal(noCache.stats().cachedCertificates, 0); assert.equal(noCache.stats().signatureChecks, 4);
  assert.equal(noCache.stats().publicKeyImports, 4); assert.equal(noCache.stats().cachedPublicKeyPairs, 0);
});

test('wrong network/absent registry fails closed and changing resolver cannot freeze permission', () => {
  for (const resolver of [() => null, async () => baseRecord, () => { throw Error('unavailable'); }, () => ({...baseRecord, policyRevision: undefined})]) {
    const v = ynx.createVerifier({chainId: meta.chainId, resolveTrustedOwner: resolver});
    assert.equal(v.authenticateCertificate(result.certificateWire, at), null); assert.equal(v.stats().signatureChecks, 0);
  }
  assert.equal(ynx.createVerifier({chainId: randomBytes(32), resolveTrustedOwner: () => baseRecord}).authenticateCertificate(result.certificateWire, at), null);
  let calls = 0;
  const v = ynx.createVerifier({chainId: meta.chainId, resolveTrustedOwner: () => registration(cert, {enabled: ++calls === 1})});
  assert.equal(v.authenticateCertificate(result.certificateWire, at), null); assert.equal(v.stats().cachedCertificates, 0);
});

test('signer bounds, private handle destruction, fresh batch IDs, no implicit nonce protection', () => {
  const b = ynx.batchSign(pair.privateKey, meta, ms); assert.notDeepEqual(ynx.decodeCertificate(b.certificateWire).batchId, cert.batchId);
  assert.throws(() => ynx.batchSign(pair.privateKey, {...meta, batchId: randomBytes(16)}, ms));
  assert.throws(() => ynx.batchSign(pair.privateKey, meta, messages(3)));
  assert.throws(() => ynx.batchSign(pair.privateKey, meta, [Buffer.alloc(1048577)]));
  assert.throws(() => ynx.batchSign(pair.privateKey, meta, Array(16).fill(Buffer.alloc(1048576))));
  assert.throws(() => ynx.batchSign({}, meta, ms));
  const temp = ynx.keyGen(); assert.ok(ynx.destroyKey(temp.privateKey)); assert.throws(() => ynx.batchSign(temp.privateKey, meta, ms));
  assert.ok(ynx.discardBatch(b.batch)); assert.throws(() => ynx.extract(b.batch, 0));
  const v = verifier(), member = ynx.encodeMember(ynx.extract(result.batch, 0));
  assert.ok(v.verifyOne(member, at)); assert.ok(v.verifyOne(member, at), 'crypto membership is replayable; ledger nonce gate is required');
});
