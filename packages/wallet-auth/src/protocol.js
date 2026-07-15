import { canonicalJSON, digestHex, exactFields, isPlainObject, WalletAuthError } from "./canonical.js";

export const WALLET_AUTH_VERSION = "1";
export const YNX_NATIVE_CHAIN_ID = "ynx_6423-1";
export const YNX_EVM_CHAIN_ID = 6423;
export const MAX_REQUEST_LIFETIME_MS = 5 * 60 * 1000;

const REQUEST_FIELDS = [
  "version", "nonce", "chainId", "requestingProduct", "productClientId", "bundleId",
  "productDeviceKey", "callback", "scopes", "purpose", "issuedAt", "expiresAt",
];
const RESPONSE_FIELDS = [
  "version", "requestDigest", "nonce", "chainId", "requestingProduct", "productClientId",
  "bundleId", "productDeviceKey", "callback", "account", "accountPublicKey", "grantedScopes",
  "purpose", "issuedAt", "expiresAt", "walletSignature",
];

export function parseAuthorizationRequest(input, options) {
  const raw = typeof input === "string" ? parseJSON(input) : input;
  exactFields(raw, REQUEST_FIELDS, "Wallet authorization request");
  const request = {
    version: requiredString(raw.version, "version", 4),
    nonce: requiredPattern(raw.nonce, "nonce", /^[A-Za-z0-9_-]{32,64}$/),
    chainId: requiredString(raw.chainId, "chainId", 32),
    requestingProduct: requiredPattern(raw.requestingProduct, "requestingProduct", /^[a-z][a-z0-9-]{1,31}$/),
    productClientId: requiredPattern(raw.productClientId, "productClientId", /^[a-z][a-z0-9._-]{2,63}$/),
    bundleId: requiredPattern(raw.bundleId, "bundleId", /^[A-Za-z][A-Za-z0-9.-]{2,127}$/),
    productDeviceKey: requiredPattern(raw.productDeviceKey, "productDeviceKey", /^[A-Za-z0-9_-]{43}$/),
    callback: strictURL(raw.callback, "callback"),
    scopes: strictScopes(raw.scopes),
    purpose: requiredString(raw.purpose, "purpose", 180),
    issuedAt: strictTime(raw.issuedAt, "issuedAt"),
    expiresAt: strictTime(raw.expiresAt, "expiresAt"),
  };
  const now = options?.now instanceof Date ? options.now : new Date();
  if (request.version !== WALLET_AUTH_VERSION) throw new WalletAuthError("UNSUPPORTED_VERSION", "Wallet authorization request version is unsupported");
  if (request.chainId !== YNX_NATIVE_CHAIN_ID) throw new WalletAuthError("WRONG_NETWORK", `Wallet authorization requires ${YNX_NATIVE_CHAIN_ID}`);
  const issued = Date.parse(request.issuedAt);
  const expires = Date.parse(request.expiresAt);
  if (expires <= issued || expires - issued > MAX_REQUEST_LIFETIME_MS) throw new WalletAuthError("INVALID_EXPIRY", "Wallet authorization expiry must be after issue time and no more than five minutes later");
  if (issued > now.getTime() + 30_000) throw new WalletAuthError("ISSUED_IN_FUTURE", "Wallet authorization request issue time is in the future");
  if (expires <= now.getTime()) throw new WalletAuthError("EXPIRED", "Wallet authorization request has expired");
  const binding = options?.registry?.[request.productClientId];
  if (!binding) throw new WalletAuthError("UNKNOWN_PRODUCT", "Requesting product client is not registered");
  if (binding.requestingProduct !== request.requestingProduct || binding.bundleId !== request.bundleId) throw new WalletAuthError("PRODUCT_MISMATCH", "Requesting product identity does not match its registered client");
  if (!binding.callbacks.includes(request.callback)) throw new WalletAuthError("CALLBACK_MISMATCH", "Callback is not registered for this exact product client");
  const allowed = new Set(binding.scopes);
  if (request.scopes.some((scope) => !allowed.has(scope))) throw new WalletAuthError("SCOPE_NOT_ALLOWED", "Request contains a scope outside the product allowlist");
  if (request.scopes.length > (binding.maxScopes ?? binding.scopes.length)) throw new WalletAuthError("SCOPE_TOO_BROAD", "Request contains too many scopes");
  return Object.freeze({ ...request, scopes: Object.freeze([...request.scopes]) });
}

export function requestDigest(request) {
  exactFields(request, REQUEST_FIELDS, "Wallet authorization request");
  return digestHex("YNX_WALLET_AUTH_REQUEST_V1", request);
}

