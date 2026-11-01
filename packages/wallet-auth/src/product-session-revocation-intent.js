import { canonicalJSON, digestHex, exactFields, WalletAuthError } from "./canonical.js";
import { parseProductSession } from "./product-session-v2.js";

const BINDING_FIELDS = ["chainId", "productId", "clientId", "platform", "applicationId", "bundleId", "packageId", "origin", "callback"];

export function createRevocationIntent(binding, device, intentId, session) {
  return parseRevocationIntent(canonicalJSON({ version: 1, intentId, scope: scope(binding, device), session }), binding, device);
}

export function parseRevocationIntent(raw, binding, device) {
  if (typeof raw !== "string" || raw.length > 16_384) fail("INVALID_SESSION_STORE", "Pending revocation intent is invalid");
  let value;
  try { value = JSON.parse(raw); } catch { fail("INVALID_SESSION_STORE", "Pending revocation intent is not valid JSON"); }
  exactFields(value, ["version", "intentId", "scope", "session"], "Pending Product Session revocation intent");
  if (value.version !== 1 || !/^[A-Za-z0-9_-]{32,64}$/.test(value.intentId) || value.scope !== scope(binding, device)) fail("CROSS_PRODUCT_SESSION", "Pending revocation intent does not match this product device");
  const session = value.session === null ? null : parseProductSession(value.session);
  if (session && (BINDING_FIELDS.some((field) => session[field] !== binding[field]) || session.deviceId !== device.id || session.deviceKey !== device.key || canonicalJSON(session.scopes) !== canonicalJSON(device.scopes))) fail("CROSS_PRODUCT_SESSION", "Pending revocation target does not match this product device");
  return Object.freeze({ version: 1, intentId: value.intentId, scope: value.scope, session });
}

export function revocationSessionMatches(raw, session) {
  if (raw === null || session === null) return false;
  try { return canonicalJSON(parseProductSession(JSON.parse(raw))) === canonicalJSON(session); } catch { return false; }
}

function scope(binding, device) {
  return digestHex("YNX_PRODUCT_SESSION_LOCAL_REVOCATION_SCOPE_V1", { ...Object.fromEntries(BINDING_FIELDS.map((field) => [field, binding[field]])), deviceId: device.id, deviceKey: device.key, scopes: device.scopes });
}
function fail(code, message) { throw new WalletAuthError(code, message); }

// This local durable record is not a new server signature or a user grant.
// Only the client authority result selects outcome; storage commits it together
// with cleanup of the exact intent, before returning any completion to the app.
export function createRevocationCompletion(rawIntent, binding, device, outcome) {
  const intent = parseRevocationIntent(rawIntent, binding, device);
  const raw = canonicalJSON({ version: 1, intentId: intent.intentId, scope: intent.scope,
    targetDigest: intent.session === null ? null : digestHex("YNX_PRODUCT_SESSION_REVOKED_TARGET_V1", intent.session),
    sessionBinding: intent.session?.sessionBinding ?? null, outcome });
  return parseRevocationCompletion(raw, binding, device);
}
export function parseRevocationCompletion(raw, binding, device) {
  if (typeof raw !== "string" || raw.length > 2048) fail("INVALID_SESSION_STORE", "Revocation completion is invalid");
  let v; try { v = JSON.parse(raw); } catch { fail("INVALID_SESSION_STORE", "Revocation completion is not JSON"); }
  exactFields(v, ["version", "intentId", "scope", "targetDigest", "sessionBinding", "outcome"], "Revocation completion");
  if (v.version !== 1 || !/^[A-Za-z0-9_-]{32,64}$/.test(v.intentId) || v.scope !== scope(binding, device) || !["server-revoked", "authority-expired", "local-only"].includes(v.outcome)) fail("CROSS_PRODUCT_SESSION", "Revocation completion crosses its original intent or scope");
  if (v.outcome === "local-only" ? v.targetDigest !== null || v.sessionBinding !== null : typeof v.targetDigest !== "string" || !/^[0-9a-f]{64}$/.test(v.targetDigest) || typeof v.sessionBinding !== "string" || !/^[0-9a-f]{64}$/.test(v.sessionBinding)) fail("INVALID_SESSION_STORE", "Revocation completion target is invalid");
  if (canonicalJSON(v) !== raw) fail("INVALID_SESSION_STORE", "Revocation completion is not canonical");
  return Object.freeze(v);
}
export function readRevocationCompletions(raw, binding, device) {
  if (raw === null) return [];
  if (typeof raw !== "string" || raw.length > 131072) fail("INVALID_SESSION_STORE", "Revocation completion history is invalid");
  let values; try { values = JSON.parse(raw); } catch { fail("INVALID_SESSION_STORE", "Revocation history is not JSON"); }
  if (!Array.isArray(values) || values.length > 64 || canonicalJSON(values) !== raw) fail("INVALID_SESSION_STORE", "Revocation completion history is not bounded canonical JSON");
  const seen = new Set();
  return values.map(value => { const parsed = parseRevocationCompletion(canonicalJSON(value), binding, device); if (seen.has(parsed.intentId)) fail("INVALID_SESSION_STORE", "Duplicate revocation completion"); seen.add(parsed.intentId); return parsed; });
}
export function appendRevocationCompletion(raw, receiptRaw, binding, device) {
  const records = readRevocationCompletions(raw, binding, device), receipt = parseRevocationCompletion(receiptRaw, binding, device);
  const existing = records.find(r => r.intentId === receipt.intentId);
  if (existing) { if (canonicalJSON(existing) !== receiptRaw) fail("REVOCATION_CHANGED", "Revocation completion changed"); return canonicalJSON(records); }
  if (records.length === 64) fail("REVOCATION_COMPLETION_FULL", "Commit and acknowledge existing consumer receipts before further cleanup");
  return canonicalJSON([...records, receipt]);
}
