import { p256 } from "@noble/curves/nist.js";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import { canonicalJSON, digestHex, exactFields, WalletAuthError } from "./canonical.js";
import { decodeBase64url, encodeBase64url } from "./base64url.js";
import { walletIdentity, walletIdentityFromPublicKey } from "./crypto.js";
import { parseProductSessionRegistry, productPlatformBinding, PRODUCT_SESSION_PLATFORMS } from "./product-session-registry.js";

export const PRODUCT_SESSION_PROTOCOL_VERSION = "2";
export const PRODUCT_SESSION_AUTHORITY_SCHEMA_VERSION = 2;
const REQUEST_MAX_LIFETIME_MS = 5 * 60_000;
const CHALLENGE_MAX_LIFETIME_MS = 60_000;

const REQUEST_FIELDS = [
  "version", "chainId", "productId", "clientId", "platform", "applicationId", "bundleId", "packageId", "origin", "callback",
  "deviceId", "deviceAlgorithm", "deviceKey", "nonce", "state", "scopes", "purpose", "issuedAt", "expiresAt",
];
const APPROVAL_FIELDS = [
  "version", "result", "requestDigest", "chainId", "productId", "clientId", "platform", "applicationId", "bundleId", "packageId",
  "origin", "callback", "deviceId", "deviceAlgorithm", "deviceKey", "nonce", "state", "account",
  "accountPublicKey", "scopes", "issuedAt", "expiresAt", "walletSignature",
];
const CHALLENGE_FIELDS = [
  "version", "challenge", "requestDigest", "approvalDigest", "chainId", "productId", "clientId", "platform",
  "applicationId", "bundleId", "packageId", "origin", "callback", "deviceId", "deviceAlgorithm", "deviceKey", "nonce", "state",
  "account", "scopes", "issuedAt", "expiresAt", "sessionExpiresAt",
];
const COMPLETION_FIELDS = ["challenge", "deviceSignature"];
const SESSION_FIELDS = [
  "version", "sessionBinding", "chainId", "productId", "clientId", "platform", "applicationId", "bundleId", "packageId", "origin",
  "callback", "account", "deviceId", "deviceAlgorithm", "deviceKey", "deviceBinding", "nonce", "state",
  "scopes", "requestDigest", "approvalDigest", "issuedAt", "expiresAt",
];
const SNAPSHOT_FIELDS = ["schemaVersion", "sessions", "issuedChallenges", "consumedNonces", "consumedStates", "consumedRequests", "consumedChallenges", "revokedSessions", "revokedDevices", "revokedAccounts"];

export function createProductSessionRequest(registryInput, input, at = new Date()) {
  exactFields(input, ["productId", "platform", "deviceId", "deviceKey", "scopes", "purpose", "nonce", "state"], "Product Session request input");
  const binding = productPlatformBinding(registryInput, input.productId, input.platform);
  const now = validDate(at);
  const request = {
    version: PRODUCT_SESSION_PROTOCOL_VERSION,
    chainId: binding.chainId,
    productId: binding.productId,
    clientId: binding.clientId,
    platform: binding.platform,
    applicationId: binding.applicationId,
    bundleId: binding.bundleId,
    packageId: binding.packageId,
    origin: binding.origin,
    callback: binding.callback,
    deviceId: opaque(input.deviceId, "deviceId"),
    deviceAlgorithm: "p256-sha256",
    deviceKey: deviceKey(input.deviceKey),
    nonce: token(input.nonce, "nonce"),
    state: token(input.state, "state"),
    scopes: scopes(input.scopes, binding.scopes),
    purpose: text(input.purpose, "purpose", 1, 180),
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + REQUEST_MAX_LIFETIME_MS).toISOString(),
  };
  return parseProductSessionRequest(registryInput, request, now);
}

export function migrateLegacyProductSessionRequest(registryInput, legacy, context, at = new Date()) {
  exactFields(legacy, ["version", "nonce", "chainId", "requestingProduct", "productClientId", "bundleId", "productDeviceAlgorithm", "productDeviceKey", "callback", "scopes", "purpose", "issuedAt", "expiresAt"], "Legacy Wallet authorization request");
  exactFields(context, ["productId", "platform", "deviceId", "state"], "Legacy Product Session migration context");
  const registry = parseProductSessionRegistry(registryInput);
  const binding = productPlatformBinding(registry, context.productId, context.platform);
  const product = registry.products.find((item) => item.productId === context.productId);
  if (legacy.version !== "1" || legacy.chainId !== binding.chainId || legacy.productClientId !== binding.clientId || ![product.productId, `ynx-${product.productId}`].includes(legacy.requestingProduct)) fail("LEGACY_BINDING_MISMATCH", "Legacy request product or chain is not registered");
  if (legacy.bundleId !== product.applicationId || !product.legacyCallbacks.includes(legacy.callback) || legacy.productDeviceAlgorithm !== "p256-sha256") fail("LEGACY_BINDING_MISMATCH", "Legacy request bundle, callback or device algorithm is not registered");
  const issuedAt = time(legacy.issuedAt, "issuedAt"), expiresAt = time(legacy.expiresAt, "expiresAt");
  const now = validDate(at);
  if (issuedAt > now.toISOString() || expiresAt <= now.toISOString() || Date.parse(expiresAt) - Date.parse(issuedAt) > REQUEST_MAX_LIFETIME_MS) fail("SESSION_EXPIRED", "Legacy request is expired or outside migration policy");
  const migrated = createProductSessionRequest(registry, {
    productId: context.productId, platform: context.platform, deviceId: context.deviceId,
    deviceKey: legacy.productDeviceKey, scopes: legacy.scopes, purpose: legacy.purpose,
    nonce: legacy.nonce, state: context.state,
  }, new Date(issuedAt));
  return parseProductSessionRequest(registry, { ...migrated, expiresAt }, now);
}

