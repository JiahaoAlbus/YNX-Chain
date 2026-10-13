import { canonicalJSON, digestHex, exactFields, WalletAuthError } from "./canonical.js";
import { encodeBase64url, decodeBase64url } from "./base64url.js";
import { evmAddressFromYNX } from "./crypto.js";
import { productPlatformBinding } from "./product-session-registry.js";
import { cardApplicationDetailsHash, verifySignedCardApplicationApproval } from "./card-application-approval.js";

const INPUT_FIELDS = ["productId", "platform", "account", "challenge", "details", "requestId", "state"];
const REQUEST_FIELDS = ["version", "chainId", "productId", "platform", "applicationId", "origin", "callback", "account", "challenge", "details", "requestId", "state", "issuedAt", "expiresAt"];
const CHALLENGE_FIELDS = ["id", "applicationId", "owner", "chainId", "purpose", "payloadHash", "nonce", "issuedAt", "expiresAt"];
const DETAILS_FIELDS = ["nickname", "useCase", "limitWei", "riskAccepted", "termsVersion"];
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const REQUEST_LIMIT = 16 * 1024, RESULT_LIMIT = 24 * 1024, MAX_LIFETIME = 300_000;
const ROUTE = "ynxwallet://card-application-approval";

/** Prepare explicit Card business review. Registry membership constrains a
 * claimed origin and callback; it does not authenticate the caller or establish
 * a Product Session. No secret, device proof, provider, or signing is used here.
 */
export function createCardApplicationApprovalRequest(registry, input, at = new Date()) {
  const data = fields(input, INPUT_FIELDS, "Card approval request input");
  const challenge = challengeSnapshot(data.challenge);
  const binding = productPlatformBinding(registry, data.productId, data.platform);
  const now = instant(at);
  return parseCardApplicationApprovalRequest(registry, {
    version: "1", chainId: "ynx_6423-1", ...data, challenge,
    applicationId: binding.applicationId, origin: binding.origin, callback: binding.callback,
    issuedAt: now.toISOString(), expiresAt: new Date(Math.min(now.getTime() + MAX_LIFETIME, timestamp(challenge.expiresAt))).toISOString(),
  }, now);
}

export function parseCardApplicationApprovalRequest(registry, input, at = new Date()) {
  const request = snapshot(input);
  const binding = productPlatformBinding(registry, request.productId, request.platform);
  if (request.version !== "1" || request.chainId !== "ynx_6423-1" || request.productId !== "card"
    || !binding.callback || ["applicationId", "origin", "callback"].some(key => request[key] !== binding[key])) {
    fail("BINDING_MISMATCH", "Card approval must match the exact registered Card platform, origin and callback");
  }
  const now = instant(at).getTime(), issued = timestamp(request.issuedAt), expires = timestamp(request.expiresAt);
  if (issued > now || expires <= now || expires <= issued || expires - issued > MAX_LIFETIME
    || issued < timestamp(request.challenge.issuedAt) || expires > timestamp(request.challenge.expiresAt)) {
    fail("EXPIRED_CARD_APPROVAL_REQUEST", "Card review must be current and fit inside its challenge and 300 second lifetime");
  }
  return Object.freeze(request);
}

/** Correlation only: parse with the authoritative registry and time as well.
 * The digest does not authenticate the claimed DApp origin or caller process.
 */
export function cardApplicationApprovalRequestDigest(request) {
  return digestHex("YNX_CARD_APPLICATION_APPROVAL_REQUEST_V1", snapshot(request));
}

export function encodeCardApplicationApprovalWalletURL(registry, input, at = new Date()) {
  return `${ROUTE}?request=${encode(parseCardApplicationApprovalRequest(registry, input, at), REQUEST_LIMIT)}`;
}

export function parseCardApplicationApprovalWalletURL(registry, url, at = new Date()) {
  return parseCardApplicationApprovalRequest(registry, decodeRoute(url, ROUTE, "request", REQUEST_LIMIT), at);
}

