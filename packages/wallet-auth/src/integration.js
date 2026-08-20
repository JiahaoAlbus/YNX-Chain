import { digestHex, exactFields, WalletAuthError } from "./canonical.js";
import { requestDigest, parseAuthorizationRequest, parseAuthorizationResponse, PRODUCT_DEVICE_ALGORITHM, YNX_NATIVE_CHAIN_ID } from "./protocol.js";
import { verifyAuthorization, walletIdentityFromPublicKey } from "./crypto.js";
import { verifyGatewayCompletion } from "./session.js";

const REGISTRY_V1_FIELDS = ["schemaVersion", "productClientId", "requestingProduct", "bundleId", "callback", "scopes", "maxScopes"];
const REGISTRY_V2_FIELDS = ["schemaVersion", "productClientId", "requestingProduct", "bundleId", "callbacks", "scopes", "maxScopes", "productDeviceAlgorithms"];
const REGISTRY_V3_FIELDS = [...REGISTRY_V2_FIELDS, "origins"];
const VERIFY_FIELDS = ["registryEntry", "authorizationRequest", "walletApproval", "gatewayCompletion"];
const SESSION_V1_BASE_FIELDS = [
  "verifierVersion", "sessionBinding", "chainId", "requestingProduct", "productClientId", "bundleId",
  "callback", "productDeviceAlgorithm", "productDeviceKey", "deviceBinding", "account", "scopes", "nonce",
  "purpose", "requestDigest", "approvalDigest", "issuedAt", "expiresAt",
];
const SESSION_V1_FIELDS = [...SESSION_V1_BASE_FIELDS, "accountPublicKey"];
const SESSION_FIELDS = [
  "verifierVersion", "sessionBinding", "chainId", "requestingProduct", "productClientId", "bundleId",
  "origin", "callback", "productDeviceAlgorithm", "productDeviceKey", "deviceBinding", "account", "scopes", "nonce",
  "purpose", "requestDigest", "approvalDigest", "issuedAt", "expiresAt",
];

export const CENTRAL_REGISTRY_SCHEMA_VERSION = 3;
export const CENTRAL_VERIFIER_VERSION = "wallet-auth-v2";

export function migrateCentralRegistryEntry(input) {
  if (input?.schemaVersion === 3) return parseCentralRegistryEntry(input);
  exactFields(input, REGISTRY_V1_FIELDS, "Wallet product registry v1 entry");
  const migrated = {
    schemaVersion: 3,
    productClientId: input.productClientId,
    requestingProduct: input.requestingProduct,
    bundleId: input.bundleId,
    callbacks: [input.callback],
    scopes: input.scopes,
    maxScopes: input.maxScopes,
    productDeviceAlgorithms: [PRODUCT_DEVICE_ALGORITHM],
    origins: [],
  };
  return parseCentralRegistryEntry(migrated);
}

export function parseCentralRegistryEntry(input) {
  const version = input?.schemaVersion;
  if (version === 2) exactFields(input, REGISTRY_V2_FIELDS, "Wallet product registry v2 entry");
  else exactFields(input, REGISTRY_V3_FIELDS, "Wallet product registry entry");
  const entry = {
    schemaVersion: requiredInteger(input.schemaVersion, "schemaVersion", 2, 3),
    productClientId: requiredPattern(input.productClientId, "productClientId", /^[a-z][a-z0-9._-]{2,63}$/),
    requestingProduct: requiredPattern(input.requestingProduct, "requestingProduct", /^[a-z][a-z0-9-]{1,31}$/),
    bundleId: requiredPattern(input.bundleId, "bundleId", /^[A-Za-z][A-Za-z0-9.-]{2,127}$/),
    callbacks: stringList(input.callbacks, "callbacks", 1, 8, (value) => canonicalCallback(value)),
    scopes: stringList(input.scopes, "scopes", 1, 16, (value) => requiredPattern(value, "scope", /^[a-z][a-z0-9._:-]{1,63}$/)),
    maxScopes: requiredInteger(input.maxScopes, "maxScopes", 1, 8),
    productDeviceAlgorithms: stringList(input.productDeviceAlgorithms, "productDeviceAlgorithms", 1, 4, (value) => requiredPattern(value, "productDeviceAlgorithm", /^p256-sha256$/)),
    origins: version === 2 ? [] : stringList(input.origins, "origins", 0, 8, strictOrigin),
  };
  if (entry.maxScopes > entry.scopes.length) throw new WalletAuthError("INVALID_REGISTRY", "maxScopes cannot exceed the registered scope count");
  return freezeEntry({ ...entry, schemaVersion: 3 });
}