export function parseProductSessionRequest(registryInput, input, at = new Date()) {
  exactFields(input, REQUEST_FIELDS, "Product Session request");
  const now = validDate(at);
  if (input.version !== PRODUCT_SESSION_PROTOCOL_VERSION || input.chainId !== "ynx_6423-1" || !PRODUCT_SESSION_PLATFORMS.includes(input.platform)) fail("INVALID_SESSION_REQUEST", "Product Session protocol, chain or platform is unsupported");
  const binding = productPlatformBinding(registryInput, input.productId, input.platform);
  const request = Object.freeze({
    version: input.version,
    chainId: input.chainId,
    productId: pattern(input.productId, "productId", /^[a-z][a-z0-9-]{1,31}$/),
    clientId: pattern(input.clientId, "clientId", /^[a-z][a-z0-9._-]{2,63}$/),
    platform: input.platform,
    applicationId: pattern(input.applicationId, "applicationId", /^[A-Za-z][A-Za-z0-9.-]{2,131}$/),
    bundleId: platformIdentity(input.bundleId, "bundleId"),
    packageId: platformIdentity(input.packageId, "packageId"),
    origin: canonicalOrigin(input.origin),
    callback: canonicalCallback(input.callback),
    deviceId: opaque(input.deviceId, "deviceId"),
    deviceAlgorithm: pattern(input.deviceAlgorithm, "deviceAlgorithm", /^p256-sha256$/),
    deviceKey: deviceKey(input.deviceKey),
    nonce: token(input.nonce, "nonce"),
    state: token(input.state, "state"),
    scopes: Object.freeze(scopes(input.scopes, binding.scopes)),
    purpose: text(input.purpose, "purpose", 1, 180),
    issuedAt: time(input.issuedAt, "issuedAt"),
    expiresAt: time(input.expiresAt, "expiresAt"),
  });
  validatePlatformIdentifiers(request);
  for (const field of ["chainId", "productId", "clientId", "platform", "applicationId", "bundleId", "packageId", "origin", "callback"]) {
    if (request[field] !== binding[field]) fail("SESSION_BINDING_MISMATCH", `Product Session request ${field} does not match the registry`);
  }
  const issued = Date.parse(request.issuedAt), expires = Date.parse(request.expiresAt);
  if (expires <= issued || expires - issued > REQUEST_MAX_LIFETIME_MS) fail("INVALID_EXPIRY", "Product Session request lifetime is invalid");
  if (issued > now.getTime() + 30_000) fail("ISSUED_IN_FUTURE", "Product Session request was issued in the future");
  if (expires <= now.getTime()) fail("SESSION_EXPIRED", "Product Session request expired");
  return request;
}

export function productSessionRequestDigest(registryInput, request, at = new Date()) {
  return digestHex("YNX_PRODUCT_SESSION_REQUEST_V2", parseProductSessionRequest(registryInput, request, at));
}

export function signProductSessionApproval(registryInput, requestInput, input, at = new Date()) {
  exactFields(input, ["accountSecret", "scopes", "expiresAt"], "Product Session approval input");
  const request = parseProductSessionRequest(registryInput, requestInput, at);
  const secret = accountSecret(input.accountSecret);
  const identity = walletIdentity(input.accountSecret);
  const granted = scopes(input.scopes, request.scopes);
  if (granted.join("\n") !== request.scopes.join("\n")) fail("SCOPE_WIDENING", "Wallet approval scopes must exactly match the requested least-privilege scopes");
  const expiresAt = time(input.expiresAt, "expiresAt");
  if (expiresAt > request.expiresAt || expiresAt <= validDate(at).toISOString()) fail("INVALID_EXPIRY", "Wallet approval expiry is outside the request lifetime");
  const unsigned = {
    version: PRODUCT_SESSION_PROTOCOL_VERSION,
    result: "approved",
    requestDigest: productSessionRequestDigest(registryInput, request, at),
    chainId: request.chainId,
    productId: request.productId,
    clientId: request.clientId,
    platform: request.platform,
    applicationId: request.applicationId,
    bundleId: request.bundleId,
    packageId: request.packageId,
    origin: request.origin,
    callback: request.callback,
    deviceId: request.deviceId,
    deviceAlgorithm: request.deviceAlgorithm,
    deviceKey: request.deviceKey,
    nonce: request.nonce,
    state: request.state,
    account: identity.account,
    accountPublicKey: identity.accountPublicKey,
    scopes: request.scopes,
    issuedAt: validDate(at).toISOString(),
    expiresAt,
  };
  const signature = secp256k1.sign(sha256(utf8ToBytes(approvalSignBytes(unsigned))), secret, { prehash: false, format: "compact", lowS: true });
  return parseProductSessionApproval(registryInput, request, { ...unsigned, walletSignature: bytesToHex(signature) }, at);
}

