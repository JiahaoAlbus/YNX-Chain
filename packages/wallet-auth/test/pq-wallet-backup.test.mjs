import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createPQRecoveryCredential, sealPQWalletBackup, openPQWalletBackup, inspectPQWalletBackup} from '../src/pq-wallet-backup.js';
import {PQ_PROTOCOL_VERSION, PQ_SUITE, pqBase64url, validatePQPublicBinding} from '../src/pq-wallet-contract.js';
const encode = x => new TextEncoder().encode(JSON.stringify(x));
const binding = () => ({protocolVersion: PQ_PROTOCOL_VERSION, suite: PQ_SUITE, chainId: 'a1'.repeat(32), owner: 'ynx-existing-account',
  pkA: pqBase64url(new Uint8Array(2592).fill(7)), pkB: pqBase64url(new Uint8Array(64).fill(8))});
const material = () => ({binding: binding(), pkcs8A: new Uint8Array([48, 1, 2, 3]), pkcs8B: new Uint8Array([48, 4, 5, 6])});
// PUBLIC container bytes only, never presented as real DER, valid keys, trusted
// chain state, or a successful Wallet restore. Provider integration is separate.
test('container preserves both private byte arrays, independent recovery credential, and exact binding', async () => {
  const original = material(), credential = createPQRecoveryCredential();
  const wire = await sealPQWalletBackup(original, credential), text = new TextDecoder().decode(wire);
  assert(!text.includes('pkcs8A')); assert(!text.includes(credential));
  const restored = await openPQWalletBackup(wire, credential, binding());
  assert.deepEqual(restored, original);
  assert.notEqual(restored.pkcs8A, original.pkcs8A);
  assert.notEqual(restored.pkcs8B, original.pkcs8B);
  assert.equal(inspectPQWalletBackup(wire).kdf.iterations, 600000);
  assert(Object.isFrozen(inspectPQWalletBackup(wire).binding));
  assert(Object.isFrozen(inspectPQWalletBackup(wire).kdf));
});
test('fresh salt/nonce and snapshot-before-await prevent caller mutation of exported material', async () => {
  const m = material(), credential = createPQRecoveryCredential();
  const pending = sealPQWalletBackup(m, credential);
  m.pkcs8A.fill(99); m.pkcs8B.fill(99); m.binding.owner = 'other';
  const first = await pending, second = await sealPQWalletBackup(material(), credential);
  assert.notDeepEqual(first, second);
  const restored = await openPQWalletBackup(first, credential, binding());
  assert.deepEqual(restored, material());
});
test('wrong credential, ciphertext modification and modified AAD cannot return either private component', async () => {
  const credential = createPQRecoveryCredential(), wire = await sealPQWalletBackup(material(), credential);
  await assert.rejects(openPQWalletBackup(wire, createPQRecoveryCredential(), binding()), {code: 'PQ_BACKUP_AUTHENTICATION_FAILED'});
  const changed = JSON.parse(new TextDecoder().decode(wire));
  changed.ciphertext = (changed.ciphertext[0] === 'A' ? 'B' : 'A') + changed.ciphertext.slice(1);
  await assert.rejects(openPQWalletBackup(encode(changed), credential, binding()), {code: 'PQ_BACKUP_AUTHENTICATION_FAILED'});
  const altered = JSON.parse(new TextDecoder().decode(wire));
  altered.binding.owner = 'attacker';
  await assert.rejects(openPQWalletBackup(encode(altered), credential, {...binding(), owner: 'attacker'}), {code: 'PQ_BACKUP_AUTHENTICATION_FAILED'});
});
test('cross-chain/account/key substitution is refused before decryption and no old mnemonic fallback exists', async () => {
  const credential = createPQRecoveryCredential(), wire = await sealPQWalletBackup(material(), credential);
  for (const expected of [{...binding(), chainId: 'a2'.repeat(32)}, {...binding(), owner: 'other'},
    {...binding(), pkB: pqBase64url(new Uint8Array(64).fill(9))}]) {
    await assert.rejects(openPQWalletBackup(wire, credential, expected), {code: 'PQ_BINDING_MISMATCH'});
  }
  await assert.rejects(openPQWalletBackup(wire, 'old mnemonic cannot recover new keys', binding()), {code: 'PQ_ENCODING_INVALID'});
  await assert.rejects(openPQWalletBackup(wire, credential, undefined), {code: 'PQ_SCHEMA_INVALID'});
});
test('untrusted KDF, unknown fields, duplicate JSON, oversized files, malformed base64 are refused', async () => {
  const credential = createPQRecoveryCredential(), wire = await sealPQWalletBackup(material(), credential);
  const original = JSON.parse(new TextDecoder().decode(wire));
  assert.throws(() => inspectPQWalletBackup(encode({...original, kdf: {...original.kdf, iterations: 1}})), {code: 'PQ_BACKUP_CRYPTO_UNSUPPORTED'});
  assert.throws(() => inspectPQWalletBackup(encode({...original, extra: true})), {code: 'PQ_SCHEMA_INVALID'});
  assert.throws(() => inspectPQWalletBackup(new TextEncoder().encode('{"format":"x",' + new TextDecoder().decode(wire).slice(1))), {code: 'PQ_BACKUP_ENCODING_INVALID'});
  assert.throws(() => inspectPQWalletBackup(new Uint8Array(196609)), {code: 'PQ_BYTES_REQUIRED'});
  assert.throws(() => validatePQPublicBinding({...binding(), pkB: binding().pkB + '='}), {code: 'PQ_ENCODING_INVALID'});
  assert.throws(() => validatePQPublicBinding({...binding(), protocolVersion: 'legacy'}), {code: 'PQ_BINDING_INVALID'});
});