export function createCardApplicationApprovalReturnURL(registry, input, decision, at = new Date()) {
  const request = parseCardApplicationApprovalRequest(registry, input, at);
  const approved = dataStatus(decision) === "approved";
  const data = fields(decision, approved ? ["status", "approval"] : ["status", "reason"], "Card approval decision");
  const result = resultFor(request, {
    kind: "card-application-approval", version: "1", requestDigest: cardApplicationApprovalRequestDigest(request), state: request.state, ...data,
  }, at);
  return `${request.callback}?cardApplicationApprovalResult=${encode(result, RESULT_LIMIT)}`;
}

/** Check exact pending-request correlation, then the actual Card signature and
 * current challenge/details/account/time. The signature covers Card business
 * approval, not the outer origin, requestId or state. Rejection is unsigned and
 * grants no authority; a caller must not treat correlation as authentication.
 */
export function parseCardApplicationApprovalReturnURL(registry, url, input, at = new Date()) {
  const request = parseCardApplicationApprovalRequest(registry, input, at);
  return resultFor(request, decodeRoute(url, request.callback, "cardApplicationApprovalResult", RESULT_LIMIT), at);
}

function resultFor(request, input, at) {
  const approved = dataStatus(input) === "approved";
  const result = fields(input, ["kind", "version", "requestDigest", "state", "status", approved ? "approval" : "reason"], "Card approval result");
  if (result.kind !== "card-application-approval" || result.version !== "1" || result.requestDigest !== cardApplicationApprovalRequestDigest(request) || result.state !== request.state) {
    fail("BINDING_MISMATCH", "Card approval result does not match the exact pending request");
  }
  if (approved) {
    if (result.approval === null || typeof result.approval !== "object" || Array.isArray(result.approval)) fail("INVALID_CARD_APPROVAL_RESULT", "Card approval must be a signed proof object");
    result.approval = verifySignedCardApplicationApproval(result.approval, { challenge: request.challenge, details: request.details, account: request.account }, at);
    if (timestamp(result.approval.issuedAt) < timestamp(request.issuedAt)) fail("BINDING_MISMATCH", "Card approval predates this review request");
  } else if (result.status !== "rejected" || result.reason !== "USER_REJECTED") {
    fail("INVALID_CARD_APPROVAL_RESULT", "Card approval decision is unsupported");
  }
  bounded(canonicalJSON(result), RESULT_LIMIT);
  return Object.freeze(result);
}

function snapshot(input) {
  const request = fields(input, REQUEST_FIELDS, "Card approval request");
  request.challenge = challengeSnapshot(request.challenge);
  request.details = Object.freeze(fields(request.details, DETAILS_FIELDS, "Card application details"));
  const payloadHash = cardApplicationDetailsHash(request.details);
  const accountAddress = evmAddressFromYNX(request.account);
  if (request.challenge.payloadHash !== payloadHash || ownerAddress(request.challenge.owner) !== accountAddress) fail("BINDING_MISMATCH", "Card challenge must match the full application details and selected account");
  text(request.requestId, "requestId", new RegExp(`^${UUID}$`));
  text(request.state, "state", /^[A-Za-z0-9_-]{32,128}$/);
  timestamp(request.issuedAt); timestamp(request.expiresAt);
  for (const key of ["version", "chainId", "productId", "platform", "applicationId", "origin", "callback"]) {
    if (typeof request[key] !== "string" || !request[key].length || request[key].length > 512) fail("INVALID_CARD_APPROVAL_REQUEST", `${key} is invalid`);
  }
  bounded(canonicalJSON(request), REQUEST_LIMIT);
  return request;
}

