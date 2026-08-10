import { secp256k1 } from "@noble/curves/secp256k1.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import { canonicalJSON, digestHex, exactFields, WalletAuthError } from "./canonical.js";
import { walletIdentity, walletIdentityFromPublicKey } from "./crypto.js";

const INTENT_FIELDS = ["schemaVersion","intentId","sessionBinding","productClientId","bundleId","account","action","parametersDigest","evidence","trust","approval","ai","nonce","issuedAt","expiresAt","accountPublicKey","signature"];
const CREATE_FIELDS = ["accountSecret","schemaVersion","intentId","sessionBinding","productClientId","bundleId","account","action","parametersDigest","evidence","trust","approval","ai","nonce","issuedAt","expiresAt"];
const EVIDENCE_FIELDS = ["sourceClass","source","asOf","version","status","digest","confidenceBps","coverage"];
const TRUST_FIELDS = ["issuer","policy","decision","reasons"];
const APPROVAL_FIELDS = ["actor","mode","reviewedDigest"];
const AI_FIELDS = ["used","role","provider","model","outputDigest"];
const CONTEXT_FIELDS = ["sessionBinding","productClientId","bundleId","account","action","parametersDigest","revokedIntentDigests"];

export function createSignedIntent(input) {
  exactFields(input, CREATE_FIELDS, "Signed Intent creation input");
  const identity = walletIdentity(input.accountSecret);
  if (identity.account !== input.account) fail("ACCOUNT_MISMATCH", "Signed Intent account does not match the signing key");
  const { accountSecret, ...payload } = input;
  const unsigned = parseUnsigned({ ...payload, accountPublicKey: identity.accountPublicKey });
  const signature = bytesToHex(secp256k1.sign(sha256(utf8ToBytes(intentSignBytes(unsigned))), hexToBytes(accountSecret), { prehash:false, format:"compact", lowS:true }));
  return parseSignedIntent({ ...unsigned, signature });
}

export function parseSignedIntent(input) {
  exactFields(input, INTENT_FIELDS, "Signed Intent");
  const { signature, ...candidate } = input;
  const intent = { ...parseUnsigned(candidate), signature: pattern(signature,"signature",/^[0-9a-f]{128}$/) };
  let verified = false;
  try {
    verified = walletIdentityFromPublicKey(intent.accountPublicKey) === intent.account && secp256k1.verify(hexToBytes(intent.signature), sha256(utf8ToBytes(intentSignBytes(unsignedIntent(intent)))), hexToBytes(intent.accountPublicKey), { prehash:false, format:"compact", lowS:true });
  } catch { verified = false; }
  if (!verified) fail("INVALID_INTENT_SIGNATURE", "Signed Intent signature is invalid");
  return deepFreeze(intent);
}

export function signedIntentDigest(input) { return digestHex("YNX_SIGNED_INTENT_RECEIPT_V1", parseSignedIntent(input)); }
export function exportSignedIntent(input) { return canonicalJSON(parseSignedIntent(input)); }

export function assertSignedIntentActive(input, context, at = new Date()) {
  exactFields(context, CONTEXT_FIELDS, "Signed Intent execution context");
  const intent = parseSignedIntent(input);
  const expected = {
    sessionBinding:digest(context.sessionBinding,"sessionBinding"), productClientId:id(context.productClientId,"productClientId"),
    bundleId:pattern(context.bundleId,"bundleId",/^[A-Za-z][A-Za-z0-9.-]{2,127}$/), account:pattern(context.account,"account",/^ynx1[023456789acdefghjklmnpqrstuvwxyz]{38}$/),
    action:action(context.action), parametersDigest:digest(context.parametersDigest,"parametersDigest"),
  };
  for (const key of Object.keys(expected)) if (intent[key] !== expected[key]) fail("INTENT_BINDING_MISMATCH", `Signed Intent ${key} does not match execution context`);
  const revoked = list(context.revokedIntentDigests,"revokedIntentDigests",0,10000,value=>digest(value,"revoked intent digest"));
  if (revoked.includes(signedIntentDigest(intent))) fail("REVOKED", "Signed Intent was revoked");
  const now = validDate(at).toISOString();
  if (now < intent.issuedAt || now >= intent.expiresAt) fail("EXPIRED", "Signed Intent is not active");
  return intent;
}

function parseUnsigned(input) {
  exactFields(input, INTENT_FIELDS.filter(key=>key!=="signature"), "Unsigned Signed Intent");
  const evidence = parseEvidence(input.evidence), trust = parseTrust(input.trust), approval = parseApproval(input.approval), ai = parseAI(input.ai);
  const intent = {
    schemaVersion:exact(input.schemaVersion,"schemaVersion",1), intentId:id(input.intentId,"intentId"), sessionBinding:digest(input.sessionBinding,"sessionBinding"),
    productClientId:id(input.productClientId,"productClientId"), bundleId:pattern(input.bundleId,"bundleId",/^[A-Za-z][A-Za-z0-9.-]{2,127}$/),
    account:pattern(input.account,"account",/^ynx1[023456789acdefghjklmnpqrstuvwxyz]{38}$/), action:action(input.action), parametersDigest:digest(input.parametersDigest,"parametersDigest"),
    evidence, trust, approval, ai, nonce:pattern(input.nonce,"nonce",/^[A-Za-z0-9_-]{32,64}$/), issuedAt:time(input.issuedAt,"issuedAt"), expiresAt:time(input.expiresAt,"expiresAt"),
    accountPublicKey:pattern(input.accountPublicKey,"accountPublicKey",/^(02|03)[0-9a-f]{64}$/),
  };
  if (intent.expiresAt <= intent.issuedAt || Date.parse(intent.expiresAt)-Date.parse(intent.issuedAt)>300000) fail("INVALID_EXPIRY", "Signed Intent lifetime must be positive and at most five minutes");
  if (approval.reviewedDigest !== intent.parametersDigest) fail("REVIEW_MISMATCH", "Human approval must cover the exact parameter digest");
  return deepFreeze(intent);
}

