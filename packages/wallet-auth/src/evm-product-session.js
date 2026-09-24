import { p256 } from "@noble/curves/nist.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { canonicalJSON, digestHex, exactFields, WalletAuthError } from "./canonical.js";
import { decodeBase64url, encodeBase64url } from "./base64url.js";
import { ethereumPersonalMessageDigest, recoverEthereumAddress } from "./evm-product-login.js";

export const EVM_PRODUCT_SESSION_VERSION = "1";
export const EVM_PRODUCT_SESSION_SCOPE = "finance.account.read";
export const EVM_PRODUCT_SESSION_ORIGIN = "https://finance.ynxweb4.com";
export const EVM_PRODUCT_SESSION_CALLBACK = "https://finance.ynxweb4.com/wallet-auth/callback";
export const EVM_PRODUCT_SESSION_MAX_LIFETIME_MS = 15 * 60_000;
export const EVM_PRODUCT_SESSION_PROOF_MAX_LIFETIME_MS = 60_000;

const CHALLENGE = ["version", "chainId", "account", "productId", "origin", "callback", "scope", "deviceId", "deviceAlgorithm", "deviceKey", "nonce", "state", "requestId", "providerKind", "issuedAt", "expiresAt"];
const LOGIN_PROOF = ["challenge", "message", "walletSignature", "deviceSignature"];
const SESSION = ["version", "sessionId", "challengeDigest", "chainId", "account", "productId", "origin", "callback", "scope", "deviceId", "deviceAlgorithm", "deviceKey", "nonce", "state", "requestId", "issuedAt", "expiresAt"];
const HTTP_PROOF = ["version", "sessionId", "challengeDigest", "account", "origin", "scope", "method", "target", "bodyDigest", "nonce", "issuedAt", "expiresAt", "deviceSignature"];

export function createEvmProductSessionChallenge(input) {
  exactFields(input, CHALLENGE.filter((field) => field !== "version"), "EVM Product Session challenge input");
  return parseEvmProductSessionChallenge({ ...input, version: EVM_PRODUCT_SESSION_VERSION });
}

export function parseEvmProductSessionChallenge(input) {
  exactFields(input, CHALLENGE, "EVM Product Session challenge");
  const value = Object.freeze({
    version: literal(input.version, "1"), chainId: literal(input.chainId, 6423),
    account: account(input.account), productId: literal(input.productId, "finance"),
    origin: literal(origin(input.origin), EVM_PRODUCT_SESSION_ORIGIN), callback: literal(callback(input.callback), EVM_PRODUCT_SESSION_CALLBACK),
    scope: literal(input.scope, EVM_PRODUCT_SESSION_SCOPE),
    deviceId: pattern(input.deviceId, "deviceId", /^[A-Za-z0-9._:-]{8,128}$/),
    deviceAlgorithm: literal(input.deviceAlgorithm, "p256-sha256"), deviceKey: deviceKey(input.deviceKey),
    nonce: token(input.nonce, "nonce"), state: token(input.state, "state"),
    requestId: pattern(input.requestId, "requestId", /^[A-Za-z0-9._~-]{16,128}$/),
    providerKind: pattern(input.providerKind, "providerKind", /^(metamask|ynx-wallet)$/),
    issuedAt: time(input.issuedAt, "issuedAt"), expiresAt: time(input.expiresAt, "expiresAt"),
  });
  if (!value.callback.startsWith(`${value.origin}/`)) fail("CALLBACK_ORIGIN_MISMATCH", "Callback must belong to the exact product origin");
  if (Date.parse(value.expiresAt) <= Date.parse(value.issuedAt) || Date.parse(value.expiresAt) - Date.parse(value.issuedAt) > 5 * 60_000) fail("INVALID_EXPIRY", "Challenge lifetime is invalid");
  return value;
}

export function evmProductSessionMessage(input) {
  return `YNX EVM Product Session authorization v1\n${canonicalJSON(parseEvmProductSessionChallenge(input))}`;
}

export function createEvmProductSessionSigningRequest(input) {
  const challenge = parseEvmProductSessionChallenge(input), message = evmProductSessionMessage(challenge);
  return Object.freeze({ method: "personal_sign", params: Object.freeze([`0x${bytesToHex(utf8ToBytes(message))}`, challenge.account]), message });
}

export function evmProductSessionDeviceSignBytes(input) {
  return `YNX_EVM_PRODUCT_SESSION_DEVICE_BINDING_V1\n${evmProductSessionMessage(input)}`;
}

