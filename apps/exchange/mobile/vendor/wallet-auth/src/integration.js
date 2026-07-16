import { exactFields, WalletAuthError } from "./canonical.js";
import { requestDigest, parseAuthorizationRequest, PRODUCT_DEVICE_ALGORITHM } from "./protocol.js";
import { verifyAuthorization } from "./crypto.js";
import { verifyGatewayCompletion } from "./session.js";

const REGISTRY_V1_FIELDS = ["schemaVersion", "productClientId", "requestingProduct", "bundleId", "callback", "scopes", "maxScopes"];
const REGISTRY_V2_FIELDS = ["schemaVersion", "productClientId", "requestingProduct", "bundleId", "callbacks", "scopes", "maxScopes", "productDeviceAlgorithms"];
const VERIFY_FIELDS = ["registryEntry", "authorizationRequest", "walletApproval", "gatewayCompletion"];

export const CENTRAL_REGISTRY_SCHEMA_VERSION = 2;
export const CENTRAL_VERIFIER_VERSION = "wallet-auth-v1";

export function migrateCentralRegistryEntry(input) {
  if (input?.schemaVersion === 2) return parseCentralRegistryEntry(input);
  exactFields(input, REGISTRY_V1_FIELDS, "Wallet product registry v1 entry");
  const migrated = {
    schemaVersion: 2,
    productClientId: input.productClientId,
    requestingProduct: input.requestingProduct,
    bundleId: input.bundleId,
    callbacks: [input.callback],
    scopes: input.scopes,
    maxScopes: input.maxScopes,
    productDeviceAlgorithms: [PRODUCT_DEVICE_ALGORITHM],
  };
  return parseCentralRegistryEntry(migrated);
}

export function parseCentralRegistryEntry(input) {
  exactFields(input, REGISTRY_V2_FIELDS, "Wallet product registry v2 entry");
  const entry = {
    schemaVersion: requiredInteger(input.schemaVersion, "schemaVersion", 2, 2),
    productClientId: requiredPattern(input.productClientId, "productClientId", /^[a-z][a-z0-9._-]{2,63}$/),
    requestingProduct: requiredPattern(input.requestingProduct, "requestingProduct", /^[a-z][a-z0-9-]{1,31}$/),
    bundleId: requiredPattern(input.bundleId, "bundleId", /^[A-Za-z][A-Za-z0-9.-]{2,127}$/),
    callbacks: stringList(input.callbacks, "callbacks", 1, 8, (value) => canonicalCallback(value)),
    scopes: stringList(input.scopes, "scopes", 1, 16, (value) => requiredPattern(value, "scope", /^[a-z][a-z0-9._:-]{1,63}$/)),
    maxScopes: requiredInteger(input.maxScopes, "maxScopes", 1, 8),
    productDeviceAlgorithms: stringList(input.productDeviceAlgorithms, "productDeviceAlgorithms", 1, 4, (value) => requiredPattern(value, "productDeviceAlgorithm", /^p256-sha256$/)),
  };
  if (entry.maxScopes > entry.scopes.length) throw new WalletAuthError("INVALID_REGISTRY", "maxScopes cannot exceed the registered scope count");
  return freezeEntry(entry);
}

export function registryParserBinding(input) {
  const entry = parseCentralRegistryEntry(input);
  return Object.freeze({
    [entry.productClientId]: Object.freeze({
      requestingProduct: entry.requestingProduct,
      bundleId: entry.bundleId,
      callbacks: entry.callbacks,
      scopes: entry.scopes,
      maxScopes: entry.maxScopes,
    }),
  });
}

