import {keyGen, exportKeyMaterial, importKeyMaterial, destroyKey, batchSign, extract, encodeMember, discardBatch} from '@ynx/batch-v01-candidate';
import {Buffer} from 'node:buffer';
import {PQ_PROTOCOL_VERSION, PQ_SUITE, validatePQPublicBinding, assertPQPublicBindingMatches,
  pqBase64url, pqDecodeBase64url, pqError, validatePQNetworkBinding} from './pq-wallet-contract.js';
import {sealPQWalletBackup, openPQWalletBackup} from './pq-wallet-backup.js';
import {encodePQNativeTransfer, encodePQRegistrationIntent, normalizePQRegistrationIntent,
  preparePQTransferTransport, encodePQRevocationIntent, preparePQRevocationTransport, encodePQRevocationRequest} from './pq-wallet-authorization.js';
import {planPQNativeTransfer, planPQAccountMigration} from './pq-wallet-policy.js';
import {planPQAccountRevocation} from './pq-wallet-policy.js';
import {capturePQSessionSigningPlan} from './product-session-account-private.js';

// Protected main only. A key-custody handle never asserts migration, active
// registration, signing approval, a product session, or transaction authority.
// One explicit portable provider: no runtime/algorithm downgrade or fallback.
const keys = new WeakMap(), cleanupDebt = new Set();
const provider = Object.freeze({provider: 'portable'});
function captured(result) {
  const native = result?.privateKey;
  if (!native || typeof native !== 'object') throw pqError('PQ_PROVIDER_KEY_REQUIRED');
  return native;
}
function publicBinding(publicKey, network) {
  return validatePQPublicBinding({protocolVersion: PQ_PROTOCOL_VERSION, suite: PQ_SUITE,
    chainId: network.chainId, owner: network.owner,
    pkA: pqBase64url(publicKey.pkA), pkB: pqBase64url(publicKey.pkB)});
}
function live(ref) {
  const state = keys.get(ref);
  if (!state?.active) throw pqError('PQ_KEY_HANDLE_UNAVAILABLE');
  return state;
}
function adopt(native, binding) {
  const handle = Object.freeze(Object.create(null));
  keys.set(handle, {native, binding, active: true, cleanup: 'not-requested', cleanupCause: undefined});
  return handle;
}
function retire(state) {
  state.active = false;
  if (state.cleanup === 'complete') return false;
  if (state.cleanup === 'unknown') throw state.cleanupCause;
  if (state.cleanup === 'entered') throw pqError('PQ_KEY_CLEANUP_UNRESOLVED');
  state.cleanup = 'entered'; cleanupDebt.add(state);
  try {
    if (destroyKey(state.native) !== true) throw pqError('PQ_KEY_CLEANUP_UNRESOLVED');
    state.cleanup = 'complete'; cleanupDebt.delete(state); return true;
  } catch (cause) { state.cleanup = 'unknown'; state.cleanupCause = cause; throw cause; }
}
function preserveFailedAcquisition(native, cause) {
  const state = {native, active: false, cleanup: 'not-requested', firstCause: cause};
  try { retire(state); } catch { /* retain the same owner and cleanup debt, never replace the first cause */ }
}
export function pqWalletKeyCleanupUnresolved() { return cleanupDebt.size !== 0; }
export function readPQWalletKeyCleanupOutcome(handle) {
  const state = keys.get(handle);
  if (!state) throw pqError('PQ_KEY_HANDLE_UNAVAILABLE');
  return Object.freeze({retired: !state.active, cleanupComplete: state.cleanup === 'complete', cleanupUnknown: state.cleanup === 'unknown' || state.cleanup === 'entered'});
}
export async function createPQWalletKeyHandle(network) {
  if (cleanupDebt.size) throw pqError('PQ_KEY_CLEANUP_UNRESOLVED');
  // Reject invalid original-network binding before doing expensive keygen.
  const fixed = validatePQNetworkBinding(network);
  const result = await keyGen(provider), native = captured(result);
  try { return adopt(native, publicBinding(result.publicKey, fixed)); }
  catch (cause) { preserveFailedAcquisition(native, cause); throw cause; }
}
export function readPQWalletKeyPublic(handle) {
  return live(handle).binding;
}
export function destroyPQWalletKeyHandle(handle) {
  const state = keys.get(handle);
  if (!state) return false;
  // Fence before entering foreign cleanup; no signing/export after retirement.
  return retire(state);
}
export async function exportPQWalletBackup(handle, credential) {
  const state = live(handle), material = exportKeyMaterial(state.native);
  try {
    if (material.format !== 'YNX-BATCH/KEY-MATERIAL/v1' || material.algorithmVersion !== PQ_PROTOCOL_VERSION || material.suite !== PQ_SUITE) throw pqError('PQ_PROVIDER_KEY_FORMAT_INVALID');
    assertPQPublicBindingMatches(publicBinding({pkA: material.pkA, pkB: material.pkB}, state.binding), state.binding);
    const wire = await sealPQWalletBackup({binding: state.binding, pkcs8A: material.pkcs8A, pkcs8B: material.pkcs8B}, credential);
    live(handle); // A lock/retirement during the KDF must not release a late backup.
    return wire;
  } finally { material.pkcs8A?.fill(0); material.pkcs8B?.fill(0); }
}
export async function restorePQWalletKeyHandle(wire, credential, expectedBinding) {
  if (cleanupDebt.size) throw pqError('PQ_KEY_CLEANUP_UNRESOLVED');
  const expected = validatePQPublicBinding(expectedBinding);
  const material = await openPQWalletBackup(wire, credential, expected);
  let native, a, b;
  try {
    a = Buffer.from(material.pkcs8A); b = Buffer.from(material.pkcs8B);
    const result = await importKeyMaterial({format: 'YNX-BATCH/KEY-MATERIAL/v1',
      algorithmVersion: PQ_PROTOCOL_VERSION, suite: PQ_SUITE,
      pkcs8A: a, pkcs8B: b,
      pkA: Buffer.from(pqDecodeBase64url(expected.pkA, {exact: 2592, max: 2592})),
      pkB: Buffer.from(pqDecodeBase64url(expected.pkB, {exact: 64, max: 64}))}, provider);
    native = captured(result); // Capture both-key custody before validation.
    const recomputed = publicBinding(result.publicKey, expected);
    assertPQPublicBindingMatches(recomputed, expected);
    const handle = adopt(native, recomputed); native = undefined;
    return handle;
  } catch (cause) {
    if (native) { preserveFailedAcquisition(native, cause); native = undefined; }
    throw cause;
  } finally {
    material.pkcs8A.fill(0); material.pkcs8B.fill(0);
    a?.fill(0); b?.fill(0);
  }
}

