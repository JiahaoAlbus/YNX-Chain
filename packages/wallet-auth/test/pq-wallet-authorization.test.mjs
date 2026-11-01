import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {secp256k1} from '@noble/curves/secp256k1.js';
import {sha256} from '@noble/hashes/sha2.js';
import {keccak_256} from '@noble/hashes/sha3.js';
import {keyGen, batchSign, extract, encodeMember, discardBatch, destroyKey} from '@ynx/batch-v01-candidate';
import {encodePQNativeTransfer, decodePQNativeTransfer, encodePQRegistrationIntent, decodePQRegistrationIntent,
  pqU64, encodePQMigrationRequest, decodePQMigrationRequest, preparePQMigrationTransport, preparePQTransferTransport, pqWireHash} from '../src/pq-wallet-authorization.js';
const vectors = JSON.parse(await readFile(new URL('../testdata/pq-wallet-wire-r1.json', import.meta.url)));
test('unsigned R1 transfer and registration bytes match frozen vectors without Number rounding', () => {
  for (const [v, encode, decode] of [[vectors.transfer, encodePQNativeTransfer, decodePQNativeTransfer], [vectors.registration, encodePQRegistrationIntent, decodePQRegistrationIntent]]) {
    const actual = encode(v.fields);
    assert.equal(actual.toString('hex'), v.wireHex);
    assert.equal(actual.length, v.bytes);
    assert.equal(Buffer.from(sha256(actual)).toString('hex'), v.sha256);
    assert.deepEqual(decode(actual), v.fields);
  }
});
test('U64 accepts exact decimal/BigInt and refuses unsafe or ambiguous Number paths', () => {
  assert.equal(pqU64('9007199254740993'), 9007199254740993n);
  assert.equal(pqU64('18446744073709551615'), 18446744073709551615n);
  for (const n of [9007199254740992, 1, '01', '-1', '1.0', '1e3', '18446744073709551616']) assert.throws(() => pqU64(n));
  assert.throws(() => encodePQRegistrationIntent({...vectors.registration.fields, priorRevision: '18446744073709551615', newRevision: '0'}), {code: 'PQ_REGISTRATION_SEQUENCE_INVALID'});
});
test('strict framing rejects trailing, truncated, wrong domains, non-ASCII aliases and extra fields', () => {
  const original = encodePQNativeTransfer(vectors.transfer.fields);
  assert.throws(() => decodePQNativeTransfer(Buffer.concat([original, Buffer.from([0])])));
  assert.throws(() => decodePQNativeTransfer(original.subarray(0, -1)));
  const domain = Buffer.from(original); domain[8] ^= 1;
  assert.throws(() => decodePQNativeTransfer(domain), {code: 'PQ_AUTH_DOMAIN_INVALID'});
  const nonASCII = Buffer.from(original), at = nonASCII.indexOf(vectors.transfer.fields.from); nonASCII[at] |= 128;
  assert.throws(() => decodePQNativeTransfer(nonASCII), {code: 'PQ_CANONICAL_ADDRESS_REQUIRED'});
  assert.throws(() => encodePQNativeTransfer({...vectors.transfer.fields, classicFallback: true}), {code: 'PQ_SCHEMA_INVALID'});
  assert.throws(() => encodePQNativeTransfer({...vectors.transfer.fields, from: 'ynx-bech32-display-alias'}));
});
test('transfer signed-int64 and nonce boundaries agree with frozen message grammar', () => {
  assert.throws(() => encodePQNativeTransfer({...vectors.transfer.fields, amount: '9223372036854775807', fee: '1'}), {code: 'PQ_TRANSFER_VALUES_INVALID'});
  assert.throws(() => encodePQNativeTransfer({...vectors.transfer.fields, amount: '0'}));
  assert.throws(() => encodePQNativeTransfer({...vectors.transfer.fields, nonce: '0'}));
  assert.throws(() => encodePQNativeTransfer({...vectors.transfer.fields, to: vectors.transfer.fields.from}));
});