export function verifyCentralWalletSession(input, at = new Date()) {
  exactFields(input, VERIFY_FIELDS, "Central Wallet verifier input");
  const registryEntry = parseCentralRegistryEntry(input.registryEntry);
  const request = parseAuthorizationRequest(input.authorizationRequest, { now: at, registry: registryParserBinding(registryEntry) });
  if (!registryEntry.productDeviceAlgorithms.includes(request.productDeviceAlgorithm)) throw new WalletAuthError("UNSUPPORTED_DEVICE_ALGORITHM", "Product device algorithm is not registered");
  const approval = verifyAuthorization(input.walletApproval, { ...request, requestDigest: requestDigest(request), now: at });
  const completion = verifyGatewayCompletion(input.gatewayCompletion, approval, at);
  return Object.freeze({
    verifierVersion: CENTRAL_VERIFIER_VERSION,
    sessionBinding: completion.sessionBinding,
    productClientId: completion.productClientId,
    bundleId: completion.bundleId,
    productDeviceAlgorithm: completion.productDeviceAlgorithm,
    requestDigest: approval.requestDigest,
    account: completion.account,
    scopes: completion.scopes,
    issuedAt: input.gatewayCompletion.challenge.issuedAt,
    expiresAt: completion.expiresAt,
  });
}

export function assertCentralWalletSessionActive(session, input, at = new Date()) {
  exactFields(input, ["revokedSessionBindings", "revokedRequestDigests"], "Central Wallet session state");
  const now = validDate(at).toISOString();
  const bindings = stringList(input.revokedSessionBindings, "revokedSessionBindings", 0, 1000, (value) => requiredPattern(value, "sessionBinding", /^[0-9a-f]{64}$/));
  const requests = stringList(input.revokedRequestDigests, "revokedRequestDigests", 0, 1000, (value) => requiredPattern(value, "requestDigest", /^[0-9a-f]{64}$/));
  if (session?.verifierVersion !== CENTRAL_VERIFIER_VERSION || typeof session.expiresAt !== "string") throw new WalletAuthError("INVALID_SESSION", "Wallet product session is invalid");
  if (session.expiresAt <= now) throw new WalletAuthError("EXPIRED", "Wallet product session has expired");
  if (bindings.includes(session.sessionBinding)) throw new WalletAuthError("REVOKED", "Wallet product session has been revoked");
  if (requests.includes(session.requestDigest)) throw new WalletAuthError("REVOKED", "Wallet approval and all sessions derived from it have been revoked");
  return session;
}

function freezeEntry(entry) {
  return Object.freeze({ ...entry, callbacks: Object.freeze([...entry.callbacks]), scopes: Object.freeze([...entry.scopes]), productDeviceAlgorithms: Object.freeze([...entry.productDeviceAlgorithms]) });
}
function stringList(value, label, minimum, maximum, normalize) {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) throw new WalletAuthError("INVALID_REGISTRY", `${label} has an invalid item count`);
  const result = value.map(normalize);
  if (new Set(result).size !== result.length || [...result].sort().join("\n") !== result.join("\n")) throw new WalletAuthError("INVALID_REGISTRY", `${label} must be unique and sorted`);
  return result;
}
function canonicalCallback(value) {
  const normalized = requiredPattern(value, "callback", /^[a-z][a-z0-9+.-]*:\/\/[^\s#]+$/);
  let parsed; try { parsed = new URL(normalized); } catch { throw new WalletAuthError("INVALID_REGISTRY", "callback is invalid"); }
  if (parsed.toString() !== normalized || parsed.username || parsed.password || parsed.hash) throw new WalletAuthError("INVALID_REGISTRY", "callback must be canonical");
  return normalized;
}
function requiredPattern(value, label, pattern) {
  if (typeof value !== "string" || value.trim() !== value || !pattern.test(value)) throw new WalletAuthError("INVALID_REGISTRY", `${label} is invalid`);
  return value;
}
function requiredInteger(value, label, minimum, maximum) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) throw new WalletAuthError("INVALID_REGISTRY", `${label} is invalid`);
  return value;
}
function validDate(value) {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw new WalletAuthError("INVALID_TIME", "verification time is invalid");
  return value;
}