export function parseProductSessionApproval(registryInput, requestInput, input, at = new Date()) {
  const request = parseProductSessionRequest(registryInput, requestInput, at);
  exactFields(input, APPROVAL_FIELDS, "Product Session approval");
  const approval = Object.freeze({
    ...input,
    version: pattern(input.version, "version", /^2$/),
    result: pattern(input.result, "result", /^approved$/),
    requestDigest: digest(input.requestDigest, "requestDigest"),
    productId: pattern(input.productId, "productId", /^[a-z][a-z0-9-]{1,31}$/),
    clientId: pattern(input.clientId, "clientId", /^[a-z][a-z0-9._-]{2,63}$/),
    applicationId: pattern(input.applicationId, "applicationId", /^[A-Za-z][A-Za-z0-9.-]{2,131}$/),
    bundleId: platformIdentity(input.bundleId, "bundleId"),
    packageId: platformIdentity(input.packageId, "packageId"),
    origin: canonicalOrigin(input.origin), callback: canonicalCallback(input.callback),
    deviceId: opaque(input.deviceId, "deviceId"), deviceAlgorithm: pattern(input.deviceAlgorithm, "deviceAlgorithm", /^p256-sha256$/), deviceKey: deviceKey(input.deviceKey),
    nonce: token(input.nonce, "nonce"), state: token(input.state, "state"),
    account: pattern(input.account, "account", /^ynx1[023456789acdefghjklmnpqrstuvwxyz]{38}$/),
    accountPublicKey: pattern(input.accountPublicKey, "accountPublicKey", /^(02|03)[0-9a-f]{64}$/),
    scopes: Object.freeze(scopes(input.scopes, request.scopes)),
    issuedAt: time(input.issuedAt, "issuedAt"), expiresAt: time(input.expiresAt, "expiresAt"),
    walletSignature: pattern(input.walletSignature, "walletSignature", /^[0-9a-f]{128}$/),
  });
  validatePlatformIdentifiers(approval);
  const boundFields = ["chainId", "productId", "clientId", "platform", "applicationId", "bundleId", "packageId", "origin", "callback", "deviceId", "deviceAlgorithm", "deviceKey", "nonce", "state"];
  if (approval.requestDigest !== productSessionRequestDigest(registryInput, request, at) || boundFields.some((field) => approval[field] !== request[field]) || approval.scopes.join("\n") !== request.scopes.join("\n")) fail("SESSION_BINDING_MISMATCH", "Wallet approval does not match the exact Product Session request");
  if (approval.issuedAt < request.issuedAt || approval.issuedAt > validDate(at).toISOString() || approval.expiresAt > request.expiresAt || approval.expiresAt <= validDate(at).toISOString()) fail("INVALID_APPROVAL_TIME", "Wallet approval is outside the request lifetime");
  let valid = false;
  try { valid = secp256k1.verify(hexToBytes(approval.walletSignature), sha256(utf8ToBytes(approvalSignBytes(unsignedApproval(approval)))), hexToBytes(approval.accountPublicKey), { prehash: false, format: "compact", lowS: true }); } catch { valid = false; }
  if (!valid || walletIdentityFromPublicKey(approval.accountPublicKey) !== approval.account) fail("INVALID_SIGNATURE", "Wallet approval signature is invalid");
  return approval;
}

export function createProductSessionChallenge(registryInput, requestInput, approvalInput, input, at = new Date()) {
  exactFields(input, ["challenge"], "Product Session challenge input");
  const request = parseProductSessionRequest(registryInput, requestInput, at);
  const approval = parseProductSessionApproval(registryInput, request, approvalInput, at);
  const binding = productPlatformBinding(registryInput, request.productId, request.platform);
  const now = validDate(at);
  const expiresAt = new Date(Math.min(now.getTime() + CHALLENGE_MAX_LIFETIME_MS, Date.parse(approval.expiresAt))).toISOString();
  const sessionExpiresAt = new Date(Math.min(Date.parse(approval.expiresAt), now.getTime() + binding.sessionDurationSeconds * 1000)).toISOString();
  return parseChallenge({
    version: PRODUCT_SESSION_PROTOCOL_VERSION, challenge: token(input.challenge, "challenge"),
    requestDigest: approval.requestDigest, approvalDigest: productSessionApprovalDigest(approval),
    chainId: request.chainId, productId: request.productId, clientId: request.clientId, platform: request.platform,
    applicationId: request.applicationId, bundleId: request.bundleId, packageId: request.packageId,
    origin: request.origin, callback: request.callback, deviceId: request.deviceId,
    deviceAlgorithm: request.deviceAlgorithm, deviceKey: request.deviceKey, nonce: request.nonce, state: request.state,
    account: approval.account, scopes: approval.scopes, issuedAt: now.toISOString(), expiresAt, sessionExpiresAt,
  });
}