export function createEvmProductSessionLoginProof(challengeInput, walletSignature, deviceSecretInput) {
  const challenge = parseEvmProductSessionChallenge(challengeInput);
  const secret = deviceSecret(deviceSecretInput, challenge.deviceKey);
  const deviceSignature = encodeBase64url(p256.sign(utf8ToBytes(evmProductSessionDeviceSignBytes(challenge)), secret, { format: "der" }));
  return parseEvmProductSessionLoginProof({ challenge, message: evmProductSessionMessage(challenge), walletSignature, deviceSignature });
}

export async function createEvmProductSessionLoginProofWith(challengeInput, walletSignature, signer) {
  const challenge = parseEvmProductSessionChallenge(challengeInput);
  if (typeof signer !== "function") fail("INVALID_DEVICE", "A P-256 device signer is required");
  const payload = encodeBase64url(utf8ToBytes(evmProductSessionDeviceSignBytes(challenge)));
  const deviceSignature = normalizeSignerSignature(await signer(Object.freeze({ purpose: "evm-session-binding", algorithm: "p256-sha256", deviceKey: challenge.deviceKey, payload })));
  const proof = parseEvmProductSessionLoginProof({ challenge, message: evmProductSessionMessage(challenge), walletSignature, deviceSignature });
  verifyDevice(proof.deviceSignature, evmProductSessionDeviceSignBytes(challenge), challenge.deviceKey);
  return proof;
}

export function parseEvmProductSessionLoginProof(input) {
  exactFields(input, LOGIN_PROOF, "EVM Product Session login proof");
  const challenge = parseEvmProductSessionChallenge(input.challenge), message = evmProductSessionMessage(challenge);
  if (input.message !== message) fail("MESSAGE_MISMATCH", "Wallet message differs from the issued challenge");
  return Object.freeze({ challenge, message, walletSignature: signature(input.walletSignature), deviceSignature: deviceSignature(input.deviceSignature) });
}

export function verifyEvmProductSessionLoginProof(input, expectedChallenge, at = new Date()) {
  const proof = parseEvmProductSessionLoginProof(input), expected = parseEvmProductSessionChallenge(expectedChallenge);
  if (proof.message !== evmProductSessionMessage(expected)) fail("CHALLENGE_MISMATCH", "Login proof differs from the server-issued challenge");
  const now = validDate(at).getTime();
  if (Date.parse(expected.issuedAt) > now || Date.parse(expected.expiresAt) <= now) fail("CHALLENGE_EXPIRED", "Challenge is not active");
  if (recoverEthereumAddress(proof.walletSignature, ethereumPersonalMessageDigest(proof.message)) !== expected.account) fail("INVALID_SIGNATURE", "Wallet signature does not match account");
  verifyDevice(proof.deviceSignature, evmProductSessionDeviceSignBytes(expected), expected.deviceKey);
  return Object.freeze({ account: expected.account, challengeDigest: challengeDigest(expected), deviceKey: expected.deviceKey });
}

// commit must atomically mark the challenge consumed AND persist the returned session.
// A false result means the challenge was consumed or the session could not be stored.
export async function issueEvmProductSession(input, expectedChallenge, issue, commit, at = new Date()) {
  const verified = verifyEvmProductSessionLoginProof(input, expectedChallenge, at);
  if (typeof commit !== "function") fail("AUTHORITY_STORE_REQUIRED", "Atomic challenge consumption and session storage are required");
  exactFields(issue, ["sessionId", "expiresAt"], "EVM Product Session issue input");
  const challenge = parseEvmProductSessionChallenge(expectedChallenge), now = validDate(at);
  const session = parseEvmProductSession({ version: "1", sessionId: token(issue.sessionId, "sessionId"), challengeDigest: verified.challengeDigest,
    chainId: challenge.chainId, account: challenge.account, productId: challenge.productId, origin: challenge.origin, callback: challenge.callback,
    scope: challenge.scope, deviceId: challenge.deviceId, deviceAlgorithm: challenge.deviceAlgorithm, deviceKey: challenge.deviceKey,
    nonce: challenge.nonce, state: challenge.state, requestId: challenge.requestId, issuedAt: now.toISOString(), expiresAt: issue.expiresAt });
  if (await commit(Object.freeze({ challengeDigest: verified.challengeDigest, nonce: challenge.nonce, state: challenge.state, requestId: challenge.requestId, session })) !== true) fail("REPLAY_OR_STORE_FAILURE", "Challenge was consumed or session storage failed");
  return session;
}