// Fresh isolated mathematical test keys. No existing account, chain registration,
// migration execution or Source is constructed or represented by these tests.
test('migration separates lawful classic/PQ branches and new-pair N1 possession, preserves original wire identity', () => {
  const secret = randomBytes(32), publicKey = Buffer.from(secp256k1.getPublicKey(secret, true));
  const owner = '0x' + Buffer.from(keccak_256(secp256k1.getPublicKey(secret, false).subarray(1))).subarray(12).toString('hex');
  const proposed = keyGen({provider: 'portable'}), current = keyGen({provider: 'portable'}), batches = [];
  try {
    const intent = {...vectors.registration.fields, owner, pkA: proposed.publicKey.pkA.toString('hex'), pkB: proposed.publicKey.pkB.toString('hex')};
    const intentBytes = encodePQRegistrationIntent(intent), metadata = {chainId: Buffer.from(intent.chainId, 'hex'), owner, purpose: 'ACCOUNT-MIGRATION'};
    const proof = batchSign(proposed.privateKey, metadata, [intentBytes]); batches.push(proof.batch);
    const signature = Buffer.from(secp256k1.sign(sha256(intentBytes), secret, {prehash: false, lowS: true, format: 'der'}));
    const legacy = {intent, classicPublicKey: publicKey, classicSignature: signature, currentPQMember: Buffer.alloc(0), newKeyWholeProof: proof.wholeWire};
    const legacyWire = encodePQMigrationRequest(legacy), decoded = decodePQMigrationRequest(legacyWire);
    assert.equal(decoded.currentAuthorization, 'legacy');
    assert(decoded.intentBytes.equals(intentBytes));
    const transport = preparePQMigrationTransport(legacyWire), identity = transport.transportHash;
    assert.equal(identity, pqWireHash(legacyWire));
    transport.body.fill(0); legacyWire.fill(0);
    assert.equal(pqWireHash(transport.body), identity);
    const oldProof = batchSign(current.privateKey, metadata, [intentBytes]); batches.push(oldProof.batch);
    const currentPQMember = encodeMember(extract(oldProof.batch, 0));
    const active = {...legacy, classicPublicKey: Buffer.alloc(0), classicSignature: Buffer.alloc(0), currentPQMember};
    assert.equal(decodePQMigrationRequest(encodePQMigrationRequest(active)).currentAuthorization, 'pq');
    assert.throws(() => encodePQMigrationRequest({...legacy, currentPQMember}), {code: 'PQ_MIXED_AUTHORIZATION_REFUSED'});
    assert.throws(() => encodePQMigrationRequest({...active, currentPQMember: Buffer.alloc(0)}), {code: 'PQ_CURRENT_AUTHORIZATION_REQUIRED'});
    const changedSignature = Buffer.from(signature); changedSignature[changedSignature.length - 1] ^= 1;
    assert.throws(() => encodePQMigrationRequest({...legacy, classicSignature: changedSignature}), {code: 'PQ_CLASSIC_AUTHORIZATION_INVALID'});
    const pairProof = batchSign(proposed.privateKey, metadata, [intentBytes, intentBytes]); batches.push(pairProof.batch);
    assert.throws(() => encodePQMigrationRequest({...legacy, newKeyWholeProof: pairProof.wholeWire}), {code: 'PQ_NEW_KEY_PROOF_MISMATCH'});
  } finally { secret.fill(0); for (const b of batches) discardBatch(b); destroyKey(proposed.privateKey); destroyKey(current.privateKey); }
});
test('standalone route refuses a hidden aggregate/member and has no classic fallback field', () => {
  const pair = keyGen({provider: 'portable'}), batches = [];
  try {
    const bytes = encodePQNativeTransfer(vectors.transfer.fields);
    const metadata = {chainId: Buffer.from(vectors.transfer.fields.chainId, 'hex'), owner: vectors.transfer.fields.from, purpose: 'TX-BATCH'};
    for (const N of [1, 2]) {
      const signed = batchSign(pair.privateKey, metadata, Array(N).fill(bytes)); batches.push(signed.batch);
      const member = encodeMember(extract(signed.batch, 0));
      if (N === 1) {
        const planned = preparePQTransferTransport(member);
        assert.equal(planned.path, '/transactions/pq/broadcast');
        assert.equal(planned.admissionIsFinality, false);
        assert.equal('classicSignature' in planned, false);
      } else assert.throws(() => preparePQTransferTransport(member), {code: 'PQ_STANDALONE_N1_REQUIRED'});
    }
  } finally { for (const b of batches) discardBatch(b); destroyKey(pair.privateKey); }
});
