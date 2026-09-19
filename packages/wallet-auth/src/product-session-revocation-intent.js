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
