import { p256 } from "@noble/curves/nist.js";
import { utf8ToBytes } from "@noble/hashes/utils.js";
import { canonicalJSON, digestHex, exactFields, WalletAuthError } from "./canonical.js";
import { decodeBase64url, encodeBase64url } from "./base64url.js";
import { parseProductSession } from "./product-session-v2.js";

const PROOF_FIELDS = ["version", "sessionBinding", "productId", "clientId", "applicationId", "bundleId", "packageId", "origin", "callback", "account", "deviceId", "deviceKey", "method", "path", "bodyDigest", "nonce", "issuedAt", "expiresAt", "signature"];
const INPUT_FIELDS = ["method", "path", "bodyDigest", "nonce", "issuedAt", "expiresAt"];

export function createProductSessionProofV2(sessionInput, input, deviceSecretInput) {
  const session = parseProductSession(sessionInput); exactFields(input, INPUT_FIELDS, "Product Session v2 proof input");
  const secret = decodeBase64url(deviceSecretInput, "deviceSecret");
  if (secret.length !== 32 || encodeBase64url(p256.getPublicKey(secret, true)) !== session.deviceKey) fail("DEVICE_CHANGED", "Product Session proof device changed");
  const unsigned = unsignedProof(session, input);
  const signature = encodeBase64url(p256.sign(utf8ToBytes(productSessionProofV2SignBytes(unsigned)), secret, { format: "der" }));
  return parseProductSessionProofV2({ ...unsigned, signature });
}

export async function createProductSessionProofV2With(sessionInput, input, signer) {
  const session = parseProductSession(sessionInput); exactFields(input, INPUT_FIELDS, "Product Session v2 proof input");
  if (typeof signer !== "function") fail("INVALID_DEVICE", "Product Session proof requires a platform device signer");
  const unsigned = unsignedProof(session, input);
  const payload = encodeBase64url(utf8ToBytes(productSessionProofV2SignBytes(unsigned)));
  let signature;
  try { signature = await signer(Object.freeze({ purpose: "http-proof", algorithm: "p256-sha256", deviceKey: session.deviceKey, payload })); }
  catch { fail("DEVICE_SIGNING_FAILED", "Platform device proof signing failed closed"); }
  const proof = parseProductSessionProofV2({ ...unsigned, signature });
  let valid = false;
  try { valid = p256.verify(decodeBase64url(proof.signature, "signature"), decodeBase64url(payload, "device signing payload"), decodeBase64url(session.deviceKey, "deviceKey"), { format: "der", lowS: false }); } catch { valid = false; }
  if (!valid) fail("INVALID_DEVICE_PROOF", "Platform device proof signature does not match the registered device key");
  return proof;
}

export function parseProductSessionProofV2(input) {
  exactFields(input, PROOF_FIELDS, "Product Session v2 proof"); const { signature, ...unsigned } = input;
  const bytes = decodeBase64url(pattern(signature, "signature", /^[A-Za-z0-9_-]{90,96}$/), "signature");
  if (bytes.length < 68 || bytes.length > 72 || encodeBase64url(bytes) !== signature) fail("INVALID_DEVICE_PROOF", "Product Session proof signature is invalid");
  return Object.freeze({ ...parseUnsigned(unsigned), signature });
}

export function verifyProductSessionProofV2(proofInput, sessionInput, request, at = new Date()) {
  const proof = parseProductSessionProofV2(proofInput), session = parseProductSession(sessionInput);
  exactFields(request, ["method", "path", "bodyDigest"], "Product Session v2 proof request context");
  const bindingFields = ["sessionBinding", "productId", "clientId", "applicationId", "bundleId", "packageId", "origin", "callback", "account", "deviceId", "deviceKey"];
  if (bindingFields.some((field) => proof[field] !== session[field])) fail("CROSS_PRODUCT_SESSION", "Product Session proof crosses a session binding");
  if (proof.method !== method(request.method) || proof.path !== path(request.path) || proof.bodyDigest !== digest(request.bodyDigest, "bodyDigest")) fail("HTTP_BINDING_MISMATCH", "Product Session proof does not match the HTTP request");
  const now = validDate(at).toISOString();
  if (proof.issuedAt < session.issuedAt || proof.issuedAt > now) fail("ISSUED_IN_FUTURE", "Product Session proof issue time is invalid");
  if (proof.expiresAt <= now || proof.expiresAt > session.expiresAt) fail("SESSION_EXPIRED", "Product Session proof is expired or exceeds its session");
  let valid = false;
  try { valid = p256.verify(decodeBase64url(proof.signature, "signature"), utf8ToBytes(productSessionProofV2SignBytes(unsigned(proof))), decodeBase64url(proof.deviceKey, "deviceKey"), { format: "der", lowS: false }); } catch { valid = false; }
  if (!valid) fail("INVALID_DEVICE_PROOF", "Product Session proof signature is invalid");
  return proof;
}

