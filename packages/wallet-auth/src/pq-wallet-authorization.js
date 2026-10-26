// Account wire R1, frozen by Chain commit c9ed856. Parsing/framing is not
// account authority, trusted registration, signature validation, or finality.
import {Buffer} from 'node:buffer';
import {encodeFields, u32, decodeWhole, decodeMember, createVerifier, VERSION} from '@ynx/batch-v01-candidate';
import {secp256k1} from '@noble/curves/secp256k1.js';
import {sha256} from '@noble/hashes/sha2.js';
import {keccak_256} from '@noble/hashes/sha3.js';
import {exactPQRecord, pqError, validatePQPublicBinding, pqDecodeBase64url} from './pq-wallet-contract.js';
export const PQ_TRANSFER_DOMAIN = 'YNX-NATIVE-TRANSFER/v2';
export const PQ_REGISTRATION_DOMAIN = 'YNX-ACCOUNT-REGISTRATION/v1';
export const PQ_MIGRATION_DOMAIN = 'YNX-ACCOUNT-MIGRATION/v1';
export const PQ_REVOCATION_INTENT_DOMAIN = 'YNX-ACCOUNT-REVOCATION/v1';
export const PQ_REVOCATION_DOMAIN = 'YNX-ACCOUNT-REVOCATION-ENVELOPE/v1';
export const PQ_POLICY_VERSION = 'YNX-ACCOUNT-POLICY/v1';
export {pqU64,PQ_U64_MAX} from './pq-public-bytes.js';
import {pqU64,PQ_U64_MAX,pqHexBytes} from './pq-public-bytes.js';
const I64_MAX = (1n << 63n) - 1n;
/** Existing native transfer ledger total bound. Integer wire units only;
 * no EVM decimals, current-account policy or spending permission is implied. */
