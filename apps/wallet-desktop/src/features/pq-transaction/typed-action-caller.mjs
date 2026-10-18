import {createHash} from 'node:crypto';
import {types} from 'node:util';
import {encodePQNativeAction} from '@ynx-chain/wallet-auth/pq-native-action';
import {assertPQAuthorizationCurrent, planPQNativeAction} from '@ynx-chain/wallet-auth/pq-wallet-policy';
import {signPQWalletNativeAction} from '@ynx-chain/wallet-auth/pq-wallet-key-backup';
import {verifyPQRegisteredMemberData} from '@ynx-chain/wallet-auth/pq-registered-member';

// Main-only SDK331 consumer. These WeakMap entries correlate immutable DATA;
// they are NOT the original pending review, consent, permission or journal.
const reviews = new WeakMap();
const reviewFields = ['operationId','account','networkId','origin','action','requestDigest','policyRevision','executionHeight','pair','createdAt','expiresAt','dataOnly','permissionGranted'];
const fail = code => {throw Object.assign(new Error(code), {code});};
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype);
const bufferOf = Object.getOwnPropertyDescriptor(typedArrayPrototype, 'buffer').get;
const lengthOf = Object.getOwnPropertyDescriptor(typedArrayPrototype, 'length').get;
const offsetOf = Object.getOwnPropertyDescriptor(typedArrayPrototype, 'byteOffset').get;
const resizableBuffer = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'resizable').get;
const detachedBuffer = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'detached').get;
function exact(value, fields) {
  if (!value || typeof value !== 'object' || types.isProxy(value) || Object.getPrototypeOf(value) !== Object.prototype) fail('PQ_TYPED_ACTION_BINDING_INVALID');
  const descriptors = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(descriptors);
  if (keys.length !== fields.length || keys.some(key => !fields.includes(key) || !descriptors[key].enumerable || !Object.hasOwn(descriptors[key], 'value'))) fail('PQ_TYPED_ACTION_BINDING_INVALID');
  return Object.fromEntries(fields.map(key => [key, descriptors[key].value]));
}
function binding(value) {
  const result = exact(value, ['account', 'networkId']);
  if (typeof result.account !== 'string' || !/^0x[0-9a-f]{40}$/.test(result.account) || typeof result.networkId !== 'string' || !/^[0-9a-f]{64}$/.test(result.networkId)) fail('PQ_TYPED_ACTION_BINDING_INVALID');
  return Object.freeze(result);
}
function timestamp(value) {
  if (typeof value !== 'string' || value.length !== 24 || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) fail('PQ_TYPED_ACTION_REVIEW_TIME_INVALID');
  return value;
}
function state(review) {
  const entry = reviews.get(review);
  if (!entry) fail('PQ_TYPED_ACTION_ORIGINAL_REVIEW_REQUIRED');
  return entry;
}
function matches(plan, selected) {
  if (plan.action.owner !== selected.account || plan.action.chainId !== selected.networkId || plan.action.nativeChainId !== '6423') fail('PQ_TYPED_ACTION_BINDING_MISMATCH');
}
function sameData(actual, expected) {
  if (!expected || typeof expected !== 'object') {
    if (actual !== expected) fail('PQ_TYPED_ACTION_BINDING_MISMATCH');
    return;
  }
  if (!actual || typeof actual !== 'object' || types.isProxy(actual) || Object.getPrototypeOf(actual) !== Object.getPrototypeOf(expected)) fail('PQ_TYPED_ACTION_BINDING_INVALID');
  const a = Object.getOwnPropertyDescriptors(actual), e = Object.getOwnPropertyDescriptors(expected), keys = Reflect.ownKeys(e);
  if (Reflect.ownKeys(a).length !== keys.length) fail('PQ_TYPED_ACTION_BINDING_INVALID');
  for (const key of keys) {
    if (!Object.hasOwn(a, key) || !Object.hasOwn(a[key], 'value') || a[key].enumerable !== e[key].enumerable) fail('PQ_TYPED_ACTION_BINDING_INVALID');
    sameData(a[key].value, e[key].value);
  }
}
function memberBytes(value) {
  if (types.isProxy(value) || !types.isUint8Array(value)) fail('PQ_TYPED_ACTION_MEMBER_INVALID');
  const buffer = bufferOf.call(value), length = lengthOf.call(value), offset = offsetOf.call(value);
  if (types.isSharedArrayBuffer(buffer) || resizableBuffer.call(buffer) || detachedBuffer.call(buffer) || !length || length > 8 * 1024 * 1024) fail('PQ_TYPED_ACTION_MEMBER_INVALID');
  const keys = Reflect.ownKeys(value);
  if (keys.length !== length || keys.some((key, i) => key !== String(i))) fail('PQ_TYPED_ACTION_MEMBER_INVALID');
  return Buffer.from(new Uint8Array(buffer, offset, length));
}

// Pure construction shared by live preparation and archived DATA validation.
// Only preparePQTypedActionReview adds process-local caller state.
function reviewData(snapshot, input, metadata) {
  const meta = exact(metadata, ['operationId', 'account', 'networkId', 'createdAt', 'expiresAt']);
  const selected = binding({account:meta.account, networkId:meta.networkId});
  if (typeof meta.operationId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(meta.operationId)) fail('PQ_TYPED_ACTION_REVIEW_ID_INVALID');
  const createdAt = timestamp(meta.createdAt), expiresAt = timestamp(meta.expiresAt);
  if (createdAt >= expiresAt) fail('PQ_TYPED_ACTION_REVIEW_TIME_INVALID');
  const plan = planPQNativeAction(snapshot, input);
  matches(plan, selected);
  const active = plan.policy.activeRecord;
  return Object.freeze({operationId:meta.operationId, account:selected.account, networkId:selected.networkId,
    origin:'ynx-wallet:local-pq', action:plan.action, requestDigest:digest(encodePQNativeAction(plan.action)),
    policyRevision:plan.policy.policyRevision, executionHeight:plan.policy.executionHeight,
    pair:Object.freeze({pkA:active.pkA, pkB:active.pkB}), createdAt, expiresAt, dataOnly:true, permissionGranted:false});
}

