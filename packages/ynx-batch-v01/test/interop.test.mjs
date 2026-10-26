import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {ml_dsa87} from '@noble/post-quantum/ml-dsa.js';
import {slh_dsa_sha2_256f} from '@noble/post-quantum/slh-dsa.js';
import * as y from '../src/index.mjs';
import {createHasher, buildTree, extractPath} from '../src/tree.mjs';
import {metadata, messages, registration} from './helpers.mjs';

test('OpenSSL native signer -> independent Noble pure verifier, empty context', () => {
  const k = y.keyGen(), m = metadata(), input = messages(2);
  const b = y.batchSign(k.privateKey, m, input), c = y.decodeCertificate(b.certificateWire), D = y.encodeDescriptor(c);
  for (const [branch, algorithm] of [['A', ml_dsa87], ['B', slh_dsa_sha2_256f]]) {
    const msg = y.encodeFields([y.VERSION + '/CERT/' + branch, D]);
    assert.ok(algorithm.verify(c['sigma' + branch], msg, c['pk' + branch], {context: new Uint8Array()}));
    assert.equal(algorithm.verify(c['sigma' + branch], msg, c['pk' + branch], {context: Uint8Array.of(1)}), false);
    const bad = Buffer.from(msg); bad[bad.length - 1] ^= 1;
    assert.equal(algorithm.verify(c['sigma' + branch], bad, c['pk' + branch]), false);
  }
  y.destroyKey(k.privateKey);
});

test('independent Noble keygen/sign -> native AND authentication, Whole and Member', () => {
  const A = ml_dsa87.keygen(), B = slh_dsa_sha2_256f.keygen();
  const c = {...metadata(), N: 2, batchId: randomBytes(16), pkA: Buffer.from(A.publicKey), pkB: Buffer.from(B.publicKey)};
  const input = messages(c.N), hash = createHasher(y.encodeContext(c), c.N);
  const treeA = buildTree(hash.A, input), treeB = buildTree(hash.B, input);
  c.rootA = treeA.at(-1)[0]; c.rootB = treeB.at(-1)[0]; const D = y.encodeDescriptor(c);
  c.sigmaA = Buffer.from(ml_dsa87.sign(y.encodeFields([y.VERSION + '/CERT/A', D]), A.secretKey, {context: new Uint8Array()}));
  c.sigmaB = Buffer.from(slh_dsa_sha2_256f.sign(y.encodeFields([y.VERSION + '/CERT/B', D]), B.secretKey, {context: new Uint8Array()}));
  const r = registration(c), v = y.createVerifier({chainId: c.chainId, resolveTrustedOwner: () => r});
  assert.ok(v.verifyWhole(y.encodeWhole(c, input), {height: 7}));
  assert.ok(v.verifyOne(y.encodeMember({certificate: c, index: 1, message: input[1],
    pathA: extractPath(treeA, 1), pathB: extractPath(treeB, 1)}), {height: 7}));
  A.secretKey.fill(0); B.secretKey.fill(0);
});