export function parseEvmProductSession(input) {
  exactFields(input, SESSION, "EVM Product Session");
  const value = Object.freeze({ version: literal(input.version, "1"), sessionId: token(input.sessionId, "sessionId"),
    challengeDigest: digest(input.challengeDigest), chainId: literal(input.chainId, 6423), account: account(input.account),
    productId: literal(input.productId, "finance"), origin: literal(origin(input.origin), EVM_PRODUCT_SESSION_ORIGIN), callback: literal(callback(input.callback), EVM_PRODUCT_SESSION_CALLBACK),
    scope: literal(input.scope, EVM_PRODUCT_SESSION_SCOPE), deviceId: pattern(input.deviceId, "deviceId", /^[A-Za-z0-9._:-]{8,128}$/),
    deviceAlgorithm: literal(input.deviceAlgorithm, "p256-sha256"), deviceKey: deviceKey(input.deviceKey),
    nonce: token(input.nonce, "nonce"), state: token(input.state, "state"),
    requestId: pattern(input.requestId, "requestId", /^[A-Za-z0-9._~-]{16,128}$/),
    issuedAt: time(input.issuedAt, "issuedAt"), expiresAt: time(input.expiresAt, "expiresAt") });
  if (!value.callback.startsWith(`${value.origin}/`)) fail("CALLBACK_ORIGIN_MISMATCH", "Callback origin changed");
  if (Date.parse(value.expiresAt) <= Date.parse(value.issuedAt) || Date.parse(value.expiresAt) - Date.parse(value.issuedAt) > EVM_PRODUCT_SESSION_MAX_LIFETIME_MS) fail("INVALID_EXPIRY", "Session lifetime is invalid");
  return value;
}

export function evmProductSessionProofSignBytes(input) {
  return `YNX_EVM_PRODUCT_SESSION_HTTP_PROOF_V1\n${canonicalJSON(parseUnsignedHttpProof(input))}`;
}

export function createEvmProductSessionHttpProof(sessionInput, request, deviceSecretInput) {
  const session = parseEvmProductSession(sessionInput), secret = deviceSecret(deviceSecretInput, session.deviceKey);
  const unsigned = httpProofInput(session, request);
  const deviceSignature = encodeBase64url(p256.sign(utf8ToBytes(evmProductSessionProofSignBytes(unsigned)), secret, { format: "der" }));
  return parseEvmProductSessionHttpProof({ ...unsigned, deviceSignature });
}

export async function createEvmProductSessionHttpProofWith(sessionInput, request, signer) {
  const session = parseEvmProductSession(sessionInput);
  if (typeof signer !== "function") fail("INVALID_DEVICE", "A P-256 device signer is required");
  const unsigned = httpProofInput(session, request);
  const payload = encodeBase64url(utf8ToBytes(evmProductSessionProofSignBytes(unsigned)));
  const deviceSignature = normalizeSignerSignature(await signer(Object.freeze({ purpose: "evm-session-http-proof", algorithm: "p256-sha256", deviceKey: session.deviceKey, payload })));
  const proof = parseEvmProductSessionHttpProof({ ...unsigned, deviceSignature });
  verifyDevice(proof.deviceSignature, evmProductSessionProofSignBytes(unsigned), session.deviceKey);
  return proof;
}

export function parseEvmProductSessionHttpProof(input) {
  exactFields(input, HTTP_PROOF, "EVM Product Session HTTP proof");
  const { deviceSignature: signed, ...unsigned } = input;
  return Object.freeze({ ...parseUnsignedHttpProof(unsigned), deviceSignature: deviceSignature(signed) });
}

