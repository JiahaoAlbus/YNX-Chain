import { canonicalJSON, digestHex, exactFields, WalletAuthError } from "./canonical.js";
import { encodeBase64url, decodeBase64url } from "./base64url.js";
import { evmAddressFromYNX } from "./crypto.js";
import { productPlatformBinding } from "./product-session-registry.js";
import { applicationActionPayloadHash, verifySignedApplicationAction } from "./application-action.js";

const REQUEST_FIELDS = ["version", "chainId", "productId", "platform", "applicationId", "origin", "callback", "account", "action", "payload", "nonce", "requestId", "state", "issuedAt", "expiresAt"];
const INPUT_FIELDS = ["productId", "platform", "account", "action", "payload", "nonce", "requestId", "state"];
const REQUEST_LIMIT = 16 * 1024;
const RESULT_LIMIT = 24 * 1024;
const MAX_LIFETIME = 300_000;
const ROUTE = "ynxwallet://application-action";

/** Build a separate, explicit transaction-signing request. Registry membership
 * constrains the claimed origin and return target; it does NOT authenticate the
 * process or page that opened Wallet. Product Session scopes are not approval. */
export function createApplicationActionRequest(registry, input, at = new Date()) {
  const data = fields(input, INPUT_FIELDS, "Application action request input");
  const binding = productPlatformBinding(registry, data.productId, data.platform);
  const time = instant(at);
  return parseApplicationActionRequest(registry, {
    version: "1", chainId: "ynx_6423-1", ...data,
    applicationId: binding.applicationId, origin: binding.origin, callback: binding.callback,
    issuedAt: time.toISOString(), expiresAt: new Date(time.getTime() + MAX_LIFETIME).toISOString(),
  }, time);
}

export function parseApplicationActionRequest(registry, input, at = new Date()) {
  const request = snapshot(input);
  const binding = productPlatformBinding(registry, request.productId, request.platform);
  if (request.productId !== "dex" || request.version !== "1" || request.chainId !== "ynx_6423-1"
    || !binding.callback || ["applicationId", "origin", "callback"].some(key => request[key] !== binding[key])) {
    fail("BINDING_MISMATCH", "Application action must match the exact registered DEX platform, origin and callback");
  }
  const now = instant(at).getTime();
  const issued = timestamp(request.issuedAt), expires = timestamp(request.expiresAt);
  if (issued > now || expires <= now || expires <= issued || expires - issued > MAX_LIFETIME) {
    fail("EXPIRED_APPLICATION_ACTION", "Application action request is outside its maximum 300 second lifetime");
  }
  if (request.payload.deadlineUnix <= Math.floor(now / 1000)) fail("EXPIRED_APPLICATION_ACTION", "DEX action deadline has expired");
  return Object.freeze(request);
}

/** Hash only: callers must also parse against their authoritative registry and
 * current time. The digest is an outer correlation value, not a DApp signature. */
export function applicationActionRequestDigest(request) {
  return digestHex("YNX_APPLICATION_ACTION_REQUEST_V1", snapshot(request));
}

export function encodeApplicationActionWalletURL(registry, input, at = new Date()) {
  const request = parseApplicationActionRequest(registry, input, at);
  return `${ROUTE}?request=${encode(request, REQUEST_LIMIT)}`;
}

export function parseApplicationActionWalletURL(registry, url, at = new Date()) {
  return parseApplicationActionRequest(registry, decodeRoute(url, ROUTE, "request", REQUEST_LIMIT), at);
}

export function createApplicationActionReturnURL(registry, input, result, at = new Date()) {
  const request = parseApplicationActionRequest(registry, input, at);
  const approved = dataStatus(result) === "approved";
  const data = fields(result, approved ? ["status", "signed"] : ["status", "reason"], "Application action decision");
  const parsed = resultFor(request, {
    kind: "application-action", version: "1", requestDigest: applicationActionRequestDigest(request), state: request.state, ...data,
  });
  return `${request.callback}?applicationActionResult=${encode(parsed, RESULT_LIMIT)}`;
}

/** Verify exact pending-request correlation and the signed account/action/
 * business payload/nonce. The Core signature does not sign the outer origin,
 * requestId or status fields. A rejection is unsigned and grants no authority. */
export function parseApplicationActionReturnURL(registry, url, input, at = new Date()) {
  const request = parseApplicationActionRequest(registry, input, at);
  return resultFor(request, decodeRoute(url, request.callback, "applicationActionResult", RESULT_LIMIT));
}