/** Build exact typed signing DATA from an original authenticated snapshot.
 * SDK331 checks all 16 payloads, current pair, nonce and real executor fees.
 * Original Main owns the request ID, user review and trustworthy source. */
export function preparePQTypedActionReview(snapshot, input, metadata) {
  const review = reviewData(snapshot, input, metadata);
  reviews.set(review, {snapshot, signingSnapshot:null, entered:false});
  return review;
}

function archivedReview(value, options) {
  const original = exact(options, ['reviewSnapshot','signingSnapshot','selectedBinding']);
  const selected = binding(original.selectedBinding), saved = exact(value, reviewFields);
  if (saved.account !== selected.account || saved.networkId !== selected.networkId) fail('PQ_TYPED_ACTION_BINDING_MISMATCH');
  // Both are original Main-retained, SDK-branded snapshots; never parse an
  // untrusted snapshot DTO here or substitute a latest/consumed nonce view.
  assertPQAuthorizationCurrent(original.reviewSnapshot, original.signingSnapshot);
  const review = reviewData(original.reviewSnapshot, saved.action, {operationId:saved.operationId,
    account:saved.account, networkId:saved.networkId, createdAt:saved.createdAt, expiresAt:saved.expiresAt});
  sameData(saved, review);
  return {review, snapshot:original.signingSnapshot};
}

/** Recheck DATA inside Main's actual pending-review/keyAccess/current lease.
 * No boolean here is permission and this call does not acquire custody. */
export function recheckPQTypedActionReview(review, refreshed, selectedBinding, at = Date.now()) {
  const entry = state(review), selected = binding(selectedBinding);
  if (selected.account !== review.account || selected.networkId !== review.networkId) fail('PQ_TYPED_ACTION_BINDING_MISMATCH');
  if (!Number.isSafeInteger(at) || at < Date.parse(review.createdAt) || at >= Date.parse(review.expiresAt)) fail('PQ_TYPED_ACTION_REVIEW_EXPIRED');
  assertPQAuthorizationCurrent(entry.snapshot, refreshed);
  const plan = planPQNativeAction(refreshed, review.action);
  matches(plan, selected);
  if (plan.policy.policyRevision !== review.policyRevision || plan.policy.activeRecord.pkA !== review.pair.pkA || plan.policy.activeRecord.pkB !== review.pair.pkB || digest(encodePQNativeAction(plan.action)) !== review.requestDigest) fail('PQ_TYPED_ACTION_BINDING_MISMATCH');
  return plan;
}

/** Actual normal SDK caller, synchronous and typed; never an injected signer.
 * ONLY call from Main's original approved withPQKeys callback, after its
 * durable reservation and guard.assert(). Immediately capture the returned raw
 * bytes in Main's original custody BEFORE any late-lock/current/result checks.
 * Main must then assert its guard and finish original permission/cleanup.
 * There is deliberately no post-sign guard that could discard returned bytes.
 * An entered call is never reset by an exception, timeout or UI cancellation. */
export function signPQReviewedTypedAction(review, refreshed, handle, selectedBinding, at = Date.now()) {
  const entry = state(review);
  if (entry.entered) fail('PQ_TYPED_ACTION_SIGNER_ALREADY_ENTERED');
  const plan = recheckPQTypedActionReview(review, refreshed, selectedBinding, at);
  entry.signingSnapshot = refreshed;
  entry.entered = true;
  return signPQWalletNativeAction(handle, plan.action, refreshed);
}

export function pqTypedActionInvocationData(review) {
  const entry = state(review);
  return Object.freeze({operationId:review.operationId, signerEntered:entry.entered, dataOnly:true, canRetry:false});
}

/** Inspect an already captured original. This is math/binding DATA, allowed
 * after the view expires. It neither re-signs nor authenticates fresh Source,
 * approves a broadcast, persists an original or proves BFT finality.
 * For a JSON-restored review, explicitly supply both original public snapshots
 * and selected binding. This never registers a new live review. Operation ID
 * and timestamps remain Main's retained metadata, not Member-signed claims. */
export function inspectPQTypedActionMember(review, value, original) {
  let snapshot;
  if (original === undefined) {
    const entry = state(review);snapshot = entry.signingSnapshot ?? entry.snapshot;
  } else {
    ({review, snapshot} = archivedReview(review, original));
  }
  const wire = memberBytes(value), plan = planPQNativeAction(snapshot, review.action);
  const verified = verifyPQRegisteredMemberData(snapshot, wire, {chainId:review.networkId, owner:review.account,
    keyVersion:review.policyRevision, executionHeight:plan.policy.executionHeight, purpose:'TX-BATCH', message:encodePQNativeAction(plan.action)});
  if (verified.memberCount !== 1 || verified.memberIndex !== 0) fail('PQ_TYPED_ACTION_MEMBER_COORDINATES_INVALID');
  return Object.freeze({operationId:review.operationId, account:review.account, networkId:review.networkId,
    action:plan.action, pair:review.pair, policyRevision:review.policyRevision, executionHeight:verified.executionHeight,
    requestDigest:review.requestDigest, memberHash:'0x' + digest(wire), purpose:'TX-BATCH', memberCount:1, memberIndex:0,
    signatureVerified:true, dataOnly:true, nativeAdmission:false, submitted:false, canRetry:false, clearsOriginal:false, consensusFinality:false});
}
