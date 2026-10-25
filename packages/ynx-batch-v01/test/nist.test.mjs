import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createPublicKey, createPrivateKey, verify} from 'node:crypto';
import {ml_dsa87} from '@noble/post-quantum/ml-dsa.js';
import {slh_dsa_sha2_256f} from '@noble/post-quantum/slh-dsa.js';
const data = JSON.parse(readFileSync(new URL('vectors/nist-acvp.json', import.meta.url)));
const hex = value => Buffer.from(value, 'hex');
for (const name of ['ML-DSA-87', 'SLH-DSA-SHA2-256f']) {
  const primitive = name === 'ML-DSA-87' ? ml_dsa87 : slh_dsa_sha2_256f;
  test(name + ' official NIST ACVP external pure sigVer group, native and Noble', () => {
    const vectors = data.sigVer.filter(v => v.parameterSet === name);
    assert.ok(vectors.some(v => v.testPassed)); assert.ok(vectors.some(v => !v.testPassed));
    for (const v of vectors) {
      const key = createPublicKey({key: hex(v.pk), format: 'raw-public', asymmetricKeyType: name.toLowerCase()});
      const context = hex(v.context);
      let nativeResult = false, nobleResult = false;
      try { nativeResult = verify(null, hex(v.message), {key, context}, hex(v.signature)); } catch { /* malformed negative vectors */ }
      try { nobleResult = primitive.verify(hex(v.signature), hex(v.message), hex(v.pk), {context}); } catch { /* malformed negative vectors */ }
      assert.equal(nativeResult, v.testPassed, `native tcId=${v.tcId}`);
      assert.equal(nobleResult, v.testPassed, `Noble tcId=${v.tcId}`);
    }
  });
  test(name + ' official NIST ACVP deterministic keyGen group, Noble public and private bytes', () => {
    for (const v of data.keyGen.filter(v => v.parameterSet === name)) {
      const seed = v.seed ? hex(v.seed) : Buffer.concat([hex(v.skSeed), hex(v.skPrf), hex(v.pkSeed)]);
      const k = primitive.keygen(seed);
      assert.deepEqual(Buffer.from(k.publicKey), hex(v.pk), `public tcId=${v.tcId}`);
      assert.deepEqual(Buffer.from(k.secretKey), hex(v.sk), `private tcId=${v.tcId}`);
      k.secretKey.fill(0); seed.fill(0);
    }
  });
}
test('native ML-DSA-87 seed import derives official ACVP public key', () => {
  for (const v of data.keyGen.filter(v => v.parameterSet === 'ML-DSA-87')) {
    const k = createPrivateKey({key: hex(v.seed), format: 'raw-seed', asymmetricKeyType: 'ml-dsa-87'});
    assert.deepEqual(createPublicKey(k).export({format: 'raw-public'}), hex(v.pk));
  }
});
