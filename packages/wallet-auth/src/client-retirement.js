import { exactFields, WalletAuthError } from "./canonical.js";

const ACTIVE_FIELDS = ["status"];
const RETIRED_FIELDS = [
  "status", "clientId", "replacementURL", "minimumClientVersion", "lastSupportedVersion",
  "retiredAt", "disabledCallbacks", "disabledAppLinks",
];
const RECORD_FIELDS = [
  "clientId", "productId", "requestingProduct", "productClientId", "bundleId",
  "replacementURL", "minimumClientVersion", "lastSupportedVersion", "retiredAt",
  "disabledCallbacks", "disabledAppLinks",
];

export const CLIENT_LIFECYCLE_ACTIVE = Object.freeze({ status: "active" });

export class ClientRetiredError extends WalletAuthError {
  constructor(record) {
    const retirement = parseClientRetirementRecord(record);
    super("CLIENT_RETIRED", "This client is retired");
    this.details = Object.freeze({
      clientId: retirement.clientId,
      replacementURL: retirement.replacementURL,
      minimumClientVersion: retirement.minimumClientVersion,
    });
  }
}

export function parseClientLifecycle(input, identity) {
  if (input?.status === "active") {
    exactFields(input, ACTIVE_FIELDS, "Wallet client lifecycle");
    return CLIENT_LIFECYCLE_ACTIVE;
  }
  exactFields(input, RETIRED_FIELDS, "Retired Wallet client lifecycle");
  if (input.status !== "retired") throw new WalletAuthError("INVALID_REGISTRY", "Wallet client lifecycle status is unsupported");
  const callbacks = canonicalURLs(input.disabledCallbacks, "disabledCallbacks", 1, 8, false);
  if (callbacks.join("\n") !== identity.callbacks.join("\n")) {
    throw new WalletAuthError("INVALID_REGISTRY", "Retired Wallet client must disable every registered callback");
  }
  return Object.freeze({
    status: "retired",
    clientId: token(input.clientId, "clientId", /^[a-z][a-z0-9-]{2,63}$/),
    replacementURL: canonicalURL(input.replacementURL, "replacementURL", true),
    minimumClientVersion: token(input.minimumClientVersion, "minimumClientVersion", /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/),
    lastSupportedVersion: token(input.lastSupportedVersion, "lastSupportedVersion", /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/),
    retiredAt: canonicalTime(input.retiredAt),
    disabledCallbacks: callbacks,
    disabledAppLinks: canonicalURLs(input.disabledAppLinks, "disabledAppLinks", 0, 8, false),
  });
}

export function clientRetirementRecord(registration) {
  if (registration?.clientLifecycle?.status !== "retired") throw new WalletAuthError("INVALID_REGISTRY", "Wallet product is not retired");
  return parseClientRetirementRecord({
    clientId: registration.clientLifecycle.clientId,
    productId: registration.productId,
    requestingProduct: registration.requestingProduct,
    productClientId: registration.productClientId,
    bundleId: registration.bundleId,
    replacementURL: registration.clientLifecycle.replacementURL,
    minimumClientVersion: registration.clientLifecycle.minimumClientVersion,
    lastSupportedVersion: registration.clientLifecycle.lastSupportedVersion,
    retiredAt: registration.clientLifecycle.retiredAt,
    disabledCallbacks: registration.clientLifecycle.disabledCallbacks,
    disabledAppLinks: registration.clientLifecycle.disabledAppLinks,
  });
}

export function parseClientRetirementRecord(input) {
  exactFields(input, RECORD_FIELDS, "Wallet client retirement record");
  return Object.freeze({
    clientId: token(input.clientId, "clientId", /^[a-z][a-z0-9-]{2,63}$/),
    productId: token(input.productId, "productId", /^[a-z][a-z0-9-]{1,31}$/),
    requestingProduct: token(input.requestingProduct, "requestingProduct", /^[a-z][a-z0-9-]{1,31}$/),
    productClientId: token(input.productClientId, "productClientId", /^[a-z][a-z0-9._-]{2,63}$/),
    bundleId: token(input.bundleId, "bundleId", /^[A-Za-z][A-Za-z0-9.-]{2,127}$/),
    replacementURL: canonicalURL(input.replacementURL, "replacementURL", true),
    minimumClientVersion: token(input.minimumClientVersion, "minimumClientVersion", /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/),
    lastSupportedVersion: token(input.lastSupportedVersion, "lastSupportedVersion", /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/),
    retiredAt: canonicalTime(input.retiredAt),
    disabledCallbacks: canonicalURLs(input.disabledCallbacks, "disabledCallbacks", 1, 8, false),
    disabledAppLinks: canonicalURLs(input.disabledAppLinks, "disabledAppLinks", 0, 8, false),
  });
}