function parseEvidence(input) {
  exactFields(input,EVIDENCE_FIELDS,"Signed Intent evidence");
  return Object.freeze({sourceClass:enumeration(input.sourceClass,"sourceClass",["ynx-authoritative","third-party","estimate","ai-inference","cache","user-input"]),source:https(input.source,"evidence source"),asOf:time(input.asOf,"evidence asOf"),version:text(input.version,"evidence version",1,64),status:enumeration(input.status,"evidence status",["available","unavailable","stale","failed"]),digest:digest(input.digest,"evidence digest"),confidenceBps:bounded(input.confidenceBps,"confidenceBps",0,10000),coverage:text(input.coverage,"coverage",1,200)});
}
function parseTrust(input) { exactFields(input,TRUST_FIELDS,"Signed Intent trust decision"); return Object.freeze({issuer:https(input.issuer,"trust issuer"),policy:https(input.policy,"trust policy"),decision:enumeration(input.decision,"trust decision",["allow","deny","review"]),reasons:list(input.reasons,"trust reasons",1,16,value=>text(value,"trust reason",1,160))}); }
function parseApproval(input) { exactFields(input,APPROVAL_FIELDS,"Signed Intent approval"); return Object.freeze({actor:enumeration(input.actor,"approval actor",["human"]),mode:enumeration(input.mode,"approval mode",["biometric","external-signer"]),reviewedDigest:digest(input.reviewedDigest,"reviewedDigest")}); }
function parseAI(input) { exactFields(input,AI_FIELDS,"Signed Intent AI boundary"); const used=bool(input.used,"AI used"), role=enumeration(input.role,"AI role",["none","explain-only"]); if (used !== (role==="explain-only")) fail("AI_BOUNDARY","AI use must be explain-only"); const provider=nullableText(input.provider,"AI provider"),model=nullableText(input.model,"AI model"),outputDigest=input.outputDigest===null?null:digest(input.outputDigest,"AI output digest"); if (used && (!provider||!model||!outputDigest)) fail("AI_BOUNDARY","AI explanation requires provider, model and output digest"); if (!used && (provider||model||outputDigest)) fail("AI_BOUNDARY","Unused AI cannot carry provider output"); return Object.freeze({used,role,provider,model,outputDigest}); }
function unsignedIntent(intent) { const {signature:_signature,...unsigned}=intent; return unsigned; }
function intentSignBytes(unsigned) { return `YNX_SIGNED_INTENT_V1\n${canonicalJSON(unsigned)}`; }
function deepFreeze(value) { return Object.freeze({...value,evidence:Object.freeze(value.evidence),trust:Object.freeze({...value.trust,reasons:Object.freeze([...value.trust.reasons])}),approval:Object.freeze(value.approval),ai:Object.freeze(value.ai)}); }
function action(value) { return enumeration(value,"action",["user-operation","native-transfer","strategy-mandate","capital-enter","capital-exit","credential-present","revoke"]); }
function list(value,label,min,max,parser) { if(!Array.isArray(value)||value.length<min||value.length>max)fail("INVALID_FIELD",`${label} has an invalid item count`); const parsed=value.map(parser); if(new Set(parsed).size!==parsed.length||[...parsed].sort().join("\n")!==parsed.join("\n"))fail("INVALID_FIELD",`${label} must be unique and sorted`); return Object.freeze(parsed); }
function id(value,label){return pattern(value,label,/^[a-z][a-z0-9._-]{2,63}$/)}
function digest(value,label){return pattern(value,label,/^[0-9a-f]{64}$/)}
function pattern(value,label,regex){const result=text(value,label,1,512);if(!regex.test(result))fail("INVALID_FIELD",`${label} is invalid`);return result}
function text(value,label,min,max){if(typeof value!=="string"||value.length<min||value.length>max||value.trim()!==value)fail("INVALID_FIELD",`${label} is invalid`);return value}
function nullableText(value,label){if(value===null)return null;return text(value,label,1,128)}
function time(value,label){const result=pattern(value,label,/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);if(!Number.isFinite(Date.parse(result))||new Date(result).toISOString()!==result)fail("INVALID_TIME",`${label} is invalid`);return result}
function https(value,label){const result=text(value,label,1,512);let parsed;try{parsed=new URL(result)}catch{fail("INVALID_URL",`${label} is invalid`)}if(parsed.protocol!=="https:"||parsed.username||parsed.password||parsed.hash||parsed.toString()!==result)fail("INVALID_URL",`${label} must be a canonical HTTPS URL`);return result}
function bounded(value,label,min,max){if(!Number.isSafeInteger(value)||value<min||value>max)fail("INVALID_NUMBER",`${label} is outside its allowed range`);return value}
function exact(value,label,expected){return bounded(value,label,expected,expected)}
function bool(value,label){if(typeof value!=="boolean")fail("INVALID_FIELD",`${label} must be boolean`);return value}
function enumeration(value,label,values){if(!values.includes(value))fail("INVALID_FIELD",`${label} is unsupported`);return value}
function validDate(value){if(!(value instanceof Date)||!Number.isFinite(value.getTime()))fail("INVALID_TIME","Signed Intent verification time is invalid");return value}
function fail(code,message){throw new WalletAuthError(code,message)}
