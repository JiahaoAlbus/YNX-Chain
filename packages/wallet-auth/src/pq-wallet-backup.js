import {PQ_BACKUP_FORMAT, PQ_PRIVATE_FORMAT, exactPQRecord, validatePQPublicBinding,
  assertPQPublicBindingMatches, pqBase64url, pqDecodeBase64url, pqError} from './pq-wallet-contract.js';

// Main/protected-vault API. This is an encrypted material container, not a
// migration authority or a successful Wallet restore. The sole protocol
// provider must import both DER keys, enforce both algorithms, recompute both
// public keys, and match the trusted chain/original binding before adoption.
export const PQ_BACKUP_LIMIT = 196608;
const ITERATIONS = 600000, encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', {fatal: true});
const HEADER_FIELDS = ['format', 'binding', 'kdf', 'cipher'];
const ENVELOPE_FIELDS = [...HEADER_FIELDS, 'ciphertext'];
function cryptoRuntime() {
  if (!globalThis.crypto?.subtle || typeof globalThis.crypto.getRandomValues !== 'function') throw pqError('PQ_SECURE_CRYPTO_UNAVAILABLE');
  return globalThis.crypto;
}
function fresh(size) { return cryptoRuntime().getRandomValues(new Uint8Array(size)); }
function ownedBytes(value, max) {
  if (!(value instanceof Uint8Array) || (typeof SharedArrayBuffer !== 'undefined' && value.buffer instanceof SharedArrayBuffer) || !value.length || value.length > max) throw pqError('PQ_BYTES_REQUIRED');
  return new Uint8Array(value);
}
// Recovery credential is independent fresh 256-bit entropy, deliberately not
// the old mnemonic, device keychain secret, or a human-chosen weak password.
export function createPQRecoveryCredential() {
  const bytes = fresh(32);
  try { return pqBase64url(bytes); } finally { bytes.fill(0); }
}
async function keyFor(credential, salt, usage) {
  const raw = pqDecodeBase64url(credential, {exact: 32, max: 32});
  try {
    const base = await cryptoRuntime().subtle.importKey('raw', raw, 'PBKDF2', false, ['deriveKey']);
    return await cryptoRuntime().subtle.deriveKey({name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITERATIONS},
      base, {name: 'AES-GCM', length: 256}, false, [usage]);
  } finally { raw.fill(0); }
}
function headerOf(value) {
  if (value.format !== PQ_BACKUP_FORMAT) throw pqError('PQ_BACKUP_VERSION_UNSUPPORTED');
  const binding = validatePQPublicBinding(value.binding);
  exactPQRecord(value.kdf, ['algorithm', 'iterations', 'salt']);
  exactPQRecord(value.cipher, ['algorithm', 'nonce']);
  if (value.kdf.algorithm !== 'PBKDF2-HMAC-SHA256' || value.kdf.iterations !== ITERATIONS || value.cipher.algorithm !== 'AES-256-GCM') throw pqError('PQ_BACKUP_CRYPTO_UNSUPPORTED');
  pqDecodeBase64url(value.kdf.salt, {exact: 32, max: 32});
  pqDecodeBase64url(value.cipher.nonce, {exact: 12, max: 12});
  return {format: PQ_BACKUP_FORMAT, binding,
    kdf: {algorithm: 'PBKDF2-HMAC-SHA256', iterations: ITERATIONS, salt: value.kdf.salt},
    cipher: {algorithm: 'AES-256-GCM', nonce: value.cipher.nonce}};
}
export async function sealPQWalletBackup(material, credential) {
  exactPQRecord(material, ['binding', 'pkcs8A', 'pkcs8B']);
  const binding = validatePQPublicBinding(material.binding);
  const a = ownedBytes(material.pkcs8A, 65536);
  let b, plaintext;
  try {
    b = ownedBytes(material.pkcs8B, 65536);
    // Snapshot all caller data before the first asynchronous operation.
    const header = headerOf({format: PQ_BACKUP_FORMAT, binding,
      kdf: {algorithm: 'PBKDF2-HMAC-SHA256', iterations: ITERATIONS, salt: pqBase64url(fresh(32))},
      cipher: {algorithm: 'AES-256-GCM', nonce: pqBase64url(fresh(12))}});
    plaintext = encoder.encode(JSON.stringify({format: PQ_PRIVATE_FORMAT, binding,
      pkcs8A: pqBase64url(a), pkcs8B: pqBase64url(b)}));
    const key = await keyFor(credential, pqDecodeBase64url(header.kdf.salt, {exact: 32, max: 32}), 'encrypt');
    const encrypted = await cryptoRuntime().subtle.encrypt({name: 'AES-GCM', iv: pqDecodeBase64url(header.cipher.nonce, {exact: 12, max: 12}),
      additionalData: encoder.encode(JSON.stringify(header)), tagLength: 128}, key, plaintext);
    const wire = encoder.encode(JSON.stringify({...header, ciphertext: pqBase64url(new Uint8Array(encrypted))}));
    if (wire.length > PQ_BACKUP_LIMIT) throw pqError('PQ_BACKUP_TOO_LARGE');
    return wire;
  } finally { a.fill(0); b?.fill(0); plaintext?.fill(0); }
}
export function inspectPQWalletBackup(wire) {
  const copy = ownedBytes(wire, PQ_BACKUP_LIMIT);
  let parsed, text;
  try { text = decoder.decode(copy); parsed = JSON.parse(text); } catch { throw pqError('PQ_BACKUP_ENCODING_INVALID'); }
  exactPQRecord(parsed, ENVELOPE_FIELDS);
  const header = headerOf(parsed);
  const ciphertext = pqDecodeBase64url(parsed.ciphertext, {max: 190000});
  if (ciphertext.length < 16 || JSON.stringify({...header, ciphertext: parsed.ciphertext}) !== text) throw pqError('PQ_BACKUP_ENCODING_INVALID');
  return Object.freeze({...header, kdf: Object.freeze(header.kdf), cipher: Object.freeze(header.cipher), ciphertext: parsed.ciphertext});
}
export async function openPQWalletBackup(wire, credential, expectedBinding) {
  // No untrusted file can select the chain/account to which it will be restored.
  const expected = validatePQPublicBinding(expectedBinding), envelope = inspectPQWalletBackup(wire);
  assertPQPublicBindingMatches(envelope.binding, expected);
  const header = headerOf(envelope);
  const key = await keyFor(credential, pqDecodeBase64url(header.kdf.salt, {exact: 32, max: 32}), 'decrypt');
  let plaintext, a, b;
  try {
    try {
      plaintext = new Uint8Array(await cryptoRuntime().subtle.decrypt({name: 'AES-GCM',
        iv: pqDecodeBase64url(header.cipher.nonce, {exact: 12, max: 12}), additionalData: encoder.encode(JSON.stringify(header)), tagLength: 128},
      key, pqDecodeBase64url(envelope.ciphertext, {max: 190000})));
    } catch { throw pqError('PQ_BACKUP_AUTHENTICATION_FAILED'); }
    let text, value;
    try { text = decoder.decode(plaintext); value = JSON.parse(text); }
    catch { throw pqError('PQ_BACKUP_ENCODING_INVALID'); }
    exactPQRecord(value, ['format', 'binding', 'pkcs8A', 'pkcs8B']);
    if (value.format !== PQ_PRIVATE_FORMAT) throw pqError('PQ_BACKUP_VERSION_UNSUPPORTED');
    const binding = assertPQPublicBindingMatches(value.binding, expected);
    a = pqDecodeBase64url(value.pkcs8A); b = pqDecodeBase64url(value.pkcs8B);
    if (JSON.stringify({format: PQ_PRIVATE_FORMAT, binding, pkcs8A: pqBase64url(a), pkcs8B: pqBase64url(b)}) !== text) throw pqError('PQ_BACKUP_ENCODING_INVALID');
    const result = {binding, pkcs8A: a, pkcs8B: b}; a = undefined; b = undefined;
    return result;
  } finally { plaintext?.fill(0); a?.fill(0); b?.fill(0); }
}
