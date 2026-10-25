import {generateKeyPairSync, createPrivateKey, createPublicKey, randomBytes, sign, verify} from 'node:crypto';
import {requireThat, exact, VERSION, SUITE} from './codec.mjs';

export const RUNTIME = Object.freeze({node: '26.7.0', openssl: '3.6.4'});
export function assertRuntime() {
  requireThat(process.versions.node === RUNTIME.node && process.versions.openssl === RUNTIME.openssl,
    'unvalidated crypto runtime; candidate pins Node 26.7.0 / OpenSSL 3.6.4');
}
const algorithms = Object.freeze({A: 'ml-dsa-87', B: 'slh-dsa-sha2-256f'});
export const KEY_MATERIAL_FORMAT = 'YNX-BATCH/KEY-MATERIAL/v1';
// A deliberately narrow PKCS8 profile, not a general ASN.1 parser. ML-DSA-87's
// privateKey is the seed-only CHOICE [0]; SLH-DSA contains its full 4n-byte key.
// These headers contain no secret bytes and include the exact algorithm OID.
const headers = Object.freeze({
  A: Buffer.from('3034020100300b060960864801650304031304228020', 'hex'),
  B: Buffer.from('308193020100300b0609608648016503040319048180', 'hex'),
});
const secretLengths = Object.freeze({A: 32, B: 128});
export function encodePrivateDER(branch, raw) {
  requireThat(branch === 'A' || branch === 'B', 'unknown key branch');
  return Buffer.concat([headers[branch], exact(raw, secretLengths[branch], 'private key')]);
}
export function decodePrivateDER(branch, der) {
  requireThat(branch === 'A' || branch === 'B', 'unknown key branch');
  exact(der, headers[branch].length + secretLengths[branch], 'PKCS8 ' + branch);
  requireThat(der.subarray(0, headers[branch].length).equals(headers[branch]), 'unsupported PKCS8 algorithm or encoding');
  return Buffer.from(der.subarray(headers[branch].length));
}
export function materialRecord(pkcs8A, pkcs8B, publicKey) {
  exact(publicKey.pkA, 2592, 'pkA'); exact(publicKey.pkB, 64, 'pkB');
  return {format: KEY_MATERIAL_FORMAT, algorithmVersion: VERSION, suite: SUITE,
    pkcs8A: Buffer.from(pkcs8A), pkcs8B: Buffer.from(pkcs8B),
    pkA: Buffer.from(exact(publicKey.pkA, 2592, 'pkA')), pkB: Buffer.from(exact(publicKey.pkB, 64, 'pkB'))};
}
export function copyKeyMaterial(material) {
  requireThat(material && material.format === KEY_MATERIAL_FORMAT && material.algorithmVersion === VERSION && material.suite === SUITE,
    'unsupported private key material format or suite');
  // Validate both before making a secret copy; rejected views never become handles.
  for (const branch of ['A', 'B']) {
    const der = exact(material['pkcs8' + branch], headers[branch].length + secretLengths[branch], 'PKCS8 ' + branch);
    requireThat(der.subarray(0, headers[branch].length).equals(headers[branch]), 'unsupported PKCS8 algorithm or encoding');
  }
  return materialRecord(material.pkcs8A, material.pkcs8B, material);
}
export function requirePublicMatch(actual, expected) {
  requireThat(actual.pkA.equals(exact(expected.pkA, 2592, 'expected pkA')) &&
    actual.pkB.equals(exact(expected.pkB, 64, 'expected pkB')), 'private/public key mismatch');
}
export function generateNativeKeys() {
  assertRuntime();
  // Separate standard KeyGen calls, using separate native CSPRNG requests.
  return {A: generateKeyPairSync(algorithms.A), B: generateKeyPairSync(algorithms.B)};
}
export function publicBytes(keys) {
  return {pkA: exact(keys.A.publicKey.export({format: 'raw-public'}), 2592, 'pkA'),
    pkB: exact(keys.B.publicKey.export({format: 'raw-public'}), 64, 'pkB')};
}
export function exportNativeKeys(keys) {
  assertRuntime();
  const A = keys.A.privateKey.export({format: 'der', type: 'pkcs8'});
  const B = keys.B.privateKey.export({format: 'der', type: 'pkcs8'});
  try {
    for (const [branch, der] of [['A', A], ['B', B]]) {
      exact(der, headers[branch].length + secretLengths[branch], 'PKCS8 ' + branch);
      requireThat(der.subarray(0, headers[branch].length).equals(headers[branch]), 'unsupported PKCS8 algorithm or encoding');
    }
    return materialRecord(A, B, publicBytes(keys));
  }
  finally { A.fill(0); B.fill(0); }
}
export function importNativeKeys(material) {
  assertRuntime();
  const saved = copyKeyMaterial(material);
  try {
    const keys = Object.fromEntries(['A', 'B'].map(branch => {
      const privateKey = createPrivateKey({key: saved['pkcs8' + branch], format: 'der', type: 'pkcs8'});
      requireThat(privateKey.asymmetricKeyType === algorithms[branch], 'private key algorithm mismatch');
      return [branch, {privateKey, publicKey: createPublicKey(privateKey)}];
    }));
    requirePublicMatch(publicBytes(keys), saved);
    // Some expanded key formats embed a public key. Deriving a KeyObject public
    // key alone does not demonstrate that its secret and embedded root agree.
    // This self-check never grants an account/session/chain authorization.
    const challenge = Buffer.concat([Buffer.from(KEY_MATERIAL_FORMAT + '/IMPORT-CHECK\0'), randomBytes(32)]);
    for (const branch of ['A', 'B']) {
      const signature = signNative(keys, branch, challenge);
      requireThat(verifyNative({[branch]: keys[branch].publicKey}, branch, challenge, signature), 'inconsistent private key');
    }
    return keys;
  } finally { saved.pkcs8A.fill(0); saved.pkcs8B.fill(0); }
}
export function signNative(keys, branch, message) {
  assertRuntime();
  return sign(null, message, {key: keys[branch].privateKey, context: Buffer.alloc(0)});
}
export function importNativePublic(certificate) {
  assertRuntime();
  return Object.fromEntries(['A', 'B'].map(branch => [branch, createPublicKey({
    key: certificate['pk' + branch], format: 'raw-public', asymmetricKeyType: algorithms[branch],
  })]));
}
export function verifyNative(keys, branch, message, signature) {
  assertRuntime();
  return verify(null, message, {key: keys[branch], context: Buffer.alloc(0)}, signature);
}
export const nativeProvider = Object.freeze({
  generate: generateNativeKeys, publicBytes, sign: signNative, importPublic: importNativePublic, verify: verifyNative,
  exportKeys: exportNativeKeys, importKeys: importNativeKeys,
  // KeyObject memory is managed by Node/OpenSSL; no immediate wipe guarantee.
  destroy() {},
  info() { assertRuntime(); return Object.freeze({provider: 'native', node: process.versions.node, openssl: process.versions.openssl}); },
});