export function productSessionProofV2SignBytes(input) { return `YNX_PRODUCT_SESSION_HTTP_PROOF_V2\n${canonicalJSON(parseUnsigned(input))}`; }
export function productSessionProofV2Digest(input) { return digestHex("YNX_PRODUCT_SESSION_HTTP_PROOF_DIGEST_V2", parseProductSessionProofV2(input)); }

function unsignedProof(session, input) { return parseUnsigned({ version: "2", sessionBinding: session.sessionBinding, productId: session.productId, clientId: session.clientId, applicationId: session.applicationId, bundleId: session.bundleId, packageId: session.packageId, origin: session.origin, callback: session.callback, account: session.account, deviceId: session.deviceId, deviceKey: session.deviceKey, ...input }); }

function parseUnsigned(input) {
  exactFields(input, PROOF_FIELDS.filter((field) => field !== "signature"), "Unsigned Product Session v2 proof");
  const value = Object.freeze({ version: pattern(input.version, "version", /^2$/), sessionBinding: digest(input.sessionBinding, "sessionBinding"), productId: pattern(input.productId, "productId", /^[a-z][a-z0-9-]{1,31}$/), clientId: pattern(input.clientId, "clientId", /^[a-z][a-z0-9._-]{2,63}$/), applicationId: pattern(input.applicationId, "applicationId", /^[A-Za-z][A-Za-z0-9.-]{2,131}$/), bundleId: nullableIdentity(input.bundleId, "bundleId"), packageId: nullableIdentity(input.packageId, "packageId"), origin: url(input.origin, "origin"), callback: url(input.callback, "callback"), account: pattern(input.account, "account", /^ynx1[023456789acdefghjklmnpqrstuvwxyz]{38}$/), deviceId: pattern(input.deviceId, "deviceId", /^[A-Za-z0-9._:-]{8,128}$/), deviceKey: pattern(input.deviceKey, "deviceKey", /^[A-Za-z0-9_-]{44}$/), method: method(input.method), path: path(input.path), bodyDigest: digest(input.bodyDigest, "bodyDigest"), nonce: pattern(input.nonce, "nonce", /^[A-Za-z0-9_-]{32,64}$/), issuedAt: time(input.issuedAt, "issuedAt"), expiresAt: time(input.expiresAt, "expiresAt") });
  if ((value.bundleId !== null && value.bundleId !== value.applicationId) || (value.packageId !== null && value.packageId !== value.applicationId) || (value.bundleId !== null && value.packageId !== null)) fail("INVALID_FIELD", "Product Session proof application identity is inconsistent");
  if (value.expiresAt <= value.issuedAt || Date.parse(value.expiresAt) - Date.parse(value.issuedAt) > 60_000) fail("INVALID_EXPIRY", "Product Session proof lifetime must be at most sixty seconds");
  return value;
}
function unsigned(value) { const { signature: _signature, ...result } = value; return result; }
function url(value, label) { const normalized = pattern(value, label, /^(https|app|[a-z][a-z0-9+.-]*):\/\/[^\s#?]+$/); let parsed; try { parsed = new URL(normalized); } catch { fail("INVALID_FIELD", `${label} is invalid`); } const canonical = label === "origin" && parsed.protocol === "https:" ? parsed.origin === normalized : parsed.toString() === normalized; if (!canonical || ["http:", "file:", "javascript:", "data:"].includes(parsed.protocol)) fail("INVALID_FIELD", `${label} is unsafe`); return normalized; }
function method(value) { return pattern(value, "method", /^(DELETE|GET|PATCH|POST|PUT)$/); }
function path(value) { const normalized = pattern(value, "path", /^\/[A-Za-z0-9._~!$&'()*+,;=:@\/-]{1,255}$/); if (normalized.includes("//") || normalized.endsWith("/") || normalized.includes("?") || normalized.includes("#")) fail("INVALID_PATH", "Product Session proof path is non-canonical"); return normalized; }
function digest(value, label) { return pattern(value, label, /^[0-9a-f]{64}$/); }
function nullableIdentity(value, label) { return value === null ? null : pattern(value, label, /^[A-Za-z][A-Za-z0-9.-]{2,131}$/); }
function pattern(value, label, regex) { if (typeof value !== "string" || value.trim() !== value || !regex.test(value)) fail("INVALID_FIELD", `${label} is invalid`); return value; }
function time(value, label) { const normalized = pattern(value, label, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/); if (!Number.isFinite(Date.parse(normalized)) || new Date(normalized).toISOString() !== normalized) fail("INVALID_TIME", `${label} is invalid`); return normalized; }
function validDate(value) { if (!(value instanceof Date) || !Number.isFinite(value.getTime())) fail("INVALID_TIME", "Product Session proof time is invalid"); return value; }
function fail(code, message) { throw new WalletAuthError(code, message); }
