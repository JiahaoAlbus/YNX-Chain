import { canonicalJSON, exactFields, WalletAuthError } from './canonical.js';
import { parseProductSession } from './product-session-v2.js';
import { verifyProductSessionProofV2 } from './product-session-proof-v2.js';

const IDENTITY = ['operationId', 'sessionBinding', 'requestDigest', 'account', 'deviceBinding', 'productId'];
const REQUEST = ['method', 'path', 'bodyDigest'];
function fail(code) { throw new WalletAuthError(code, 'Original recovery authentication failed closed'); }
function synchronous(value) {
  if (value && typeof value.then === 'function') fail('ORIGINAL_READER_ASYNC');
  return value;
}
function detached(value) { return JSON.parse(canonicalJSON(value)); }
function sameIdentity(value, expected) {
  exactFields(value, IDENTITY, 'Original authenticated recovery identity');
  if (canonicalJSON(value) !== canonicalJSON(expected)) fail('ORIGINAL_READER_BINDING_MISMATCH');
}

// Local Store44 constructor adapter only. No HTTP route, proof format, role or
// enrollment is issued here. Fixed ports must be genuine protected producers.
// This existing proof protocol intentionally DOES NOT cover expired sessions.
export function createOriginalUnexpiredOperationReader(ports) {
  if (!ports || ['originalNow', 'assertRegisteredReaderCurrent', 'readOriginalRequestBinding', 'consumeOriginalReaderNonce'].some(name => typeof ports[name] !== 'function')) {
    fail('ORIGINAL_REGISTERED_READER_UNAVAILABLE');
  }
  const current = ports.assertRegisteredReaderCurrent;
  const binding = ports.readOriginalRequestBinding;
  const consume = ports.consumeOriginalReaderNonce;
  const clock = ports.originalNow;
  return (context, rawProof, at) => {
    if (!(at instanceof Date) || !Number.isFinite(at.getTime())) fail('INVALID_TIME');
    const now = new Date(at.getTime());
    const session = parseProductSession(detached(context.session));
    const fresh = (proof) => {
      const value = synchronous(clock());
      if (!(value instanceof Date) || !Number.isFinite(value.getTime()) || value.getTime() < now.getTime()) fail('ORIGINAL_READER_CLOCK_UNAVAILABLE');
      if (Date.parse(session.expiresAt) <= value.getTime()) fail('EXPIRED_RECOVERY_AUTHENTICATION_UNAVAILABLE');
      if (proof && Date.parse(proof.expiresAt) <= value.getTime()) fail('ORIGINAL_READER_PROOF_EXPIRED');
      return new Date(value.getTime());
    };
    const expected = detached(context.identity);
    exactFields(expected, IDENTITY, 'Original persisted recovery identity');
    if (expected.sessionBinding !== session.sessionBinding || expected.account !== session.account || expected.deviceBinding !== session.deviceBinding || expected.productId !== session.productId) {
      fail('ORIGINAL_READER_BINDING_MISMATCH');
    }
    // Never bypass the original verifier's Session expiry ceiling for recovery.
    if (Date.parse(session.expiresAt) <= now.getTime()) fail('EXPIRED_RECOVERY_AUTHENTICATION_UNAVAILABLE');
    const captured = Object.freeze({ identity: Object.freeze(expected), session });
    sameIdentity(synchronous(current(captured, new Date(now.getTime()))), expected);
    // The fixed transport's durable mapping must bind these three old record
    // identifiers to the complete ACTUAL read request. This is not the original
    // effect requestDigest and must not be derived by equating those digests.
    const original = detached(synchronous(binding(captured, rawProof, new Date(now.getTime()))));
    exactFields(original, ['identity', 'request'], 'Original recovery request binding');
    sameIdentity(original.identity, expected);
    exactFields(original.request, REQUEST, 'Original recovery request context');
    const proof = verifyProductSessionProofV2(rawProof, session, original.request, fresh());
    sameIdentity(synchronous(current(captured, new Date(now.getTime()))), expected);
    fresh(proof);
    // Must atomically consume/audit the READER proof nonce in the SAME original
    // writer transaction. Never consume the old business effect nonce here.
    // A boolean/echo is not eligible evidence: require the exact proof binding.
    const nonce = synchronous(consume(captured, proof, fresh(proof)));
    exactFields(nonce, ['identity', 'proofNonce', 'proofExpiresAt'], 'Original recovery nonce receipt');
    sameIdentity(nonce.identity, expected);
    if (nonce.proofNonce !== proof.nonce || nonce.proofExpiresAt !== proof.expiresAt) fail('ORIGINAL_READER_NONCE_MISMATCH');
    sameIdentity(synchronous(current(captured, new Date(now.getTime()))), expected);
    fresh(proof);
    return Object.freeze(detached(expected));
  };
}