export function signProductSessionChallenge(challengeInput, deviceSecretInput) {
  const challenge = parseChallenge(challengeInput);
  const secret = deviceSecret(deviceSecretInput);
  if (encodeBase64url(p256.getPublicKey(secret, true)) !== challenge.deviceKey) fail("DEVICE_CHANGED", "Product device key changed before session completion");
  const signature = p256.sign(utf8ToBytes(challengeSignBytes(challenge)), secret, { format: "der" });
  return Object.freeze({ challenge, deviceSignature: encodeBase64url(signature) });
}

export async function signProductSessionChallengeWith(challengeInput, signer) {
  const challenge = parseChallenge(challengeInput);
  if (typeof signer !== "function") fail("INVALID_DEVICE", "Product Session requires a platform device signer");
  const payload = encodeBase64url(utf8ToBytes(challengeSignBytes(challenge)));
  let deviceSignature;
  try { deviceSignature = await signer(Object.freeze({ purpose: "challenge", algorithm: "p256-sha256", deviceKey: challenge.deviceKey, payload })); }
  catch { fail("DEVICE_SIGNING_FAILED", "Platform device signing failed closed"); }
  if (typeof deviceSignature !== "string") fail("INVALID_DEVICE_PROOF", "Platform device signature is invalid");
  let valid = false;
  try { valid = p256.verify(decodeBase64url(deviceSignature, "deviceSignature"), decodeBase64url(payload, "device signing payload"), decodeBase64url(challenge.deviceKey, "deviceKey"), { format: "der", lowS: false }); } catch { valid = false; }
  if (!valid) fail("INVALID_DEVICE_PROOF", "Platform device signature does not match the registered device key");
  return Object.freeze({ challenge, deviceSignature });
}

export function parseProductSessionChallenge(input) { return parseChallenge(input); }

export class ProductSessionAuthority {
  #registry;
  #state;
  constructor(registryInput, snapshot = emptySnapshot()) {
    this.#registry = parseProductSessionRegistry(registryInput);
    this.#state = applyRegistryRetirements(this.#registry, parseSnapshot(snapshot));
  }