function resultFor(request, input) {
  const approved = dataStatus(input) === "approved";
  const result = fields(input, ["kind", "version", "requestDigest", "state", "status", approved ? "signed" : "reason"], "Application action result");
  if (result.kind !== "application-action" || result.version !== "1" || result.requestDigest !== applicationActionRequestDigest(request) || result.state !== request.state) {
    fail("BINDING_MISMATCH", "Application action result does not match the pending request");
  }
  if (approved) {
    if (typeof result.signed !== "string" || result.signed.length > REQUEST_LIMIT) fail("INVALID_APPLICATION_ACTION_RESULT", "Signed application action must be bounded canonical Core JSON");
    verifySignedApplicationAction(result.signed, { account: request.account, action: request.action, payload: request.payload, nonce: request.nonce });
  } else if (result.status !== "rejected" || result.reason !== "USER_REJECTED") {
    fail("INVALID_APPLICATION_ACTION_RESULT", "Application action decision is unsupported");
  }
  return Object.freeze(result);
}

function snapshot(input) {
  const request = fields(input, REQUEST_FIELDS, "Application action request");
  // No accessor is evaluated while validating or detaching business fields.
  if (!request.payload || typeof request.payload !== "object" || Array.isArray(request.payload)) fail("INVALID_SHAPE", "DEX payload must be a data object");
  request.payload = Object.freeze(fields(request.payload, Object.keys(request.payload), "DEX payload"));
  applicationActionPayloadHash(request.action, request.payload);
  evmAddressFromYNX(request.account);
  if (!Number.isSafeInteger(request.nonce) || request.nonce <= 0) fail("INVALID_APPLICATION_ACTION", "Application action nonce must be a positive safe integer");
  if (typeof request.requestId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(request.requestId)) fail("INVALID_APPLICATION_ACTION", "requestId must be a canonical UUID v4");
  if (typeof request.state !== "string" || !/^[A-Za-z0-9_-]{32,128}$/.test(request.state)) fail("INVALID_APPLICATION_ACTION", "state must be 32 to 128 base64url characters");
  // Canonical timestamps and primitive registered fields are mandatory even for hashing.
  timestamp(request.issuedAt); timestamp(request.expiresAt);
  for (const key of ["version", "chainId", "productId", "platform", "applicationId", "origin", "callback"]) {
    if (typeof request[key] !== "string" || !request[key].length || request[key].length > 512) fail("INVALID_APPLICATION_ACTION", `${key} is invalid`);
  }
  bounded(canonicalJSON(request), REQUEST_LIMIT);
  return request;
}

function dataStatus(value) {
  return value !== null && typeof value === "object" ? Object.getOwnPropertyDescriptor(value, "status")?.value : undefined;
}

function fields(value, names, label) {
  exactFields(value, names, label);
  if (Reflect.ownKeys(value).length !== names.length) fail("INVALID_SHAPE", `${label} must contain only data fields`);
  const copy = {};
  for (const key of names) {
    const field = Object.getOwnPropertyDescriptor(value, key);
    if (!field?.enumerable || !Object.hasOwn(field, "value")) fail("INVALID_SHAPE", `${label} cannot contain accessors`);
    Object.defineProperty(copy, key, { value: field.value, enumerable: true, writable: true, configurable: true });
  }
  return copy;
}
function instant(value) {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) fail("INVALID_TIME", "A valid current time is required");
  return new Date(value.getTime());
}
function timestamp(value) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) fail("INVALID_TIME", "Application action time must be canonical ISO UTC");
  return Date.parse(value);
}
function bounded(raw, limit) {
  if (!raw.length || raw.length > limit || new TextEncoder().encode(raw).length > limit) fail("INVALID_ENCODING", "Application action data exceeds its byte limit");
}
function encode(value, limit) {
  const raw = canonicalJSON(value); bounded(raw, limit);
  return encodeBase64url(new TextEncoder().encode(raw));
}
function decodeRoute(value, target, key, limit) {
  if (typeof value !== "string" || value.length > limit * 2 || !value.startsWith(`${target}?${key}=`)) fail("INVALID_APPLICATION_ACTION_ROUTE", "Application action route is not registered");
  // Compare the entire literal URL, not just a normalized URL's origin. This
  // rejects ports, fragments, duplicate/query aliases and percent-encoded keys.
  const encoded = value.slice(target.length + key.length + 2);
  if (!/^[A-Za-z0-9_-]+$/.test(encoded)) fail("INVALID_ENCODING", "Application action URL must contain a single canonical base64url field");
  const bytes = decodeBase64url(encoded);
  if (bytes.length > limit || encodeBase64url(bytes) !== encoded) fail("INVALID_ENCODING", "Application action base64url is not canonical or exceeds its byte limit");
  let raw, result;
  try {
    // decodeURIComponent is available in Hermes; unlike permissive UTF-8
    // replacement decoding, malformed byte sequences throw.
    raw = decodeURIComponent(Array.from(bytes, byte => `%${byte.toString(16).padStart(2, "0")}`).join(""));
    result = JSON.parse(raw);
  } catch { fail("INVALID_ENCODING", "Application action JSON or UTF-8 is invalid"); }
  if (canonicalJSON(result) !== raw) fail("INVALID_ENCODING", "Application action JSON must be canonical with no duplicate fields");
  return result;
}
function fail(code, message) { throw new WalletAuthError(code, message); }
