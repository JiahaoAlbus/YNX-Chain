// Account wire R1, frozen by Chain commit c9ed856. Parsing/framing is not
// account authority, trusted registration, signature validation, or finality.
import {Buffer} from 'node:buffer';
import {encodeFields, u32, decodeWhole, decodeMember, VERSION} from '@ynx/batch-v01-candidate';
import {secp256k1} from '@noble/curves/secp256k1.js';
import {sha256} from '@noble/hashes/sha2.js';
import {keccak_256} from '@noble/hashes/sha3.js';
import {exactPQRecord, pqError, validatePQPublicBinding, pqDecodeBase64url} from './pq-wallet-contract.js';
export const PQ_TRANSFER_DOMAIN = 'YNX-NATIVE-TRANSFER/v2';
export const PQ_REGISTRATION_DOMAIN = 'YNX-ACCOUNT-REGISTRATION/v1';
export const PQ_MIGRATION_DOMAIN = 'YNX-ACCOUNT-MIGRATION/v1';
export const PQ_POLICY_VERSION = 'YNX-ACCOUNT-POLICY/v1';
export const PQ_U64_MAX = (1n << 64n) - 1n;
const I64_MAX = (1n << 63n) - 1n;
export function pqU64(value) {
  if (typeof value !== 'bigint' && !(typeof value === 'string' && /^(0|[1-9][0-9]{0,19})$/.test(value))) throw pqError('PQ_U64_REQUIRED');
  const n = BigInt(value);
  if (n < 0n || n > PQ_U64_MAX) throw pqError('PQ_U64_OUT_OF_RANGE');
  return n;
}
export function pqCanonicalAddress(value) {
  if (typeof value !== 'string' || !/^0x[0-9a-f]{40}$/.test(value)) throw pqError('PQ_CANONICAL_ADDRESS_REQUIRED');
  return value;
}
export function pqHex(value, size) {
  if (typeof value !== 'string' || value.length !== size * 2 || !/^[0-9a-f]+$/.test(value)) throw pqError('PQ_CANONICAL_HEX_REQUIRED');
  return Buffer.from(value, 'hex');
}
const pair = n => [u32(Number(n >> 32n)), u32(Number(n & 0xffffffffn))];
function readPair(a, b) {
  if (a.length !== 4 || b.length !== 4) throw pqError('PQ_U64_WIRE_INVALID');
  return ((BigInt(a.readUInt32BE()) << 32n) | BigInt(b.readUInt32BE())).toString();
}
function copyWire(value, max) {
  if (!(value instanceof Uint8Array) || value.buffer instanceof SharedArrayBuffer || value.length > max || !value.length) throw pqError('PQ_AUTH_WIRE_INVALID');
  return Buffer.from(value);
}
function fields(value, count, max) {
  const b = copyWire(value, max);
  if (b.length < 4 + count * 4 || b.readUInt32BE(0) !== count) throw pqError('PQ_AUTH_FIELD_COUNT');
  let at = 4; const out = [];
  for (let i = 0; i < count; i++) {
    if (at + 4 > b.length) throw pqError('PQ_AUTH_TRUNCATED');
    const n = b.readUInt32BE(at); at += 4;
    if (n > b.length - at) throw pqError('PQ_AUTH_TRUNCATED');
    out.push(b.subarray(at, at + n)); at += n;
  }
  if (at !== b.length) throw pqError('PQ_AUTH_TRAILING_BYTES');
  return out;
}
function tag(bytes, expected) {
  if (!bytes.equals(Buffer.from(expected))) throw pqError('PQ_AUTH_DOMAIN_INVALID');
}
function addressBytes(b) {
  if (b.length !== 42 || b.some(n => n > 127)) throw pqError('PQ_CANONICAL_ADDRESS_REQUIRED');
  return pqCanonicalAddress(b.toString('ascii'));
}
function hexBytes(b, size) {
  if (b.length !== size) throw pqError('PQ_AUTH_FIELD_SIZE');
  return b.toString('hex');
}
const transferFields = ['chainId', 'nativeChainId', 'from', 'to', 'amount', 'fee', 'nonce'];
export function normalizePQNativeTransfer(value) {
  exactPQRecord(value, transferFields);
  const chainId = pqHex(value.chainId, 32).toString('hex'), from = pqCanonicalAddress(value.from), to = pqCanonicalAddress(value.to);
  const nativeChainId = pqU64(value.nativeChainId), amount = pqU64(value.amount), fee = pqU64(value.fee), nonce = pqU64(value.nonce);
  if (!nativeChainId || nativeChainId > I64_MAX || from === to || !amount || amount > I64_MAX || amount + fee > I64_MAX || !nonce) throw pqError('PQ_TRANSFER_VALUES_INVALID');
  return Object.freeze({chainId, nativeChainId: nativeChainId.toString(), from, to, amount: amount.toString(), fee: fee.toString(), nonce: nonce.toString()});
}
export function encodePQNativeTransfer(value) {
  const t = normalizePQNativeTransfer(value);
  return encodeFields([PQ_TRANSFER_DOMAIN, u32(2), pqHex(t.chainId, 32), ...pair(pqU64(t.nativeChainId)), t.from, t.to,
    ...pair(pqU64(t.amount)), ...pair(pqU64(t.fee)), ...pair(pqU64(t.nonce))]);
}
export function decodePQNativeTransfer(wire) {
  const f = fields(wire, 13, 1024); tag(f[0], PQ_TRANSFER_DOMAIN);
  if (!f[1].equals(u32(2))) throw pqError('PQ_AUTH_VERSION_INVALID');
  return normalizePQNativeTransfer({chainId: hexBytes(f[2], 32), nativeChainId: readPair(f[3], f[4]), from: addressBytes(f[5]), to: addressBytes(f[6]),
    amount: readPair(f[7], f[8]), fee: readPair(f[9], f[10]), nonce: readPair(f[11], f[12])});
}
const intentFields = ['chainId', 'owner', 'algorithmVersion', 'pkA', 'pkB', 'priorRevision', 'newRevision', 'ledgerNonce', 'activateAt'];
export function normalizePQRegistrationIntent(value) {
  exactPQRecord(value, intentFields);
  const chainId = pqHex(value.chainId, 32).toString('hex'), owner = pqCanonicalAddress(value.owner);
  if (value.algorithmVersion !== VERSION) throw pqError('PQ_AUTH_VERSION_INVALID');
  const pkA = pqHex(value.pkA, 2592).toString('hex'), pkB = pqHex(value.pkB, 64).toString('hex');
  const priorRevision = pqU64(value.priorRevision), newRevision = pqU64(value.newRevision), ledgerNonce = pqU64(value.ledgerNonce), activateAt = pqU64(value.activateAt);
  if (priorRevision === PQ_U64_MAX || newRevision !== priorRevision + 1n || !ledgerNonce || !activateAt) throw pqError('PQ_REGISTRATION_SEQUENCE_INVALID');
  return Object.freeze({chainId, owner, algorithmVersion: VERSION, pkA, pkB, priorRevision: priorRevision.toString(), newRevision: newRevision.toString(), ledgerNonce: ledgerNonce.toString(), activateAt: activateAt.toString()});
}
export function pqPublicBindingToRegistrationKeys(value) {
  const binding = validatePQPublicBinding(value);
  return Object.freeze({chainId: binding.chainId, owner: pqCanonicalAddress(binding.owner), algorithmVersion: VERSION,
    pkA: Buffer.from(pqDecodeBase64url(binding.pkA, {exact: 2592, max: 2592})).toString('hex'),
    pkB: Buffer.from(pqDecodeBase64url(binding.pkB, {exact: 64, max: 64})).toString('hex')});
}
export function encodePQRegistrationIntent(value) {
  const r = normalizePQRegistrationIntent(value);
  return encodeFields([PQ_REGISTRATION_DOMAIN, u32(1), pqHex(r.chainId, 32), r.owner, VERSION, pqHex(r.pkA, 2592), pqHex(r.pkB, 64),
    ...pair(pqU64(r.priorRevision)), ...pair(pqU64(r.newRevision)), ...pair(pqU64(r.ledgerNonce)), ...pair(pqU64(r.activateAt))]);
}
export function decodePQRegistrationIntent(wire) {
  const f = fields(wire, 15, 4096); tag(f[0], PQ_REGISTRATION_DOMAIN); tag(f[4], VERSION);
  if (!f[1].equals(u32(1))) throw pqError('PQ_AUTH_VERSION_INVALID');
  return normalizePQRegistrationIntent({chainId: hexBytes(f[2], 32), owner: addressBytes(f[3]), algorithmVersion: VERSION, pkA: hexBytes(f[5], 2592), pkB: hexBytes(f[6], 64),
    priorRevision: readPair(f[7], f[8]), newRevision: readPair(f[9], f[10]), ledgerNonce: readPair(f[11], f[12]), activateAt: readPair(f[13], f[14])});
}
function certificateMatches(c, {chainId, owner}, purpose) {
  if (c.owner !== owner || !c.chainId.equals(pqHex(chainId, 32)) || c.purpose !== purpose) throw pqError('PQ_PROOF_CONTEXT_MISMATCH');
}
function validateClassicAuthorization(publicKey, signature, intent, owner) {
  try {
    if (publicKey.length !== 33 || ![2, 3].includes(publicKey[0]) || signature.length < 8 || signature.length > 72) throw Error();
    const point = secp256k1.Point.fromBytes(publicKey), derived = '0x' + Buffer.from(keccak_256(point.toBytes(false).subarray(1))).subarray(12).toString('hex');
    const parsed = secp256k1.Signature.fromBytes(signature, 'der');
    if (derived !== owner || parsed.hasHighS() || !Buffer.from(parsed.toBytes('der')).equals(signature) ||
      !secp256k1.verify(signature, sha256(intent), publicKey, {prehash: false, lowS: true, format: 'der'})) throw Error();
  } catch { throw pqError('PQ_CLASSIC_AUTHORIZATION_INVALID'); }
}
// Syntactic and classic-proof validation only. PQ signatures and current policy
// must still be verified against the trusted, current registered account state.
export function decodePQMigrationRequest(wire) {
  const f = fields(wire, 6, 262144); tag(f[0], PQ_MIGRATION_DOMAIN);
  const intent = decodePQRegistrationIntent(f[1]);
  const proposed = decodeWhole(f[5]);
  certificateMatches(proposed.certificate, intent, 'ACCOUNT-MIGRATION');
  if (proposed.certificate.N !== 1 || proposed.messages.length !== 1 || !proposed.messages[0].equals(f[1]) ||
      !proposed.certificate.pkA.equals(pqHex(intent.pkA, 2592)) || !proposed.certificate.pkB.equals(pqHex(intent.pkB, 64))) throw pqError('PQ_NEW_KEY_PROOF_MISMATCH');
  let currentAuthorization;
  if (f[2].length || f[3].length) {
    if (f[4].length) throw pqError('PQ_MIXED_AUTHORIZATION_REFUSED');
    validateClassicAuthorization(f[2], f[3], f[1], intent.owner); currentAuthorization = 'legacy';
  } else {
    if (!f[4].length) throw pqError('PQ_CURRENT_AUTHORIZATION_REQUIRED');
    const current = decodeMember(f[4]);
    certificateMatches(current.certificate, intent, 'ACCOUNT-MIGRATION');
    if (!current.message.equals(f[1])) throw pqError('PQ_CURRENT_PROOF_MISMATCH');
    currentAuthorization = 'pq';
  }
  return {intent, intentBytes: Buffer.from(f[1]), currentAuthorization, classicPublicKey: Buffer.from(f[2]), classicSignature: Buffer.from(f[3]), currentPQMember: Buffer.from(f[4]), newKeyWholeProof: Buffer.from(f[5])};
}
export function encodePQMigrationRequest(value) {
  exactPQRecord(value, ['intent', 'classicPublicKey', 'classicSignature', 'currentPQMember', 'newKeyWholeProof']);
  const proof = (bytes, max) => {
    if (!(bytes instanceof Uint8Array) || bytes.buffer instanceof SharedArrayBuffer || bytes.length > max) throw pqError('PQ_AUTH_WIRE_INVALID');
    return Buffer.from(bytes);
  };
  const wire = encodeFields([PQ_MIGRATION_DOMAIN, encodePQRegistrationIntent(value.intent),
    proof(value.classicPublicKey, 33), proof(value.classicSignature, 72), proof(value.currentPQMember, 131072), proof(value.newKeyWholeProof, 131072)]);
  decodePQMigrationRequest(wire); return wire;
}
export function pqWireHash(wire) { return '0x' + Buffer.from(sha256(copyWire(wire, 262144))).toString('hex'); }
export function preparePQAuthorizationQuery(owner) {
  return Object.freeze({method: 'GET', path: '/accounts/' + pqCanonicalAddress(owner) + '/authorization'});
}
export function preparePQOriginalLookup(hash) {
  if (typeof hash !== 'string' || !/^0x[0-9a-f]{64}$/.test(hash)) throw pqError('PQ_ORIGINAL_HASH_REQUIRED');
  return Object.freeze({method: 'GET', path: '/txs/' + hash});
}
export function preparePQMigrationTransport(wire) {
  const snapshot = copyWire(wire, 262144), decoded = decodePQMigrationRequest(snapshot);
  return Object.freeze({method: 'POST', path: '/accounts/' + decoded.intent.owner + '/authorization/migrate', contentType: 'application/octet-stream', get body() { return Buffer.from(snapshot); },
    transportHash: pqWireHash(snapshot), admissionIsFinality: false});
}
export function decodePQTransferRequest(memberWire) {
  const body = copyWire(memberWire, 262144), member = decodeMember(body), transfer = decodePQNativeTransfer(member.message);
  certificateMatches(member.certificate, {chainId: transfer.chainId, owner: transfer.from}, 'TX-BATCH');
  if (member.certificate.N !== 1 || member.index !== 0 || member.pathA.length !== 0 || member.pathB.length !== 0) throw pqError('PQ_STANDALONE_N1_REQUIRED');
  return Object.freeze({transfer, purpose: 'TX-BATCH', N: 1, index: 0,
    pkA: member.certificate.pkA.toString('hex'), pkB: member.certificate.pkB.toString('hex'),
    transportHash: pqWireHash(body)});
}
export function preparePQTransferTransport(memberWire) {
  const body = copyWire(memberWire, 262144), decoded = decodePQTransferRequest(body);
  return Object.freeze({method: 'POST', path: '/transactions/pq/broadcast', contentType: 'application/octet-stream', get body() { return Buffer.from(body); }, transportHash: decoded.transportHash, admissionIsFinality: false});
}