export const PQ_NATIVE_TRANSFER_TOTAL_MAX = I64_MAX;
export function normalizePQNativeTransferAmounts(value) {
  exactPQRecord(value, ['amount', 'fee']);
  const amount = pqU64(value.amount), fee = pqU64(value.fee);
  if (!amount || amount > I64_MAX || amount + fee > I64_MAX) throw pqError('PQ_TRANSFER_VALUES_INVALID');
  return Object.freeze({amount: amount.toString(), fee: fee.toString()});
}
export function pqCanonicalAddress(value) {
  if (typeof value !== 'string' || !/^0x[0-9a-f]{40}$/.test(value)) throw pqError('PQ_CANONICAL_ADDRESS_REQUIRED');
  return value;
}
export function pqHex(value, size) {
  return Buffer.from(pqHexBytes(value,size));
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
  if (!nativeChainId || nativeChainId > I64_MAX || from === to || !nonce) throw pqError('PQ_TRANSFER_VALUES_INVALID');
  const values = normalizePQNativeTransferAmounts({amount, fee});
  return Object.freeze({chainId, nativeChainId: nativeChainId.toString(), from, to, amount: values.amount, fee: values.fee, nonce: nonce.toString()});
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
// Protocol fa55a5ef: public initial registration is an original E15 Member,
// never a migration envelope. Expected bytes are caller-selected DATA; this
// parser does not authenticate their Genesis issuer/pin or account occupancy.
export function decodePQAccountInitialRequest(wire, expected) {
  exactPQRecord(expected, ['chainId', 'owner', 'pkA', 'pkB', 'executionHeight']);
  const chainId = pqHex(expected.chainId, 32).toString('hex'), owner = pqCanonicalAddress(expected.owner);
  const pkA = pqHex(expected.pkA, 2592), pkB = pqHex(expected.pkB, 64);
  if (typeof expected.executionHeight !== 'string' || !pqU64(expected.executionHeight)) throw pqError('PQ_INITIAL_HEIGHT_REQUIRED');
  const body = copyWire(wire, 98304), member = decodeMember(body), c = member.certificate;
  const intent = decodePQRegistrationIntent(member.message);
  certificateMatches(c, intent, 'TX-BATCH');
  if (c.N !== 1 || member.index !== 0 || member.pathA.length || member.pathB.length) throw pqError('PQ_STANDALONE_N1_REQUIRED');
  if (intent.priorRevision !== '0' || intent.newRevision !== '1' || intent.ledgerNonce !== '1' || pqU64(intent.activateAt) <= pqU64(expected.executionHeight)) throw pqError('PQ_INITIAL_SEQUENCE_INVALID');
  if (intent.chainId !== chainId || intent.owner !== owner || intent.pkA !== pkA.toString('hex') || intent.pkB !== pkB.toString('hex') || !c.pkA.equals(pkA) || !c.pkB.equals(pkB)) throw pqError('PQ_INITIAL_BINDING_MISMATCH');
  // Existing candidate AND verifier with a local mathematical coordinate only.
  // This adapter binds the already selected full pair, and is never returned,
  // branded as a registered snapshot or persisted as an active account policy.
  // Actual U64 H and future activation were compared above without Number.
  const verifier = createVerifier({provider: 'portable', chainId: Buffer.from(chainId, 'hex'), purpose: 'TX-BATCH', cacheEntries: 0,
    resolveTrustedOwner: () => ({algorithmVersion: VERSION, enabled: true, chainId: Buffer.from(chainId, 'hex'), owner, pkA, pkB, purpose: 'TX-BATCH', policyRevision: 'birth-math-only', activeFrom: 0, revokedAt: null})});
  try { if (!verifier.verifyOne(body, {height: 0})) throw pqError('PQ_INITIAL_SIGNATURE_INVALID'); }
  finally { verifier.clear(); }
  const message = Buffer.from(member.message);
  // Same field order/hex encoding as consensus.EncodePQTransaction, no newline.
  const envelope = Buffer.from(JSON.stringify({version: 1, type: 'account_initial', wireHex: body.toString('hex')}));
  return Object.freeze({intent, get intentBytes() { return Buffer.from(message); }, get rawMember() { return Buffer.from(body); },
    purpose: 'TX-BATCH', N: 1, index: 0, transportHash: pqWireHash(body), abciTransactionHash: pqWireHash(envelope),
    signatureVerified: true, dataOnly: true, bootstrapAdmission: false});
}
export function preparePQAccountInitialTransport(wire, expected) {
  const decoded = decodePQAccountInitialRequest(wire, expected), body = decoded.rawMember;
  return Object.freeze({method: 'POST', path: '/accounts/' + decoded.intent.owner + '/authorization/register', contentType: 'application/octet-stream',
    get body() { return Buffer.from(body); }, transportHash: decoded.transportHash, abciTransactionHash: decoded.abciTransactionHash, admissionIsFinality: false});
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
/** Converts only original lawful signer's PUBLIC r/s result; no private key or
 * signer. Exact intent, low-S DER and preserved owner are independently checked.
 * Caller must separately enforce the current pre-activation policy/permission. */
export function encodePQClassicMigrationProof(value,signature){
  const intent=normalizePQRegistrationIntent(value);
  exactPQRecord(signature,['publicKey','r','s']);
  if(typeof signature.publicKey!=='string'||!/^0x(?:(?:02|03)[0-9a-f]{64}|04[0-9a-f]{128})$/.test(signature.publicKey)||
    ![signature.r,signature.s].every(x=>typeof x==='string'&&/^0x[0-9a-f]{64}$/.test(x)))throw pqError('PQ_CLASSIC_AUTHORIZATION_INVALID');
  try{
    const pub=Buffer.from(secp256k1.Point.fromHex(signature.publicKey.slice(2)).toBytes(true));
    const parsed=new secp256k1.Signature(BigInt(signature.r),BigInt(signature.s));
    if(parsed.hasHighS())throw Error();
    const der=Buffer.from(parsed.toBytes('der'));
    validateClassicAuthorization(pub,der,encodePQRegistrationIntent(intent),intent.owner);
    return Object.freeze({get classicPublicKey(){return new Uint8Array(pub);},get classicSignature(){return new Uint8Array(der);}});
  }catch{throw pqError('PQ_CLASSIC_AUTHORIZATION_INVALID');}
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
/** Exact proposed-pair possession math only. Original Auth still verifies the
 * old signer, genuine current Source and independent migration permission. */
export function verifyPQMigrationPossessionData(newKeyWholeProof,expectedIntent){
  const intent=normalizePQRegistrationIntent(expectedIntent),message=encodePQRegistrationIntent(intent),wire=copyWire(newKeyWholeProof,131072),w=decodeWhole(wire),c=w.certificate;
  certificateMatches(c,intent,'ACCOUNT-MIGRATION');
  if(c.N!==1||w.messages.length!==1||!w.messages[0].equals(message)||!c.pkA.equals(pqHex(intent.pkA,2592))||!c.pkB.equals(pqHex(intent.pkB,64)))throw pqError('PQ_NEW_KEY_PROOF_MISMATCH');
  // Local math coordinate only, never actual height or an active policy. This
  // transient pair resolver cannot become a branded registered snapshot.
  const verifier=createVerifier({provider:'portable',chainId:pqHex(intent.chainId,32),purpose:'ACCOUNT-MIGRATION',cacheEntries:0,resolveTrustedOwner:()=>({algorithmVersion:VERSION,enabled:true,chainId:pqHex(intent.chainId,32),owner:intent.owner,pkA:pqHex(intent.pkA,2592),pkB:pqHex(intent.pkB,64),purpose:'ACCOUNT-MIGRATION',policyRevision:'new-pair-possession-math-only',activeFrom:0,revokedAt:null})});
  try{if(!verifier.verifyWhole(wire,{height:0}))throw pqError('PQ_MIGRATION_POSSESSION_SIGNATURE_INVALID');}finally{verifier.clear();}
  return Object.freeze({intent,purpose:'ACCOUNT-MIGRATION',N:1,signatureVerified:true,dataOnly:true,registered:false,current:false,SourceAdmission:false,NativeAdmission:false,approval:false});
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
function pqReadPlan(hash, prefix, suffix = '') {
  if (typeof hash !== 'string' || hash.length !== 66 || !/^0x[0-9a-f]{64}$/.test(hash)) throw pqError('PQ_ORIGINAL_HASH_REQUIRED');
  return Object.freeze({method: 'GET', path: prefix + hash + suffix});
}
// Protocol b777232d: Member/Whole bytes and their ABCI JSON envelope have
// different hashes. These plans never query a substitute hash or perform I/O.
export function preparePQOriginalLookup(nativeTransactionHash) {
  return pqReadPlan(nativeTransactionHash, '/transactions/pq/originals/');
}
export function preparePQActionOriginalLookup(nativeTransactionHash) {
  return pqReadPlan(nativeTransactionHash, '/transactions/pq/actions/originals/');
}
export function preparePQWholeOriginalLookup(abciTransactionHash) {
  return pqReadPlan(abciTransactionHash, '/transactions/pq/wholes/');
}
export function preparePQTransactionLookup(abciTransactionHash) {
  return pqReadPlan(abciTransactionHash, '/txs/');
}
// Collector response remains unverified DATA, not consensus finality. The
// original trusted verifier, exact retained bytes and current bindings apply.
export function preparePQTransferFinalityLookup(abciTransactionHash) {
  return pqReadPlan(abciTransactionHash, '/txs/', '/pq-finality-proof');
}
export function preparePQActionFinalityLookup(abciTransactionHash) {
  return pqReadPlan(abciTransactionHash, '/txs/', '/pq-action-finality-proof');
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

// Existing ynxauth revocation grammar. Only the CURRENT full pair may sign;
// framing is not signature verification, user approval, admission or finality.
const revocationFields=['chainId','owner','algorithmVersion','pkA','pkB','authorizingRevision','throughRevision','ledgerNonce','executeAt','revokeAt'];
export function normalizePQRevocationIntent(value){
  exactPQRecord(value,revocationFields);
  const chainId=pqHex(value.chainId,32).toString('hex'),owner=pqCanonicalAddress(value.owner);
  if(value.algorithmVersion!==VERSION)throw pqError('PQ_AUTH_VERSION_INVALID');
  const pkA=pqHex(value.pkA,2592).toString('hex'),pkB=pqHex(value.pkB,64).toString('hex');
  const authorizingRevision=pqU64(value.authorizingRevision),throughRevision=pqU64(value.throughRevision),ledgerNonce=pqU64(value.ledgerNonce),executeAt=pqU64(value.executeAt),revokeAt=pqU64(value.revokeAt);
  if(!authorizingRevision||throughRevision<authorizingRevision||!ledgerNonce||!executeAt||executeAt===PQ_U64_MAX||revokeAt!==executeAt+1n)throw pqError('PQ_REVOCATION_SEQUENCE_INVALID');
  return Object.freeze({chainId,owner,algorithmVersion:VERSION,pkA,pkB,authorizingRevision:authorizingRevision.toString(),throughRevision:throughRevision.toString(),ledgerNonce:ledgerNonce.toString(),executeAt:executeAt.toString(),revokeAt:revokeAt.toString()});
}
export function encodePQRevocationIntent(value){
  const r=normalizePQRevocationIntent(value);
  return encodeFields([PQ_REVOCATION_INTENT_DOMAIN,u32(1),pqHex(r.chainId,32),r.owner,VERSION,pqHex(r.pkA,2592),pqHex(r.pkB,64),
    ...pair(pqU64(r.authorizingRevision)),...pair(pqU64(r.throughRevision)),...pair(pqU64(r.ledgerNonce)),...pair(pqU64(r.executeAt)),...pair(pqU64(r.revokeAt))]);
}
export function decodePQRevocationIntent(wire){
  const f=fields(wire,17,4096);tag(f[0],PQ_REVOCATION_INTENT_DOMAIN);tag(f[4],VERSION);
  if(!f[1].equals(u32(1)))throw pqError('PQ_AUTH_VERSION_INVALID');
  return normalizePQRevocationIntent({chainId:hexBytes(f[2],32),owner:addressBytes(f[3]),algorithmVersion:VERSION,pkA:hexBytes(f[5],2592),pkB:hexBytes(f[6],64),
    authorizingRevision:readPair(f[7],f[8]),throughRevision:readPair(f[9],f[10]),ledgerNonce:readPair(f[11],f[12]),executeAt:readPair(f[13],f[14]),revokeAt:readPair(f[15],f[16])});
}
export function decodePQRevocationRequest(wire){
  const original=copyWire(wire,131072),f=fields(original,3,131072);tag(f[0],PQ_REVOCATION_DOMAIN);
  const intent=decodePQRevocationIntent(f[1]),member=decodeMember(f[2]);
  certificateMatches(member.certificate,intent,'ACCOUNT-REVOCATION');
  if(member.certificate.N!==1||member.index!==0||member.pathA.length!==0||member.pathB.length!==0)throw pqError('PQ_STANDALONE_N1_REQUIRED');
  if(!member.message.equals(f[1])||!member.certificate.pkA.equals(pqHex(intent.pkA,2592))||!member.certificate.pkB.equals(pqHex(intent.pkB,64)))throw pqError('PQ_CURRENT_PROOF_MISMATCH');
  return Object.freeze({intent,intentBytes:Buffer.from(f[1]),currentPQMember:Buffer.from(f[2]),pkA:member.certificate.pkA.toString('hex'),pkB:member.certificate.pkB.toString('hex'),purpose:'ACCOUNT-REVOCATION',N:1,index:0,transportHash:pqWireHash(original)});
}
export function encodePQRevocationRequest(value){
  exactPQRecord(value,['intent','currentPQMember']);
  const wire=encodeFields([PQ_REVOCATION_DOMAIN,encodePQRevocationIntent(value.intent),copyWire(value.currentPQMember,131072)]);
  decodePQRevocationRequest(wire);return wire;
}
export function preparePQRevocationTransport(wire){
  const original=copyWire(wire,131072),decoded=decodePQRevocationRequest(original);
  return Object.freeze({method:'POST',path:'/accounts/'+decoded.intent.owner+'/authorization/revoke',contentType:'application/octet-stream',get body(){return Buffer.from(original);},transportHash:decoded.transportHash,admissionIsFinality:false});
}
