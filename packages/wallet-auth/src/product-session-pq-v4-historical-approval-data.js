// Historical original DATA. The Node and fixed private callers supply their
// existing verification-only N1 primitive. No policyRef or authority is created.
import { canonicalJSON, WalletAuthError } from './canonical.js';
import { pqDecodeBase64url } from './pq-wallet-contract.js';
import { parseSessionAccountAuthorization } from './product-session-account-private.js';
import { parseProductSessionRequest, productSessionApprovalDigest, productSessionRequestDigest } from './product-session-v2.js';
import {
  encodeOriginalProductSessionV4E5DATA,
  originalV4RegistrationForRequestDATA,
  PRODUCT_SESSION_APPROVAL_DOMAIN_V4,
} from './product-session-pq-v4-message-data.js';

export const HISTORICAL_APPROVAL_FIELDS = Object.freeze([
  'requestOriginal', 'approvalOriginal', 'registrationOriginal', 'checkedAtMs',
]);
const encoder = new TextEncoder();
const unpairedSurrogate = /[\uD800-\uDFFF]/u;
const invalidOriginal = 'PQ_STORED_V4_ISSUE_ORIGINAL_INVALID';
const fail = code => { throw new WalletAuthError(code, code); };

function assertBoundedJSON(value, depth = 0) {
  if (depth > 16) fail(invalidOriginal);
  if (typeof value === 'string' && unpairedSurrogate.test(value)) fail(invalidOriginal);
  if (value && typeof value === 'object') {
    if (Array.isArray(value) ? value.length > 1024 : Object.keys(value).length > 128) {
      fail(invalidOriginal);
    }
    for (const field of Object.values(value)) assertBoundedJSON(field, depth + 1);
  }
}

export function storedIssueRaw(raw, max) {
  if (typeof raw !== 'string' || !raw.length || raw.length > max ||
      unpairedSurrogate.test(raw) || encoder.encode(raw).length > max) fail(invalidOriginal);
  try {
    const value = JSON.parse(raw);
    assertBoundedJSON(value);
    if (canonicalJSON(value) !== raw) fail(invalidOriginal);
    return value;
  } catch {
    fail(invalidOriginal);
  }
}

export function storedIssueTime(ms) {
  if (!Number.isSafeInteger(ms) || ms < 0 || !Number.isFinite(+new Date(ms))) {
    fail('PQ_STORED_V4_ISSUE_COMMIT_TIME_INVALID');
  }
  return new Date(ms);
}

export function storedIssueApproval(verifyMember, registry,requestInput,approval,registrationOriginal,committedAt){
 const proofAt=new Date(approval?.issuedAt);if(!Number.isFinite(+proofAt)||+proofAt>+committedAt)fail('INVALID_APPROVAL_TIME');
 const r=parseProductSessionRequest(registry,requestInput,proofAt);if(r.version!=='4')fail('PQ_SESSION_V4_REQUIRED');
 const authorization=parseSessionAccountAuthorization(approval.accountAuthorization,approval.account),registration=originalV4RegistrationForRequestDATA(r,registrationOriginal,approval.account,proofAt);
 // Reconstruct the SAME original unsigned approval and E5. Authorization is
 // the signed original DATA, never a manufactured historical policyRef/view.
 if(authorization.networkId!==registration.networkId||authorization.canonicalOwner!==registration.canonicalOwner||typeof approval.expiresAt!=='string'||new Date(approval.expiresAt).toISOString()!==approval.expiresAt||approval.expiresAt<=proofAt.toISOString()||approval.expiresAt>r.expiresAt||approval.expiresAt>registration.expiresAt)fail('INVALID_APPROVAL_TIME');
 const {purpose,issuedAt,expiresAt,...bound}=r,unsigned=Object.freeze({...bound,version:'4',result:'approved',requestDigest:productSessionRequestDigest(registry,r,proofAt),account:approval.account,accountAuthorization:authorization,issuedAt:proofAt.toISOString(),expiresAt:approval.expiresAt});
 const value=Object.freeze({...unsigned,walletProof:approval.walletProof});if(canonicalJSON(value)!==canonicalJSON(approval)||approval.expiresAt<=committedAt.toISOString())fail('SESSION_BINDING_MISMATCH');
 // The original issuer also required the request/record to be alive at its
 // actual commit fence. This is not a fresh observation at today's clock.
 parseProductSessionRequest(registry,r,committedAt);originalV4RegistrationForRequestDATA(r,registrationOriginal,approval.account,committedAt);
 verifyMember(pqDecodeBase64url(approval.walletProof,{max:98304}),authorization.networkId,authorization.canonicalOwner,'PRODUCT-SESSION-APPROVAL',encodeOriginalProductSessionV4E5DATA(PRODUCT_SESSION_APPROVAL_DOMAIN_V4,authorization.networkId,authorization.canonicalOwner,{request:r,approval:unsigned}),authorization.pkA,authorization.pkB);
 return Object.freeze({request:r,approval:value,authorization});
}

export function inspectHistoricalApprovalDATA(verifyMember, registry, originals) {
  const checkedAt = storedIssueTime(originals.checkedAtMs);
  const request = storedIssueRaw(originals.requestOriginal, 16384);
  const approval = storedIssueRaw(originals.approvalOriginal, 196608);
  storedIssueRaw(originals.registrationOriginal, 16384);
  const verified = storedIssueApproval(
    verifyMember, registry, request, approval, encoder.encode(originals.registrationOriginal), checkedAt,
  );
  return Object.freeze({
    originals,
    request: verified.request,
    approval: verified.approval,
    accountAuthorization: verified.authorization,
    requestDigest: verified.approval.requestDigest,
    approvalDigest: productSessionApprovalDigest(verified.approval),
    signatureVerified: true,
    dataOnly: true,
    authorized: false,
    registered: false,
    current: false,
    SourceAdmission: false,
    RootAdmission: false,
    NativeAdmission: false,
  });
}