function challengeSnapshot(input) {
  // Same public challenge schema as the frozen Card proof. Validation must not
  // manufacture a temporary signature or use any secret merely to parse it.
  const challenge = fields(input, CHALLENGE_FIELDS, "Card business challenge");
  text(challenge.id, "challenge id", new RegExp(`^challenge_${UUID}$`));
  text(challenge.applicationId, "Card application id", new RegExp(`^application_${UUID}$`));
  text(challenge.nonce, "challenge nonce", new RegExp(`^${UUID}$`));
  text(challenge.payloadHash, "payloadHash", /^[0-9a-f]{64}$/);
  ownerAddress(challenge.owner);
  if (challenge.chainId !== "0x1917" || challenge.purpose !== "create-testnet-card") fail("INVALID_CARD_APPROVAL_REQUEST", "Card challenge chain or purpose is invalid");
  const issued = timestamp(challenge.issuedAt), expires = timestamp(challenge.expiresAt);
  if (expires <= issued || expires - issued > MAX_LIFETIME) fail("EXPIRED_CARD_APPROVAL_REQUEST", "Card challenge lifetime must be positive and at most 300 seconds");
  return Object.freeze(challenge);
}

function ownerAddress(value) { return typeof value === "string" && value.startsWith("ynx1") ? evmAddressFromYNX(value) : text(value, "owner", /^0x[0-9a-f]{40}$/); }
function dataStatus(value) { return value !== null && typeof value === "object" ? Object.getOwnPropertyDescriptor(value, "status")?.value : undefined; }
function fields(value, names, label) {
  exactFields(value, names, label);
  if (Reflect.ownKeys(value).length !== names.length) fail("INVALID_SHAPE", `${label} must contain only data fields`);
  const copy = {};
  for (const key of names) {
    const property = Object.getOwnPropertyDescriptor(value, key);
    if (!property?.enumerable || !Object.hasOwn(property, "value")) fail("INVALID_SHAPE", `${label} cannot contain accessors`);
    copy[key] = property.value;
  }
  return copy;
}
function text(value, label, pattern) { if (typeof value !== "string" || value.trim() !== value || !pattern.test(value)) fail("INVALID_CARD_APPROVAL_REQUEST", `${label} is invalid`); return value; }
function instant(value) { if (!(value instanceof Date) || !Number.isFinite(value.getTime())) fail("INVALID_TIME", "A valid current authority time is required"); return new Date(value.getTime()); }
function timestamp(value) { if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) fail("INVALID_TIME", "Card review timestamps must be canonical ISO UTC"); return Date.parse(value); }
function bounded(raw, limit) { if (!raw.length || raw.length > limit || new TextEncoder().encode(raw).length > limit) fail("INVALID_ENCODING", "Card approval data exceeds its byte limit"); }
function encode(value, limit) { const raw = canonicalJSON(value); bounded(raw, limit); return encodeBase64url(new TextEncoder().encode(raw)); }
function decodeRoute(value, target, key, limit) {
  if (typeof value !== "string" || value.length > limit * 2 || !value.startsWith(`${target}?${key}=`)) fail("INVALID_CARD_APPROVAL_ROUTE", "Card approval route is not registered");
  // Exact literal URL prevents normalization aliases, query duplicates, ports,
  // fragments and alternate encoded parameter names from sharing a route.
  const encoded = value.slice(target.length + key.length + 2);
  if (!/^[A-Za-z0-9_-]+$/.test(encoded)) fail("INVALID_ENCODING", "Card URL requires a single canonical base64url field");
  const bytes = decodeBase64url(encoded);
  if (bytes.length > limit || encodeBase64url(bytes) !== encoded) fail("INVALID_ENCODING", "Card base64url is noncanonical or too large");
  let raw, result;
  try {
    raw = decodeURIComponent(Array.from(bytes, byte => `%${byte.toString(16).padStart(2, "0")}`).join(""));
    result = JSON.parse(raw);
  } catch { fail("INVALID_ENCODING", "Card approval JSON or UTF-8 is invalid"); }
  if (canonicalJSON(result) !== raw) fail("INVALID_ENCODING", "Card approval JSON must be canonical without duplicate fields");
  return result;
}
function fail(code, message) { throw new WalletAuthError(code, message); }