export function assertClientLifecycleActive(registration) {
  if (registration?.clientLifecycle?.status === "retired") throw new ClientRetiredError(clientRetirementRecord(registration));
  if (registration?.clientLifecycle?.status !== "active") throw new WalletAuthError("INVALID_REGISTRY", "Wallet client lifecycle is invalid");
  return registration;
}

export function assertSessionClientActive(session, retiredClients) {
  const retirement = retiredClients.find((record) => retirementMatchesSession(record, session));
  if (retirement) throw new ClientRetiredError(retirement);
  return session;
}

export function assertClientReturnTargetActive(target, retiredClients) {
  const candidate = parsedTarget(target, "return target");
  if (!Array.isArray(retiredClients)) throw new WalletAuthError("INVALID_STORE", "retired client policy is invalid");
  const retirement = retiredClients.map(parseClientRetirementRecord).find((record) =>
    record.disabledCallbacks.includes(candidate.toString())
    || record.disabledAppLinks.some((disabled) => targetWithinDisabledRoute(candidate, new URL(disabled))));
  if (retirement) throw new ClientRetiredError(retirement);
  return candidate.toString();
}

export function retirementMatchesSession(record, session) {
  return record.requestingProduct === session.requestingProduct
    && record.productClientId === session.productClientId
    && record.bundleId === session.bundleId
    && record.disabledCallbacks.includes(session.callback);
}

function parsedTarget(value, label) {
  const normalized = token(value, label, /^.{8,512}$/u);
  let parsed;
  try { parsed = new URL(normalized); } catch { throw new WalletAuthError("INVALID_CALLBACK", label + " is invalid"); }
  if (!safeReturnProtocol(parsed.protocol) || parsed.username || parsed.password || parsed.toString() !== normalized) throw new WalletAuthError("INVALID_CALLBACK", label + " must be a canonical YNX or HTTPS URL");
  return parsed;
}

function targetWithinDisabledRoute(candidate, disabled) {
  if (candidate.protocol !== disabled.protocol || candidate.hostname !== disabled.hostname || candidate.port !== disabled.port) return false;
  const basePath = disabled.pathname === "" ? "/" : disabled.pathname;
  const candidatePath = candidate.pathname === "" ? "/" : candidate.pathname;
  return candidatePath === basePath || candidatePath.startsWith(basePath.endsWith("/") ? basePath : basePath + "/");
}

function safeReturnProtocol(protocol) {
  return protocol === "https:" || /^ynx[a-z0-9+.-]*:$/.test(protocol);
}

function canonicalURLs(value, label, minimum, maximum, httpsOnly) {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) throw new WalletAuthError("INVALID_REGISTRY", `${label} has an invalid item count`);
  const values = value.map((item) => canonicalURL(item, label, httpsOnly));
  if (new Set(values).size !== values.length || [...values].sort().join("\n") !== values.join("\n")) throw new WalletAuthError("INVALID_REGISTRY", `${label} must be unique and sorted`);
  return Object.freeze(values);
}

function canonicalURL(value, label, httpsOnly) {
  const normalized = token(value, label, /^.{8,512}$/u);
  let parsed;
  try { parsed = new URL(normalized); } catch { throw new WalletAuthError("INVALID_REGISTRY", `${label} is invalid`); }
  if ((httpsOnly && parsed.protocol !== "https:") || (!httpsOnly && !safeReturnProtocol(parsed.protocol)) || parsed.username || parsed.password || parsed.search || parsed.hash || parsed.toString() !== normalized) {
    throw new WalletAuthError("INVALID_REGISTRY", `${label} must be a canonical ${httpsOnly ? "HTTPS " : ""}URL`);
  }
  return normalized;
}

function canonicalTime(value) {
  const normalized = token(value, "retiredAt", /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  if (!Number.isFinite(Date.parse(normalized)) || new Date(normalized).toISOString() !== normalized) throw new WalletAuthError("INVALID_REGISTRY", "retiredAt is invalid");
  return normalized;
}

function token(value, label, pattern) {
  if (typeof value !== "string" || value.trim() !== value || !pattern.test(value)) throw new WalletAuthError("INVALID_REGISTRY", `${label} is invalid`);
  return value;
}
