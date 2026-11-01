import { exactFields, digestHex, WalletAuthError } from "./canonical.js";

const FIELDS = ["schemaVersion", "credentialId", "type", "issuer", "subjectBinding", "claim", "issuedAt", "expiresAt", "status", "proofDigest", "auditId", "source", "asOf", "version"];
const CLAIM_FIELDS = ["kind", "value"];
const STATUS_FIELDS = ["type", "url", "index"];
const ALLOWED = Object.freeze({
  "age-eligibility": ["eligible", "not-eligible"], "region-eligibility": ["eligible", "not-eligible"],
  merchant: ["verified", "not-verified"], institution: ["verified", "not-verified"],
  "kyc-completed-reference": ["completed", "not-completed"], "professional-classification-reference": ["accredited", "professional", "not-classified"],
});

export function parseCredentialCandidate(input, at = new Date()) {
  exactFields(input, FIELDS, "Selective disclosure credential candidate");
  exactFields(input.claim, CLAIM_FIELDS, "Credential claim");
  exactFields(input.status, STATUS_FIELDS, "Credential status");
  const type = enumeration(input.type, "type", Object.keys(ALLOWED));
  const credential = {
    schemaVersion: exact(input.schemaVersion, "schemaVersion", 1), credentialId: uri(input.credentialId, "credentialId"), type,
    issuer: https(input.issuer, "issuer"), subjectBinding: digest(input.subjectBinding, "subjectBinding"),
    claim: Object.freeze({ kind: type, value: enumeration(input.claim.value, "claim value", ALLOWED[type]) }),
    issuedAt: time(input.issuedAt, "issuedAt"), expiresAt: time(input.expiresAt, "expiresAt"),
    status: Object.freeze({ type: enumeration(input.status.type, "status type", ["BitstringStatusListEntry"]), url: https(input.status.url, "status URL"), index: bounded(input.status.index, "status index", 0, 131071) }),
    proofDigest: digest(input.proofDigest, "proofDigest"), auditId: digest(input.auditId, "auditId"), source: https(input.source, "source"),
    asOf: time(input.asOf, "asOf"), version: text(input.version, "version", 1, 64),
  };
  if (credential.claim.kind !== credential.type) fail("CLAIM_MISMATCH", "Credential claim does not match its declared type");
  if (credential.expiresAt <= credential.issuedAt) fail("INVALID_EXPIRY", "Credential expiry must follow issuance");
  const now = validDate(at).toISOString();
  if (now < credential.issuedAt || now >= credential.expiresAt) fail("INACTIVE_CREDENTIAL", "Credential is not active at verification time");
  return Object.freeze(credential);
}

export function credentialCandidateDigest(input, at = new Date()) { return digestHex("YNX_SELECTIVE_DISCLOSURE_CREDENTIAL_V1", parseCredentialCandidate(input, at)); }

function uri(value, label) { const result = text(value, label, 1, 512); let parsed; try { parsed = new URL(result); } catch { fail("INVALID_URL", `${label} is invalid`); } if (!parsed.protocol || parsed.username || parsed.password || parsed.hash || parsed.toString() !== result) fail("INVALID_URL", `${label} must be canonical`); return result; }
function https(value, label) { const result = uri(value, label); if (!result.startsWith("https://")) fail("INVALID_URL", `${label} must use HTTPS`); return result; }
function digest(value, label) { return pattern(value, label, /^[0-9a-f]{64}$/); }
function pattern(value, label, regex) { const result = text(value, label, 1, 512); if (!regex.test(result)) fail("INVALID_FIELD", `${label} is invalid`); return result; }
function text(value, label, min, max) { if (typeof value !== "string" || value.length < min || value.length > max || value.trim() !== value) fail("INVALID_FIELD", `${label} is invalid`); return value; }
function time(value, label) { const result = pattern(value, label, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/); if (!Number.isFinite(Date.parse(result)) || new Date(result).toISOString() !== result) fail("INVALID_TIME", `${label} is invalid`); return result; }
function bounded(value, label, min, max) { if (!Number.isSafeInteger(value) || value < min || value > max) fail("INVALID_NUMBER", `${label} is outside its allowed range`); return value; }
function exact(value, label, expected) { return bounded(value, label, expected, expected); }
function enumeration(value, label, values) { if (!values.includes(value)) fail("INVALID_FIELD", `${label} is unsupported`); return value; }
function validDate(value) { if (!(value instanceof Date) || !Number.isFinite(value.getTime())) fail("INVALID_TIME", "Credential verification time is invalid"); return value; }
function fail(code, message) { throw new WalletAuthError(code, message); }