// loadSession MUST query the server's authoritative store, never client JSON.
// consumeProof MUST atomically reject duplicate (sessionId, nonce) pairs.
export async function verifyAndConsumeEvmProductSessionHttpProof(proofInput, loadSession, request, authority, consumeProof, at = new Date()) {
  const proof = parseEvmProductSessionHttpProof(proofInput);
  if (typeof loadSession !== "function") fail("AUTHORITY_STORE_REQUIRED", "Authoritative session lookup is required");
  const stored = await loadSession(proof.sessionId);
  if (stored === null || stored === undefined) fail("SESSION_NOT_FOUND", "Session is absent from the authority store");
  const session = parseEvmProductSession(stored);
  exactFields(request, ["origin", "method", "target", "bodyDigest", "requiredScope", "allowedTargets"], "EVM Product Session request context");
  exactFields(authority, ["currentAccount", "currentChainId", "connected", "revoked"], "EVM Product Session authority context");
  if (typeof consumeProof !== "function") fail("REPLAY_STORE_REQUIRED", "Atomic HTTP proof nonce consumption is required");
  if (authority.revoked !== false) fail("SESSION_REVOKED", "Session is revoked or revocation state is unknown");
  if (authority.connected !== true || authority.currentAccount !== session.account) fail("ACCOUNT_CHANGED", "Selected account disconnected or changed");
  if (authority.currentChainId !== 6423) fail("CHAIN_CHANGED", "Selected chain changed or is unknown");
  if (request.requiredScope !== EVM_PRODUCT_SESSION_SCOPE || session.scope !== request.requiredScope) fail("SCOPE_DENIED", "Requested scope is not granted");
  if (request.method !== "GET") fail("SCOPE_DENIED", "Read-only EVM scope permits only GET requests");
  if (!Array.isArray(request.allowedTargets) || request.allowedTargets.length === 0 || request.allowedTargets.length > 32 ||
    request.allowedTargets.some((item) => typeof item !== "string" || item.includes("?") || target(item) !== item) ||
    !request.allowedTargets.includes(target(request.target).split("?")[0])) fail("ROUTE_DENIED", "Request target is not in the server's read-only route allowlist");
  if (origin(request.origin) !== session.origin || proof.origin !== session.origin) fail("ORIGIN_MISMATCH", "Request origin changed");
  const expected = ["sessionId", "challengeDigest", "account", "scope"];
  if (expected.some((key) => proof[key] !== session[key])) fail("SESSION_BINDING_MISMATCH", "HTTP proof differs from stored session");
  if (proof.method !== method(request.method) || proof.target !== target(request.target) || proof.bodyDigest !== digest(request.bodyDigest)) fail("HTTP_BINDING_MISMATCH", "HTTP proof differs from request");
  const now = validDate(at).getTime();
  if (Date.parse(session.expiresAt) <= now || Date.parse(proof.expiresAt) <= now) fail("SESSION_EXPIRED", "Session or HTTP proof expired");
  if (Date.parse(proof.issuedAt) < Date.parse(session.issuedAt) || Date.parse(proof.issuedAt) > now || proof.expiresAt > session.expiresAt) fail("INVALID_PROOF_TIME", "HTTP proof time is outside session");
  verifyDevice(proof.deviceSignature, evmProductSessionProofSignBytes(unsignedProof(proof)), session.deviceKey);
  if (await consumeProof(Object.freeze({ sessionId: session.sessionId, nonce: proof.nonce, expiresAt: proof.expiresAt })) !== true) fail("REPLAY", "HTTP proof was already used");
  return Object.freeze({ authorized: true, account: session.account, productId: session.productId, scope: session.scope, sessionId: session.sessionId });
}

