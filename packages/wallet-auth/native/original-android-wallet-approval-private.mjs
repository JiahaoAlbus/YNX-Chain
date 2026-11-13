import registry from '../product-session-registry.json' with { type: 'json' };
import { canonicalJSON, WalletAuthError } from '../src/canonical.js';
import { exactPQRecord } from '../src/pq-wallet-contract.js';
import { captureProductSessionAccountPolicy } from '../src/product-session-account-policy.js';
import { originalV4PrivateVerificationDATA as math } from '../src/product-session-pq-v4-verification-private.mjs';
import { SourceUTF8Encoder } from './original-source-private-utf8.mjs';

const utf8 = new SourceUTF8Encoder();
const methods = ['isOriginalApprovalOwner', 'assertOriginalApprovalCurrent',
  'readOriginalApprovalReviewDATA', 'readOriginalApprovalPolicyDATA'];
const fail = code => { throw new WalletAuthError(code, code); };

function original(raw, limit) {
  if (typeof raw !== 'string' || raw.length > limit || utf8.encode(raw).length > limit) {
    fail('ANDROID_APPROVAL_ORIGINAL_REQUIRED');
  }
  const value = JSON.parse(raw);
  if (canonicalJSON(value) !== raw) fail('ANDROID_APPROVAL_ORIGINAL_REQUIRED');
  return value;
}

// Only the fixed Wallet host receives this closure. Its Native actor owns
// review selection, signing, and durable state.
export default function originalAndroidWalletApprovalPrivate(nativeHost) {
  if (arguments.length !== 1 || !nativeHost) fail('ANDROID_APPROVAL_HOST_REQUIRED');
  const ports = Object.create(null);
  for (const method of methods) {
    const port = Object.getOwnPropertyDescriptor(nativeHost, method)?.value;
    if (typeof port !== 'function') fail('ANDROID_APPROVAL_HOST_REQUIRED');
    ports[method] = port;
  }
  const call = (method, ...args) => Reflect.apply(ports[method], nativeHost, args);
  const plans = new WeakMap();
  const selectedOwners = new WeakSet();

  function assertCurrent(owner) {
    if (call('isOriginalApprovalOwner', owner) !== true ||
        call('assertOriginalApprovalCurrent', owner) !== undefined) {
      fail('ANDROID_APPROVAL_OWNER_NOT_CURRENT');
    }
  }
  function planFor(ref) {
    const plan = plans.get(ref);
    if (!plan) fail('ANDROID_APPROVAL_PLAN_REQUIRED');
    assertCurrent(plan.owner);
    return plan;
  }
  function borrowedOnly() {
    fail('ANDROID_APPROVAL_POLICY_BORROWED');
  }

  return Object.freeze({
    prepare(owner) {
      if (arguments.length !== 1 || !owner || typeof owner !== 'object') fail('ANDROID_APPROVAL_OWNER_REQUIRED');
      assertCurrent(owner);
      if (selectedOwners.has(owner)) fail('ANDROID_APPROVAL_OWNER_ALREADY_SELECTED');
      selectedOwners.add(owner);
      const review = exactPQRecord(call('readOriginalApprovalReviewDATA', owner),
        ['requestOriginal', 'registrationOriginal', 'account', 'expiresAt']);
      const { requestOriginal, registrationOriginal, account, expiresAt } = review;
      const request = original(requestOriginal, 16384);
      if (request.platform !== 'android' || request.version !== '4') fail('ANDROID_APPROVAL_REQUEST_REQUIRED');
      const registration = original(registrationOriginal, 16384);
      const at = new Date();
      const policy = captureProductSessionAccountPolicy({
        assertCurrent: () => assertCurrent(owner),
        readOriginal: () => original(call('readOriginalApprovalPolicyDATA', owner), 196608),
        recheck: borrowedOnly, retire: borrowedOnly, join: borrowedOnly, close: borrowedOnly,
      }, { networkId: registration.networkId, account }, at);
      const internal = math.prepareOriginalProductSessionV4NativeApprovalPlan(
        registry, request, { account, expiresAt }, policy, utf8.encode(registrationOriginal), at);
      assertCurrent(owner);
      const ref = Object.freeze({});
      plans.set(ref, { owner, internal });
      return ref;
    },
    read(ref) {
      if (arguments.length !== 1) fail('ANDROID_APPROVAL_PLAN_REQUIRED');
      const plan = planFor(ref);
      return math.readOriginalProductSessionV4NativeApprovalPlanDATA(plan.internal, new Date());
    },
    attach(ref, member) {
      if (arguments.length !== 2) fail('ANDROID_APPROVAL_PLAN_REQUIRED');
      const plan = planFor(ref);
      const result = math.attachOriginalProductSessionV4NativeApprovalMemberDATA(plan.internal, member, new Date());
      math.readOriginalProductSessionV4NativeApprovalPlanDATA(plan.internal, new Date());
      return result;
    },
  });
}
