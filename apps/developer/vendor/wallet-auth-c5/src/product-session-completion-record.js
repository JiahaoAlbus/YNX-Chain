import { p256 } from "@noble/curves/nist.js";
import { canonicalJSON, exactFields, WalletAuthError } from "./canonical.js";
import { decodeBase64url } from "./base64url.js";
import { createProductSessionChallenge, parseProductSessionApproval, parseProductSessionChallenge, parseProductSessionRequest, ProductSessionAuthority } from "./product-session-v2.js";

export function parseCompletionRecord(registry, raw, at) {
  if (typeof raw !== "string" || raw.length > 16_384) fail("INVALID_SESSION_STORE", "Protected completion record is invalid");
  let value;
  try { value = JSON.parse(raw); } catch { fail("INVALID_SESSION_STORE", "Protected completion record is not valid JSON"); }
  exactFields(value, ["request", "approval", "completion"], "Protected Product Session completion");
  const request = parseProductSessionRequest(registry, value.request, at);
  const approval = parseProductSessionApproval(registry, request, value.approval, at);
  exactFields(value.completion, ["challenge", "deviceSignature"], "Protected Product Session device completion");
  const challenge = parseProductSessionChallenge(value.completion.challenge);
  const expected = createProductSessionChallenge(registry, request, approval, { challenge: challenge.challenge }, new Date(challenge.issuedAt));
  if (canonicalJSON(challenge) !== canonicalJSON(expected)) fail("SESSION_BINDING_MISMATCH", "Protected completion challenge changed");
  let valid = false;
  try { valid = p256.verify(decodeBase64url(value.completion.deviceSignature, "deviceSignature"), new TextEncoder().encode(`YNX_PRODUCT_SESSION_CHALLENGE_V2\n${canonicalJSON(challenge)}`), decodeBase64url(challenge.deviceKey, "deviceKey"), { format: "der", lowS: false }); } catch { valid = false; }
  if (!valid) fail("INVALID_DEVICE_PROOF", "Protected completion signature is invalid");
  return Object.freeze({ request, approval, completion: Object.freeze({ challenge, deviceSignature: value.completion.deviceSignature }) });
}

export function deriveCompletionTarget(registry, raw) {
  let value;
  try { value = JSON.parse(raw); } catch { fail("INVALID_SESSION_STORE", "Protected completion record is not valid JSON"); }
  const at = new Date(value?.completion?.challenge?.issuedAt);
  const record = parseCompletionRecord(registry, raw, at);
  // Reuse the exact authority implementation in isolated memory. This verifies
  // the original signed completion and determines only its possible target;
  // it neither contacts Auth nor claims that Auth ever committed the session.
  const verifier = new ProductSessionAuthority(registry);
  verifier.issueChallenge({ request: record.request, approval: record.approval, challenge: record.completion.challenge.challenge }, at);
  return verifier.complete(record, at);
}
function fail(code, message) { throw new WalletAuthError(code, message); }