function httpProofInput(session, input) {
  exactFields(input, ["method", "target", "bodyDigest", "nonce", "issuedAt", "expiresAt"], "EVM Product Session HTTP proof input");
  return parseUnsignedHttpProof({ version: "1", sessionId: session.sessionId, challengeDigest: session.challengeDigest, account: session.account,
    origin: session.origin, scope: session.scope, ...input });
}
function parseUnsignedHttpProof(input) {
  exactFields(input, HTTP_PROOF.filter((field) => field !== "deviceSignature"), "Unsigned EVM Product Session HTTP proof");
  const value = Object.freeze({ version: literal(input.version, "1"), sessionId: token(input.sessionId, "sessionId"),
    challengeDigest: digest(input.challengeDigest), account: account(input.account), origin: literal(origin(input.origin), EVM_PRODUCT_SESSION_ORIGIN),
    scope: literal(input.scope, EVM_PRODUCT_SESSION_SCOPE), method: method(input.method), target: target(input.target),
    bodyDigest: digest(input.bodyDigest), nonce: token(input.nonce, "nonce"),
    issuedAt: time(input.issuedAt, "issuedAt"), expiresAt: time(input.expiresAt, "expiresAt") });
  if (Date.parse(value.expiresAt) <= Date.parse(value.issuedAt) || Date.parse(value.expiresAt) - Date.parse(value.issuedAt) > EVM_PRODUCT_SESSION_PROOF_MAX_LIFETIME_MS) fail("INVALID_EXPIRY", "HTTP proof lifetime is invalid");
  return value;
}
function unsignedProof(value) { const { deviceSignature: _signature, ...unsigned } = value; return unsigned; }
function challengeDigest(value) { return digestHex("YNX_EVM_PRODUCT_SESSION_CHALLENGE_V1", value); }
function verifyDevice(signed, message, key) {
  let valid = false;
  try { valid = p256.verify(decodeBase64url(signed, "deviceSignature"), utf8ToBytes(message), decodeBase64url(key, "deviceKey"), { format: "der", lowS: false }); } catch { valid = false; }
  if (!valid) fail("INVALID_DEVICE_PROOF", "P-256 device signature does not match bound key");
}
function deviceSecret(input, key) {
  const secret = decodeBase64url(input, "deviceSecret");
  if (secret.length !== 32 || encodeBase64url(p256.getPublicKey(secret, true)) !== key) fail("DEVICE_CHANGED", "Device key changed");
  return secret;
}
function deviceSignature(value) {
  const bytes = decodeBase64url(value, "deviceSignature");
  if (bytes.length < 68 || bytes.length > 72 || encodeBase64url(bytes) !== value) fail("INVALID_DEVICE_PROOF", "Device signature is invalid");
  return value;
}
function normalizeSignerSignature(value) {
  const bytes = decodeBase64url(value, "deviceSignature");
  if (bytes.length === 64) {
    try { return encodeBase64url(p256.Signature.fromBytes(bytes, "compact").toBytes("der")); }
    catch { fail("INVALID_DEVICE_PROOF", "Browser P-256 signature is invalid"); }
  }
  return deviceSignature(value);
}
function deviceKey(value) {
  const bytes = decodeBase64url(value, "deviceKey");
  if (bytes.length !== 33 || ![2, 3].includes(bytes[0]) || encodeBase64url(bytes) !== value) fail("INVALID_DEVICE", "P-256 device key is invalid");
  try { p256.Point.fromBytes(bytes); } catch { fail("INVALID_DEVICE", "P-256 device key is invalid"); }
  return value;
}
function account(value) { return pattern(value, "account", /^0x[0-9a-f]{40}$/); }
function origin(value) {
  const text = pattern(value, "origin", /^https:\/\/[^\s/?#]+$/);
  let parsed; try { parsed = new URL(text); } catch { fail("INVALID_ORIGIN", "Origin is invalid"); }
  if (parsed.origin !== text || parsed.username || parsed.password) fail("INVALID_ORIGIN", "Origin is non-canonical");
  return text;
}
function callback(value) {
  const text = pattern(value, "callback", /^https:\/\/[^\s#]+$/);
  let parsed; try { parsed = new URL(text); } catch { fail("INVALID_CALLBACK", "Callback is invalid"); }
  if (parsed.toString() !== text || parsed.username || parsed.password || parsed.hash) fail("INVALID_CALLBACK", "Callback is non-canonical");
  return text;
}
function method(value) { return pattern(value, "method", /^(GET|POST|PUT|PATCH|DELETE)$/); }
function target(value) {
  const text = pattern(value, "target", /^\/[A-Za-z0-9._~!$&'()*+,;=:@\/%?-]{1,512}$/);
  const [pathname, query, ...extra] = text.split("?");
  if (extra.length || pathname.includes("//") || pathname.endsWith("/") || query === "" || /%(?![0-9A-F]{2})/.test(text)) fail("INVALID_TARGET", "Request target is non-canonical");
  return text;
}
function digest(value) { return pattern(value, "digest", /^[0-9a-f]{64}$/); }
function token(value, label) { return pattern(value, label, /^[A-Za-z0-9_-]{32,64}$/); }
function time(value, label) {
  const text = pattern(value, label, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  if (!Number.isFinite(Date.parse(text)) || new Date(text).toISOString() !== text) fail("INVALID_TIME", `${label} is invalid`);
  return text;
}
function validDate(value) { if (!(value instanceof Date) || !Number.isFinite(value.getTime())) fail("INVALID_TIME", "Verification time is invalid"); return value; }
function literal(value, expected) { if (value !== expected) fail("INVALID_FIELD", "Protocol literal is invalid"); return expected; }
function signature(value) { return pattern(value, "walletSignature", /^0x[0-9a-fA-F]{130}$/); }
function pattern(value, label, regex) { if (typeof value !== "string" || value.trim() !== value || !regex.test(value)) fail("INVALID_FIELD", `${label} is invalid`); return value; }
function fail(code, message) { throw new WalletAuthError(code, message); }