function signingBinding(state, {chainId, owner}, pkA, pkB) {
  const binding = state.binding;
  if (binding.chainId !== chainId || binding.owner !== owner ||
      Buffer.from(pqDecodeBase64url(binding.pkA, {exact: 2592, max: 2592})).toString('hex') !== pkA ||
      Buffer.from(pqDecodeBase64url(binding.pkB, {exact: 64, max: 64})).toString('hex') !== pkB) throw pqError('PQ_CURRENT_REGISTERED_KEY_MISMATCH');
}
function signOne(handle, state, message, purpose, whole) {
  live(handle);
  const signed = batchSign(state.native, {chainId: Buffer.from(state.binding.chainId, 'hex'), owner: state.binding.owner, purpose}, [message]);
  try {
    const wire = whole ? Buffer.from(signed.wholeWire) : encodeMember(extract(signed.batch, 0));
    live(handle); return wire;
  } finally { discardBatch(signed.batch); }
}
// Typed cryptographic operations for the original protected Wallet approval
// branch only. No RPC, permission creation, generic raw signer or classic key.
// App must use its original pending review/WeakMap guard and lease, revalidate
// the current node snapshot, and assert the guard before and after these calls.
export function signPQWalletNativeTransfer(handle, transfer, snapshot) {
  const state = live(handle), plan = planPQNativeTransfer(snapshot, transfer), active = plan.policy.activeRecord;
  signingBinding(state, {chainId: plan.policy.chainId, owner: plan.policy.owner}, active.pkA, active.pkB);
  return preparePQTransferTransport(signOne(handle, state, encodePQNativeTransfer(plan.transfer), 'TX-BATCH', false));
}
export function createPQWalletMigrationPossession(handle, value) {
  const state = live(handle), intent = normalizePQRegistrationIntent(value);
  signingBinding(state, intent, intent.pkA, intent.pkB);
  // This new-pair proof is not current-account authorization or registration.
  return signOne(handle, state, encodePQRegistrationIntent(intent), 'ACCOUNT-MIGRATION', true);
}
export function signPQWalletCurrentMigration(handle, value, snapshot) {
  const state = live(handle), plan = planPQAccountMigration(snapshot, value), active = plan.policy.activeRecord;
  if (plan.policy.mode !== 'pq' || !active) throw pqError('PQ_ACTIVE_CURRENT_KEY_REQUIRED');
  signingBinding(state, {chainId: plan.policy.chainId, owner: plan.policy.owner}, active.pkA, active.pkB);
  return signOne(handle, state, encodePQRegistrationIntent(plan.intent), 'ACCOUNT-MIGRATION', false);
}

// Fixed typed account approval, using the original main-only review plan.
// No generic message signing callback and no classic account co-signature.
export function signPQWalletProductSessionApproval(handle, reviewPlan, at=new Date()) {
  const state=live(handle),plan=capturePQSessionSigningPlan(reviewPlan,at),a=plan.unsigned.accountAuthorization;
  signingBinding(state,{chainId:a.networkId,owner:a.canonicalOwner},a.pkA,a.pkB);
  const wire=signOne(handle,state,plan.message,plan.purpose,false);
  capturePQSessionSigningPlan(reviewPlan,at);live(handle);
  return Object.freeze({...plan.unsigned,walletProof:wire.toString('base64url')});
}

/** Original App review/keyAccess guards and current-policy fences remain mandatory
 * before and after this synchronous typed operation. No RPC or activation grant. */
export function signPQWalletAccountRevocation(handle, value, snapshot) {
  const state = live(handle), plan = planPQAccountRevocation(snapshot, value), active = plan.policy.activeRecord;
  signingBinding(state, {chainId: plan.policy.chainId, owner: plan.policy.owner}, active.pkA, active.pkB);
  const currentPQMember = signOne(handle, state, encodePQRevocationIntent(plan.intent), 'ACCOUNT-REVOCATION', false);
  live(handle);
  return preparePQRevocationTransport(encodePQRevocationRequest({intent: plan.intent, currentPQMember}));
}
