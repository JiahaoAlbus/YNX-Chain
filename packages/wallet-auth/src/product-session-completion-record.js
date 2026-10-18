import { p256 } from "@noble/curves/nist.js";
import { canonicalJSON, exactFields, WalletAuthError } from "./canonical.js";
import { decodeBase64url } from "./base64url.js";
import { createProductSessionChallenge, parseProductSessionApproval, parseProductSessionChallenge, parseProductSessionRequest, ProductSessionAuthority,createProductSessionCompletionChallenge,deriveProductSessionCompletionTarget } from "./product-session-v2.js";
import {captureVerifiedPQCompletion} from './product-session-account-private.js';
import {assertProductSessionRecordBudget} from './product-session-record-budget.js';
import {inspectReferenceCompletion,REFERENCE_COMPLETION_VERSION} from './product-session-reference-completion.js';

/** Pending-data inspection only, for protected storage binding. The V3 account
 * proof is NOT verified here and this result must never authorize a session. */
export function inspectCompletionRecord(registry,raw){
 assertProductSessionRecordBudget(':completion',raw);
 let value;try{value=JSON.parse(raw);}catch{fail('INVALID_SESSION_STORE','Completion is not JSON');}
 if(value.version===REFERENCE_COMPLETION_VERSION)return inspectReferenceCompletion(registry,raw);
 exactFields(value,['request','approval','completion'],'Protected completion');
 if(value.approval?.version!=='3')return Object.freeze({...parseCompletionRecord(registry,raw,new Date(value.completion?.challenge?.issuedAt)),accountVerified:true});
 const challenge=parseProductSessionChallenge(value.completion?.challenge),request=parseProductSessionRequest(registry,value.request,new Date(challenge.issuedAt));
 exactFields(value.completion,['challenge','deviceSignature'],'Completion device proof');
 if(typeof value.completion.deviceSignature!=='string'||value.completion.deviceSignature.length>256)fail('INVALID_DEVICE_PROOF','Completion device proof is invalid');
 return Object.freeze({request,approval:value.approval,completion:Object.freeze({challenge,deviceSignature:value.completion.deviceSignature}),accountVerified:false});
}

export function parseCompletionRecord(registry, raw, at,verifiedApproval=null,verifiedCompletion=null) {
  if (typeof raw !== "string" || new TextEncoder().encode(raw).length > 196608) fail("INVALID_SESSION_STORE", "Protected completion record is invalid");
  let value;
  try { value = JSON.parse(raw); } catch { fail("INVALID_SESSION_STORE", "Protected completion record is not valid JSON"); }
  exactFields(value, ["request", "approval", "completion"], "Protected Product Session completion");
  const pq=value.approval?.version==='3';
  if(!pq&&raw.length>16384)fail('INVALID_SESSION_STORE','Legacy completion exceeds its original budget');
  const historical=pq&&verifiedCompletion!==null;
  const request = parseProductSessionRequest(registry, value.request, historical?new Date(value.completion?.challenge?.issuedAt):at);
  const approval = historical?captureVerifiedPQCompletion(verifiedCompletion,raw,at).approval:parseProductSessionApproval(registry, request, value.approval, at,verifiedApproval);
  exactFields(value.completion, ["challenge", "deviceSignature"], "Protected Product Session device completion");
  const challenge = parseProductSessionChallenge(value.completion.challenge);
  const expected = historical?createProductSessionCompletionChallenge(registry,raw,verifiedCompletion,at):createProductSessionChallenge(registry, request, approval, { challenge: challenge.challenge }, new Date(challenge.issuedAt),verifiedApproval,at);
  if (canonicalJSON(challenge) !== canonicalJSON(expected)) fail("SESSION_BINDING_MISMATCH", "Protected completion challenge changed");
  let valid = false;
  try { valid = p256.verify(decodeBase64url(value.completion.deviceSignature, "deviceSignature"), new TextEncoder().encode(`YNX_PRODUCT_SESSION_CHALLENGE_V2\n${canonicalJSON(challenge)}`), decodeBase64url(challenge.deviceKey, "deviceKey"), { format: "der", lowS: false }); } catch { valid = false; }
  if (!valid) fail("INVALID_DEVICE_PROOF", "Protected completion signature is invalid");
  return Object.freeze({ request, approval, completion: Object.freeze({ challenge, deviceSignature: value.completion.deviceSignature }) });
}

export function deriveCompletionTarget(registry, raw,atCurrent=new Date(),verifiedCompletion=null) {
  let value;
  try { value = JSON.parse(raw); } catch { fail("INVALID_SESSION_STORE", "Protected completion record is not valid JSON"); }
  if(value.approval?.version==='3'){
    parseCompletionRecord(registry,raw,atCurrent,null,verifiedCompletion);
    return deriveProductSessionCompletionTarget(registry,raw,verifiedCompletion,atCurrent);
  }
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