export function registryParserBinding(input) {
  const entry = parseCentralRegistryEntry(input);
  return Object.freeze({
    [entry.productClientId]: Object.freeze({
      requestingProduct: entry.requestingProduct,
      bundleId: entry.bundleId,
      callbacks: entry.callbacks,
      origins: entry.origins,
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
    chainId: request.chainId,
    requestingProduct: request.requestingProduct,
    productClientId: completion.productClientId,
    bundleId: completion.bundleId,
    origin: request.origin,
    callback: request.callback,
    productDeviceAlgorithm: completion.productDeviceAlgorithm,
    productDeviceKey: request.productDeviceKey,
    deviceBinding: centralDeviceBinding(request, completion.account),
    requestDigest: approval.requestDigest,
    approvalDigest: centralApprovalDigest(approval),
    account: completion.account,
    scopes: completion.scopes,
    nonce: request.nonce,
    purpose: request.purpose,
    issuedAt: input.gatewayCompletion.challenge.issuedAt,
    expiresAt: completion.expiresAt,
  });
}

export function assertCentralWalletSessionActive(session, input, at = new Date()) {
  exactFields(input, ["revokedSessionBindings", "revokedApprovalDigests", "revokedDeviceBindings", "accountLogoutRecords"], "Central Wallet session state");
  const now = validDate(at).toISOString();
  const parsed = parseCentralWalletSession(session);
  const bindings = stringList(input.revokedSessionBindings, "revokedSessionBindings", 0, 1000, (value) => requiredPattern(value, "sessionBinding", /^[0-9a-f]{64}$/));
  const approvals = stringList(input.revokedApprovalDigests, "revokedApprovalDigests", 0, 1000, (value) => requiredPattern(value, "approvalDigest", /^[0-9a-f]{64}$/));
  const devices = stringList(input.revokedDeviceBindings, "revokedDeviceBindings", 0, 1000, (value) => requiredPattern(value, "deviceBinding", /^[0-9a-f]{64}$/));
  const logoutRecords = parseAccountLogoutRecords(input.accountLogoutRecords);
  if (parsed.issuedAt > now) throw new WalletAuthError("ISSUED_IN_FUTURE", "Wallet product session issue time is in the future");
  if (parsed.expiresAt <= now) throw new WalletAuthError("EXPIRED", "Wallet product session has expired");
  if (bindings.includes(parsed.sessionBinding)) throw new WalletAuthError("REVOKED", "Wallet product session has been revoked");
  if (approvals.includes(parsed.approvalDigest)) throw new WalletAuthError("REVOKED", "Wallet approval and all sessions derived from it have been revoked");
  if (devices.includes(parsed.deviceBinding)) throw new WalletAuthError("REVOKED", "Wallet product device has been revoked");
  if (logoutRecords.some((record) => record.account === parsed.account && parsed.issuedAt <= record.before)) throw new WalletAuthError("REVOKED", "Wallet account was signed out from all devices");
  if (parsed.verifierVersion !== CENTRAL_VERIFIER_VERSION) throw new WalletAuthError("SESSION_RETIRED", "Wallet product session predates origin binding and must reconnect");
  return parsed;
}

export function parseCentralWalletSession(input) {
  const legacy = input?.verifierVersion === "wallet-auth-v1";
  const legacyHasAccountPublicKey=legacy&&Object.hasOwn(input,"accountPublicKey");
  exactFields(input, legacy ? (legacyHasAccountPublicKey ? SESSION_V1_FIELDS : SESSION_V1_BASE_FIELDS) : SESSION_FIELDS, "Central Wallet session");
  const session={
    verifierVersion:requiredPattern(input.verifierVersion,"verifierVersion",/^wallet-auth-v[12]$/),
    sessionBinding:requiredPattern(input.sessionBinding,"sessionBinding",/^[0-9a-f]{64}$/),
    chainId:requiredPattern(input.chainId,"chainId",/^ynx_6423-1$/),
    requestingProduct:requiredPattern(input.requestingProduct,"requestingProduct",/^[a-z][a-z0-9-]{1,31}$/),
    productClientId:requiredPattern(input.productClientId,"productClientId",/^[a-z][a-z0-9._-]{2,63}$/),
    bundleId:requiredPattern(input.bundleId,"bundleId",/^[A-Za-z][A-Za-z0-9.-]{2,127}$/),
    ...(legacy ? {} : { origin:strictOrigin(input.origin) }),
    callback:canonicalCallback(input.callback),
    productDeviceAlgorithm:requiredPattern(input.productDeviceAlgorithm,"productDeviceAlgorithm",/^p256-sha256$/),
    productDeviceKey:requiredPattern(input.productDeviceKey,"productDeviceKey",/^[A-Za-z0-9_-]{44}$/),
    deviceBinding:requiredPattern(input.deviceBinding,"deviceBinding",/^[0-9a-f]{64}$/),
    requestDigest:requiredPattern(input.requestDigest,"requestDigest",/^[0-9a-f]{64}$/),
    approvalDigest:requiredPattern(input.approvalDigest,"approvalDigest",/^[0-9a-f]{64}$/),
    account:requiredPattern(input.account,"account",/^ynx1[023456789acdefghjklmnpqrstuvwxyz]{38}$/),
    ...(legacyHasAccountPublicKey ? { accountPublicKey:requiredPattern(input.accountPublicKey,"accountPublicKey",/^(02|03)[0-9a-f]{64}$/) } : {}),
    scopes:stringList(input.scopes,"scopes",1,8,(value)=>requiredPattern(value,"scope",/^[a-z][a-z0-9._:-]{1,63}$/)),
    nonce:requiredPattern(input.nonce,"nonce",/^[A-Za-z0-9_-]{32,64}$/),
    purpose:requiredPattern(input.purpose,"purpose",/^.{1,180}$/u),
    issuedAt:strictTime(input.issuedAt,"issuedAt"),expiresAt:strictTime(input.expiresAt,"expiresAt"),
  };
  if(session.expiresAt<=session.issuedAt)throw new WalletAuthError("INVALID_SESSION","Wallet product session lifetime is invalid");
  let legacyAccountMatches=true;
  if(legacyHasAccountPublicKey){
    try{legacyAccountMatches=walletIdentityFromPublicKey(session.accountPublicKey)===session.account;}
    catch{legacyAccountMatches=false;}
  }
  if(session.chainId!==YNX_NATIVE_CHAIN_ID||session.deviceBinding!==centralDeviceBinding(session,session.account)||!legacyAccountMatches)throw new WalletAuthError("INVALID_SESSION","Wallet product session security binding is invalid");
  return Object.freeze({...session,scopes:Object.freeze([...session.scopes])});
}

export function centralApprovalDigest(approval) {
  return digestHex("YNX_WALLET_AUTH_APPROVAL_DIGEST_V2", parseAuthorizationResponse(approval));
}

export function centralDeviceBinding(requestOrSession, account) {
  const legacy = requestOrSession.verifierVersion === "wallet-auth-v1";
  return digestHex(legacy ? "YNX_WALLET_PRODUCT_DEVICE_BINDING_V1" : "YNX_WALLET_PRODUCT_DEVICE_BINDING_V2", {
    chainId: requestOrSession.chainId,
    requestingProduct: requestOrSession.requestingProduct,
    productClientId: requestOrSession.productClientId,
    bundleId: requestOrSession.bundleId,
    ...(legacy ? {} : { origin: requestOrSession.origin }),
    callback: requestOrSession.callback,
    productDeviceAlgorithm: requestOrSession.productDeviceAlgorithm,
    productDeviceKey: requestOrSession.productDeviceKey,
    account,
  });
}

function freezeEntry(entry) {
  return Object.freeze({ ...entry, callbacks: Object.freeze([...entry.callbacks]), origins: Object.freeze([...entry.origins]), scopes: Object.freeze([...entry.scopes]), productDeviceAlgorithms: Object.freeze([...entry.productDeviceAlgorithms]) });
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
  if (parsed.toString() !== normalized || parsed.username || parsed.password || parsed.search || parsed.hash) throw new WalletAuthError("INVALID_REGISTRY", "callback must be canonical and contain no query or fragment state");
  return normalized;
}
function strictOrigin(value){const normalized=requiredPattern(value,"origin",/^https:\/\/[A-Za-z0-9.-]+(?::[0-9]{1,5})?$/);let parsed;try{parsed=new URL(normalized)}catch{throw new WalletAuthError("INVALID_REGISTRY","origin is invalid")}if(parsed.protocol!=="https:"||parsed.username||parsed.password||parsed.pathname!=="/"||parsed.search||parsed.hash||parsed.toString()!==`${normalized}/`)throw new WalletAuthError("INVALID_REGISTRY","origin must be a canonical HTTPS origin");return normalized}
function parseAccountLogoutRecords(value){
  if(!Array.isArray(value)||value.length>1000)throw new WalletAuthError("INVALID_REGISTRY","accountLogoutRecords has an invalid item count");
  const records=value.map((record)=>{exactFields(record,["account","before"],"Wallet account logout record");return Object.freeze({account:requiredPattern(record.account,"account",/^ynx1[023456789acdefghjklmnpqrstuvwxyz]{38}$/),before:strictTime(record.before,"before")})});
  const keys=records.map((record)=>`${record.account}:${record.before}`);if(new Set(keys).size!==keys.length||[...keys].sort().join("\n")!==keys.join("\n"))throw new WalletAuthError("INVALID_REGISTRY","accountLogoutRecords must be unique and sorted");return records;
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
function strictTime(value,label){const normalized=requiredPattern(value,label,/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);if(!Number.isFinite(Date.parse(normalized))||new Date(normalized).toISOString()!==normalized)throw new WalletAuthError("INVALID_TIME",`${label} is invalid`);return normalized;}