  issueChallenge(input, at = new Date()) {
    exactFields(input, ["request", "approval", "challenge"], "Product Session challenge issuance");
    const request = parseProductSessionRequest(this.#registry, input.request, at);
    const approval = parseProductSessionApproval(this.#registry, request, input.approval, at);
    const challenge = createProductSessionChallenge(this.#registry, request, approval, { challenge: input.challenge }, at);
    if (this.#state.issuedChallenges.some((item) => item.challenge === challenge.challenge) || this.#state.consumedChallenges.includes(challenge.challenge)) fail("REPLAY", "Product Session challenge already exists");
    const next = clone(this.#state); next.issuedChallenges.push(challenge); sortSnapshot(next); this.#state = parseSnapshot(next); return challenge;
  }

  complete(input, at = new Date()) {
    exactFields(input, ["request", "approval", "completion"], "Product Session completion");
    const request = parseProductSessionRequest(this.#registry, input.request, at);
    const approval = parseProductSessionApproval(this.#registry, request, input.approval, at);
    exactFields(input.completion, COMPLETION_FIELDS, "Product Session device completion");
    const challenge = parseChallenge(input.completion.challenge);
    const expected = createProductSessionChallenge(this.#registry, request, approval, { challenge: challenge.challenge }, new Date(challenge.issuedAt));
    if (canonicalJSON(challenge) !== canonicalJSON(expected)) fail("SESSION_BINDING_MISMATCH", "Gateway challenge fields were substituted");
    const issued = this.#state.issuedChallenges.find((item) => item.challenge === challenge.challenge);
    if (!issued || canonicalJSON(issued) !== canonicalJSON(challenge)) fail("CHALLENGE_NOT_ISSUED", "Product Session challenge was not issued by this Gateway");
    if (challenge.expiresAt <= validDate(at).toISOString()) fail("SESSION_EXPIRED", "Product Session challenge expired");
    let valid = false;
    try { valid = p256.verify(decodeBase64url(input.completion.deviceSignature, "deviceSignature"), utf8ToBytes(challengeSignBytes(challenge)), decodeBase64url(challenge.deviceKey, "deviceKey"), { format: "der", lowS: false }); } catch { valid = false; }
    if (!valid) fail("INVALID_DEVICE_PROOF", "Product Session device proof is invalid");
    if (this.#state.consumedNonces.includes(request.nonce) || this.#state.consumedStates.includes(request.state) || this.#state.consumedRequests.includes(approval.requestDigest) || this.#state.consumedChallenges.includes(challenge.challenge)) fail("REPLAY", "Product Session request, state or challenge was already consumed");
    const session = parseSession({
      version: PRODUCT_SESSION_PROTOCOL_VERSION,
      sessionBinding: digestHex("YNX_PRODUCT_SESSION_BINDING_V2", challenge),
      chainId: request.chainId, productId: request.productId, clientId: request.clientId, platform: request.platform,
      applicationId: request.applicationId, bundleId: request.bundleId, packageId: request.packageId,
      origin: request.origin, callback: request.callback, account: approval.account,
      deviceId: request.deviceId, deviceAlgorithm: request.deviceAlgorithm, deviceKey: request.deviceKey,
      deviceBinding: deviceBinding(request, approval.account), nonce: request.nonce, state: request.state,
      scopes: approval.scopes, requestDigest: approval.requestDigest, approvalDigest: challenge.approvalDigest,
      issuedAt: challenge.issuedAt, expiresAt: challenge.sessionExpiresAt,
    });
    const next = clone(this.#state);
    next.issuedChallenges = next.issuedChallenges.filter((item) => item.challenge !== challenge.challenge);
    next.sessions.push(session); next.consumedNonces.push(request.nonce); next.consumedStates.push(request.state); next.consumedRequests.push(approval.requestDigest); next.consumedChallenges.push(challenge.challenge);
    sortSnapshot(next); this.#state = parseSnapshot(next); return session;
  }

  introspect(sessionBindingInput, context, at = new Date()) {
    exactFields(context, ["chainId", "productId", "clientId", "platform", "applicationId", "bundleId", "packageId", "origin", "callback", "account", "deviceId", "deviceKey", "requiredScopes"], "Product Session introspection context");
    const session = this.#state.sessions.find((item) => item.sessionBinding === digest(sessionBindingInput, "sessionBinding"));
    if (!session) fail("SESSION_NOT_FOUND", "Product Session was not found");
    const now = validDate(at).toISOString();
    if (session.issuedAt > now) fail("ISSUED_IN_FUTURE", "Product Session was issued in the future");
    if (session.expiresAt <= now) fail("SESSION_EXPIRED", "Product Session expired");
    if (this.#state.revokedSessions.includes(session.sessionBinding) || this.#state.revokedDevices.includes(session.deviceBinding) || this.#state.revokedAccounts.some((item) => item.account === session.account && session.issuedAt <= item.before)) fail("SESSION_REVOKED", "Product Session was revoked");
    validatePlatformIdentifiers(context, "CROSS_PRODUCT_SESSION");
    const exact = ["chainId", "productId", "clientId", "platform", "applicationId", "bundleId", "packageId", "origin", "callback", "account", "deviceId", "deviceKey"];
    if (exact.some((field) => context[field] !== session[field])) fail("CROSS_PRODUCT_SESSION", "Product Session cannot cross product, account, origin, callback or device boundaries");
    const required = requiredScopes(context.requiredScopes, session.scopes);
    if (required.some((scope) => !session.scopes.includes(scope))) fail("SCOPE_WIDENING", "Product Session scope cannot be widened");
    return Object.freeze({ active: true, session });
  }

  revokeSession(sessionBindingInput) { const value = digest(sessionBindingInput, "sessionBinding"); if (!this.#state.sessions.some((item) => item.sessionBinding === value)) fail("SESSION_NOT_FOUND", "Product Session was not found"); this.#revoke("revokedSessions", value); return value; }
  revokeDevice(deviceBindingInput) { const value = digest(deviceBindingInput, "deviceBinding"); this.#revoke("revokedDevices", value); return value; }
  revokeAccount(account, at = new Date()) { const record = { account: pattern(account, "account", /^ynx1[023456789acdefghjklmnpqrstuvwxyz]{38}$/), before: validDate(at).toISOString() }; const next = clone(this.#state); next.revokedAccounts = next.revokedAccounts.filter((item) => item.account !== record.account); next.revokedAccounts.push(record); sortSnapshot(next); this.#state = parseSnapshot(next); return Object.freeze(record); }
  snapshot() { return freezeSnapshot(clone(this.#state)); }
  #revoke(field, value) { if (this.#state[field].includes(value)) fail("ALREADY_REVOKED", "Product Session revocation already exists"); const next = clone(this.#state); next[field].push(value); sortSnapshot(next); this.#state = parseSnapshot(next); }
}

export function parseProductSession(input) { return parseSession(input); }
export function parseProductSessionAuthoritySnapshot(input) { return parseSnapshot(input); }
export function productSessionApprovalDigest(approval) { return digestHex("YNX_PRODUCT_SESSION_APPROVAL_V2", approval); }
export function deviceBinding(requestOrSession, account) { return digestHex("YNX_PRODUCT_SESSION_DEVICE_V2", { chainId: requestOrSession.chainId, productId: requestOrSession.productId, clientId: requestOrSession.clientId, platform: requestOrSession.platform, applicationId: requestOrSession.applicationId, bundleId: requestOrSession.bundleId, packageId: requestOrSession.packageId, origin: requestOrSession.origin, callback: requestOrSession.callback, account, deviceId: requestOrSession.deviceId, deviceAlgorithm: requestOrSession.deviceAlgorithm, deviceKey: requestOrSession.deviceKey }); }

function parseChallenge(input) {
  exactFields(input, CHALLENGE_FIELDS, "Product Session challenge");
  const value = Object.freeze({ ...input, version: pattern(input.version, "version", /^2$/), challenge: token(input.challenge, "challenge"), requestDigest: digest(input.requestDigest, "requestDigest"), approvalDigest: digest(input.approvalDigest, "approvalDigest"), chainId: pattern(input.chainId, "chainId", /^ynx_6423-1$/), productId: pattern(input.productId, "productId", /^[a-z][a-z0-9-]{1,31}$/), clientId: pattern(input.clientId, "clientId", /^[a-z][a-z0-9._-]{2,63}$/), platform: pattern(input.platform, "platform", /^(android|ios|macos|web|windows)$/), applicationId: pattern(input.applicationId, "applicationId", /^[A-Za-z][A-Za-z0-9.-]{2,131}$/), bundleId: platformIdentity(input.bundleId, "bundleId"), packageId: platformIdentity(input.packageId, "packageId"), origin: canonicalOrigin(input.origin), callback: canonicalCallback(input.callback), deviceId: opaque(input.deviceId, "deviceId"), deviceAlgorithm: pattern(input.deviceAlgorithm, "deviceAlgorithm", /^p256-sha256$/), deviceKey: deviceKey(input.deviceKey), nonce: token(input.nonce, "nonce"), state: token(input.state, "state"), account: pattern(input.account, "account", /^ynx1[023456789acdefghjklmnpqrstuvwxyz]{38}$/), scopes: Object.freeze(scopes(input.scopes, input.scopes)), issuedAt: time(input.issuedAt, "issuedAt"), expiresAt: time(input.expiresAt, "expiresAt"), sessionExpiresAt: time(input.sessionExpiresAt, "sessionExpiresAt") });
  validatePlatformIdentifiers(value);
  if (value.expiresAt <= value.issuedAt || Date.parse(value.expiresAt) - Date.parse(value.issuedAt) > CHALLENGE_MAX_LIFETIME_MS || value.sessionExpiresAt < value.expiresAt || Date.parse(value.sessionExpiresAt) - Date.parse(value.issuedAt) > REQUEST_MAX_LIFETIME_MS) fail("INVALID_EXPIRY", "Product Session challenge or session lifetime is invalid");
  return value;
}
function parseSession(input) { exactFields(input, SESSION_FIELDS, "Product Session"); const value = Object.freeze({ ...input, version: pattern(input.version, "version", /^2$/), sessionBinding: digest(input.sessionBinding, "sessionBinding"), chainId: pattern(input.chainId, "chainId", /^ynx_6423-1$/), productId: pattern(input.productId, "productId", /^[a-z][a-z0-9-]{1,31}$/), clientId: pattern(input.clientId, "clientId", /^[a-z][a-z0-9._-]{2,63}$/), platform: pattern(input.platform, "platform", /^(android|ios|macos|web|windows)$/), applicationId: pattern(input.applicationId, "applicationId", /^[A-Za-z][A-Za-z0-9.-]{2,131}$/), bundleId: platformIdentity(input.bundleId, "bundleId"), packageId: platformIdentity(input.packageId, "packageId"), origin: canonicalOrigin(input.origin), callback: canonicalCallback(input.callback), account: pattern(input.account, "account", /^ynx1[023456789acdefghjklmnpqrstuvwxyz]{38}$/), deviceId: opaque(input.deviceId, "deviceId"), deviceAlgorithm: pattern(input.deviceAlgorithm, "deviceAlgorithm", /^p256-sha256$/), deviceKey: deviceKey(input.deviceKey), deviceBinding: digest(input.deviceBinding, "deviceBinding"), nonce: token(input.nonce, "nonce"), state: token(input.state, "state"), scopes: Object.freeze(scopes(input.scopes, input.scopes)), requestDigest: digest(input.requestDigest, "requestDigest"), approvalDigest: digest(input.approvalDigest, "approvalDigest"), issuedAt: time(input.issuedAt, "issuedAt"), expiresAt: time(input.expiresAt, "expiresAt") }); validatePlatformIdentifiers(value); if (value.expiresAt <= value.issuedAt || value.deviceBinding !== deviceBinding(value, value.account)) fail("INVALID_SESSION", "Product Session security binding or lifetime is invalid"); return value; }
function applyRegistryRetirements(registry, snapshot) {
  const next = clone(snapshot);
  const retired = (item) => {
    const product = registry.products.find((candidate) => candidate.productId === item.productId && candidate.clientId === item.clientId);
    return product?.retiredClients.some((client) => client.platform === item.platform && client.applicationId === item.applicationId && client.callback === item.callback) === true;
  };
  for (const session of next.sessions.filter(retired)) {
    if (!next.revokedSessions.includes(session.sessionBinding)) next.revokedSessions.push(session.sessionBinding);
    if (!next.revokedDevices.includes(session.deviceBinding)) next.revokedDevices.push(session.deviceBinding);
  }
  next.issuedChallenges = next.issuedChallenges.filter((challenge) => !retired(challenge));
  sortSnapshot(next);
  return parseSnapshot(next);
}
function parseSnapshot(input) { exactFields(input, SNAPSHOT_FIELDS, "Product Session authority snapshot"); if (input.schemaVersion !== PRODUCT_SESSION_AUTHORITY_SCHEMA_VERSION) fail("INVALID_SESSION_STORE", "Product Session authority snapshot version is unsupported"); const value = { schemaVersion: input.schemaVersion, sessions: sortedUnique(input.sessions.map(parseSession), (item) => item.sessionBinding, "sessions"), issuedChallenges: sortedUnique(input.issuedChallenges.map(parseChallenge), (item) => item.challenge, "issuedChallenges"), consumedNonces: stringSet(input.consumedNonces, /^[A-Za-z0-9_-]{32,64}$/, "consumedNonces"), consumedStates: stringSet(input.consumedStates, /^[A-Za-z0-9_-]{32,64}$/, "consumedStates"), consumedRequests: stringSet(input.consumedRequests, /^[0-9a-f]{64}$/, "consumedRequests"), consumedChallenges: stringSet(input.consumedChallenges, /^[A-Za-z0-9_-]{32,64}$/, "consumedChallenges"), revokedSessions: stringSet(input.revokedSessions, /^[0-9a-f]{64}$/, "revokedSessions"), revokedDevices: stringSet(input.revokedDevices, /^[0-9a-f]{64}$/, "revokedDevices"), revokedAccounts: sortedUnique(input.revokedAccounts.map((item) => { exactFields(item, ["account", "before"], "revoked account"); return Object.freeze({ account: pattern(item.account, "account", /^ynx1[023456789acdefghjklmnpqrstuvwxyz]{38}$/), before: time(item.before, "before") }); }), (item) => item.account, "revokedAccounts") }; if (value.sessions.length !== value.consumedNonces.length || value.sessions.length !== value.consumedStates.length || value.sessions.length !== value.consumedRequests.length || value.sessions.length !== value.consumedChallenges.length || value.issuedChallenges.some((item) => value.consumedChallenges.includes(item.challenge))) fail("INVALID_SESSION_STORE", "Issued and consumed records must exactly cover Product Sessions without overlap"); return freezeSnapshot(value); }
function emptySnapshot() { return { schemaVersion: PRODUCT_SESSION_AUTHORITY_SCHEMA_VERSION, sessions: [], issuedChallenges: [], consumedNonces: [], consumedStates: [], consumedRequests: [], consumedChallenges: [], revokedSessions: [], revokedDevices: [], revokedAccounts: [] }; }
function sortSnapshot(value) { value.sessions.sort((a, b) => a.sessionBinding.localeCompare(b.sessionBinding)); value.issuedChallenges.sort((a, b) => a.challenge.localeCompare(b.challenge)); for (const field of ["consumedNonces", "consumedStates", "consumedRequests", "consumedChallenges", "revokedSessions", "revokedDevices"]) value[field].sort(); value.revokedAccounts.sort((a, b) => a.account.localeCompare(b.account)); }
function freezeSnapshot(value) { return Object.freeze({ ...value, sessions: Object.freeze(value.sessions), issuedChallenges: Object.freeze(value.issuedChallenges), consumedNonces: Object.freeze(value.consumedNonces), consumedStates: Object.freeze(value.consumedStates), consumedRequests: Object.freeze(value.consumedRequests), consumedChallenges: Object.freeze(value.consumedChallenges), revokedSessions: Object.freeze(value.revokedSessions), revokedDevices: Object.freeze(value.revokedDevices), revokedAccounts: Object.freeze(value.revokedAccounts) }); }
function stringSet(value, regex, label) { if (!Array.isArray(value) || value.length > 10000 || value.some((item) => typeof item !== "string" || !regex.test(item))) fail("INVALID_SESSION_STORE", `${label} is invalid`); return sortedUnique(value, (item) => item, label); }
function sortedUnique(value, key, label) { const keys = value.map(key); if (new Set(keys).size !== keys.length || [...keys].sort().join("\n") !== keys.join("\n")) fail("INVALID_SESSION_STORE", `${label} must be unique and sorted`); return Object.freeze(value); }
function unsignedApproval(value) { const { walletSignature: _signature, ...unsigned } = value; return unsigned; }
function approvalSignBytes(value) { return `YNX_PRODUCT_SESSION_APPROVAL_V2\n${canonicalJSON(value)}`; }
function challengeSignBytes(value) { return `YNX_PRODUCT_SESSION_CHALLENGE_V2\n${canonicalJSON(value)}`; }
function scopes(value, allowlist) { if (!Array.isArray(value) || value.length < 1 || value.length > 8) fail("INVALID_SCOPES", "Product Session scopes are invalid"); const result = value.map((item) => pattern(item, "scope", /^[a-z][a-z0-9._:-]{1,63}$/)); if (new Set(result).size !== result.length || [...result].sort().join("\n") !== result.join("\n") || result.some((item) => !allowlist.includes(item))) fail("SCOPE_WIDENING", "Product Session scope is duplicated, unsorted or outside the registry"); return result; }
function requiredScopes(value, allowlist) { if (!Array.isArray(value) || value.length > 8) fail("INVALID_SCOPES", "Required Product Session scopes are invalid"); if (value.length === 0) return []; return scopes(value, allowlist); }
function platformIdentity(value, label) { return value === null ? null : pattern(value, label, /^[A-Za-z][A-Za-z0-9.-]{2,131}$/); }
function validatePlatformIdentifiers(value, errorCode = "SESSION_BINDING_MISMATCH") { const expectsBundle = value.platform === "ios" || value.platform === "macos"; const expectsPackage = value.platform === "android" || value.platform === "windows"; if ((value.bundleId !== null) !== expectsBundle || (value.packageId !== null) !== expectsPackage || (value.bundleId !== null && value.bundleId !== value.applicationId) || (value.packageId !== null && value.packageId !== value.applicationId)) fail(errorCode, "Product Session bundleId/packageId does not match its registered platform identity"); }
function canonicalOrigin(value) { const normalized = text(value, "origin", 8, 512); let parsed; try { parsed = new URL(normalized); } catch { fail("INVALID_ORIGIN", "Product Session origin is invalid"); } if (parsed.protocol === "https:" && parsed.origin === normalized && !parsed.port) return normalized; if (parsed.protocol === "app:" && /^app:\/\/(android|ios|macos|windows)\/[A-Za-z][A-Za-z0-9.-]{2,127}$/.test(normalized)) return normalized; fail("INVALID_ORIGIN", "Product Session origin must be an exact HTTPS or registered native origin"); }
function canonicalCallback(value) { const normalized = text(value, "callback", 8, 512); let parsed; try { parsed = new URL(normalized); } catch { fail("CALLBACK_MISMATCH", "Product Session callback is invalid"); } if (["data:", "file:", "http:", "javascript:"].includes(parsed.protocol) || parsed.username || parsed.password || parsed.hash || parsed.search || parsed.toString() !== normalized) fail("CALLBACK_MISMATCH", "Product Session callback is unsafe or non-canonical"); return normalized; }
function deviceKey(value) { const normalized = pattern(value, "deviceKey", /^[A-Za-z0-9_-]{44}$/); const bytes = decodeBase64url(normalized, "deviceKey"); if (bytes.length !== 33 || encodeBase64url(bytes) !== normalized) fail("INVALID_DEVICE_KEY", "Product Session device key is invalid"); try { p256.Point.fromBytes(bytes); } catch { fail("INVALID_DEVICE_KEY", "Product Session device key is not P-256"); } return normalized; }
function accountSecret(value) { if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) fail("INVALID_SECRET", "Wallet account secret is invalid"); const bytes = hexToBytes(value); if (!secp256k1.utils.isValidSecretKey(bytes)) fail("INVALID_SECRET", "Wallet account secret is outside secp256k1"); return bytes; }
function deviceSecret(value) { const bytes = decodeBase64url(value, "deviceSecret"); if (bytes.length !== 32 || !p256.utils.isValidSecretKey(bytes)) fail("INVALID_SECRET", "Product device secret is invalid"); return bytes; }
function token(value, label) { return pattern(value, label, /^[A-Za-z0-9_-]{32,64}$/); }
function opaque(value, label) { return pattern(value, label, /^[A-Za-z0-9._:-]{8,128}$/); }
function digest(value, label) { return pattern(value, label, /^[0-9a-f]{64}$/); }
function pattern(value, label, regex) { const normalized = text(value, label, 1, 512); if (!regex.test(normalized)) fail("INVALID_FIELD", `${label} is invalid`); return normalized; }
function text(value, label, minimum, maximum) { if (typeof value !== "string" || value.length < minimum || value.length > maximum || value.trim() !== value) fail("INVALID_FIELD", `${label} is invalid`); return value; }
function time(value, label) { const normalized = pattern(value, label, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/); if (!Number.isFinite(Date.parse(normalized)) || new Date(normalized).toISOString() !== normalized) fail("INVALID_TIME", `${label} is invalid`); return normalized; }
function validDate(value) { if (!(value instanceof Date) || !Number.isFinite(value.getTime())) fail("INVALID_TIME", "Product Session time is invalid"); return value; }
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function fail(code, message) { throw new WalletAuthError(code, message); }