export function createApprovalPayload(request, approval) {
  const account = requiredPattern(approval.account, "account", /^ynx1[023456789acdefghjklmnpqrstuvwxyz]{38}$/);
  const accountPublicKey = requiredPattern(approval.accountPublicKey, "accountPublicKey", /^(02|03)[0-9a-f]{64}$/);
  const issuedAt = strictTime(approval.issuedAt, "issuedAt");
  const expiry = Math.min(Date.parse(request.expiresAt), Date.parse(issuedAt) + MAX_REQUEST_LIFETIME_MS);
  if (!Number.isFinite(expiry) || expiry <= Date.parse(issuedAt)) throw new WalletAuthError("INVALID_EXPIRY", "Approval cannot outlive the request");
  return Object.freeze({
    version: WALLET_AUTH_VERSION,
    requestDigest: requestDigest(request),
    nonce: request.nonce,
    chainId: request.chainId,
    requestingProduct: request.requestingProduct,
    productClientId: request.productClientId,
    bundleId: request.bundleId,
    productDeviceKey: request.productDeviceKey,
    callback: request.callback,
    account,
    accountPublicKey,
    grantedScopes: Object.freeze([...request.scopes]),
    purpose: request.purpose,
    issuedAt,
    expiresAt: new Date(expiry).toISOString(),
  });
}

export function approvalSignBytes(payload) {
  return `YNX_WALLET_AUTH_APPROVAL_V1\n${canonicalJSON(payload)}`;
}

export function parseAuthorizationResponse(input) {
  const raw = typeof input === "string" ? parseJSON(input) : input;
  exactFields(raw, RESPONSE_FIELDS, "Wallet authorization response");
  if (raw.version !== WALLET_AUTH_VERSION || raw.chainId !== YNX_NATIVE_CHAIN_ID) throw new WalletAuthError("INVALID_RESPONSE", "Wallet authorization response uses an unsupported protocol or network");
  requiredPattern(raw.requestDigest, "requestDigest", /^[0-9a-f]{64}$/);
  requiredPattern(raw.walletSignature, "walletSignature", /^[0-9a-f]{128}$/);
  requiredPattern(raw.account, "account", /^ynx1[023456789acdefghjklmnpqrstuvwxyz]{38}$/);
  requiredPattern(raw.accountPublicKey, "accountPublicKey", /^(02|03)[0-9a-f]{64}$/);
  strictScopes(raw.grantedScopes);
  strictURL(raw.callback, "callback");
  strictTime(raw.issuedAt, "issuedAt");
  strictTime(raw.expiresAt, "expiresAt");
  return Object.freeze({ ...raw, grantedScopes: Object.freeze([...raw.grantedScopes]) });
}

export function unsignedApproval(response) {
  const { walletSignature: _signature, ...payload } = response;
  return payload;
}

function parseJSON(value) {
  try { return JSON.parse(value); } catch { throw new WalletAuthError("INVALID_JSON", "Wallet authorization payload is not valid JSON"); }
}

function requiredString(value, label, maximum) {
  if (typeof value !== "string" || value.length < 1 || value.length > maximum || value.trim() !== value) throw new WalletAuthError("INVALID_FIELD", `${label} is invalid`);
  return value;
}

function requiredPattern(value, label, pattern) {
  const normalized = requiredString(value, label, 256);
  if (!pattern.test(normalized)) throw new WalletAuthError("INVALID_FIELD", `${label} is invalid`);
  return normalized;
}

function strictTime(value, label) {
  const normalized = requiredPattern(value, label, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  if (!Number.isFinite(Date.parse(normalized)) || new Date(normalized).toISOString() !== normalized) throw new WalletAuthError("INVALID_TIME", `${label} is invalid`);
  return normalized;
}

function strictURL(value, label) {
  const normalized = requiredString(value, label, 512);
  let parsed;
  try { parsed = new URL(normalized); } catch { throw new WalletAuthError("INVALID_CALLBACK", `${label} is invalid`); }
  if (!/^[a-z][a-z0-9+.-]*:$/.test(parsed.protocol) || parsed.username || parsed.password || parsed.hash) throw new WalletAuthError("INVALID_CALLBACK", `${label} is invalid`);
  if (parsed.toString() !== normalized) throw new WalletAuthError("INVALID_CALLBACK", `${label} must be canonical`);
  return normalized;
}

function strictScopes(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 8) throw new WalletAuthError("INVALID_SCOPES", "scopes must contain between one and eight entries");
  const scopes = value.map((scope) => requiredPattern(scope, "scope", /^[a-z][a-z0-9._:-]{1,63}$/));
  if (new Set(scopes).size !== scopes.length || [...scopes].sort().join("\n") !== scopes.join("\n")) throw new WalletAuthError("INVALID_SCOPES", "scopes must be unique and sorted");
  return scopes;
}
