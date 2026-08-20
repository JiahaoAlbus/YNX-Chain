import { exactFields, WalletAuthError } from "./canonical.js";
import { assertClientLifecycleActive, clientRetirementRecord, CLIENT_LIFECYCLE_ACTIVE, parseClientLifecycle, parseClientRetirementRecord } from "./client-retirement.js";
import { YNX_NATIVE_CHAIN_ID } from "./protocol.js";
import { parseCentralRegistryEntry } from "./integration.js";

const DOCUMENT_FIELDS_V2 = ["registryVersion", "chainId", "products"];
const DOCUMENT_FIELDS = [...DOCUMENT_FIELDS_V2, "retiredClients"];
const PRODUCT_FIELDS_V3 = [
  "schemaVersion", "productId", "displayName", "reviewState", "enabled",
  "productClientId", "requestingProduct", "bundleId", "callbacks", "scopes",
  "maxScopes", "productDeviceAlgorithms", "sessionDurationSeconds", "revocationPolicy",
];
const PRODUCT_FIELDS_V4 = [...PRODUCT_FIELDS_V3, "webOrigins"];
const PRODUCT_FIELDS_V5 = [...PRODUCT_FIELDS_V4, "clientLifecycle"];
const REVOCATION_FIELDS = ["session", "approval", "device", "accountAllDevices"];
const REVIEW_STATES = new Set(["approved", "pending-review", "disabled", "retired"]);
const REGISTRY_V1_PRODUCT_IDS = Object.freeze([
  "ai", "browser", "calendar", "card", "cloud", "creator-studio", "developer", "dex", "docs", "exchange",
  "explorer", "finance", "mail", "merchant-console", "monitor", "music", "pay", "resource-market", "search",
  "seller-console", "shop", "social", "trust-center", "video", "wallet",
]);

export const CENTRAL_REGISTRY_DOCUMENT_VERSION = 3;
export const CENTRAL_REGISTRY_PRODUCT_COUNT = 26;
export const CENTRAL_PRODUCT_SCHEMA_VERSION = 5;

export function parseCentralRegistryDocument(input) {
  const sourceVersion = input?.registryVersion;
  const hasRetiredClients = Object.hasOwn(input ?? {}, "retiredClients");
  exactFields(input, sourceVersion === 2 && !hasRetiredClients ? DOCUMENT_FIELDS_V2 : DOCUMENT_FIELDS, "Central Wallet registry document");
  if (![2, CENTRAL_REGISTRY_DOCUMENT_VERSION].includes(sourceVersion) || input.chainId !== YNX_NATIVE_CHAIN_ID || !Array.isArray(input.products) || input.products.length !== CENTRAL_REGISTRY_PRODUCT_COUNT) {
    throw new WalletAuthError("INVALID_REGISTRY", "Central Wallet registry v2 or v3 must contain exactly 26 products for ynx_6423-1");
  }
  const products = parseRegistryProducts(input.products);
  const retiredClients = parseRegistryRetirements(
    sourceVersion === 2 && !hasRetiredClients
      ? products.filter(product => product.clientLifecycle.status === "retired").map(clientRetirementRecord)
      : input.retiredClients,
    products,
  );
  return Object.freeze({
    registryVersion: sourceVersion,
    chainId: YNX_NATIVE_CHAIN_ID,
    products,
    retiredClients,
  });
}

export function migrateCentralRegistryDocumentV1(input) {
  exactFields(input, DOCUMENT_FIELDS_V2, "Central Wallet registry document v1");
  if (input.registryVersion !== 1 || input.chainId !== YNX_NATIVE_CHAIN_ID || !Array.isArray(input.products) || input.products.length !== REGISTRY_V1_PRODUCT_IDS.length) {
    throw new WalletAuthError("INVALID_REGISTRY", `Central Wallet registry v1 must contain exactly ${REGISTRY_V1_PRODUCT_IDS.length} products for ${YNX_NATIVE_CHAIN_ID}`);
  }
  const products = parseRegistryProducts(input.products);
  const ids = products.map(product => product.productId);
  if (ids.join("\n") !== REGISTRY_V1_PRODUCT_IDS.join("\n")) {
    throw new WalletAuthError("INVALID_REGISTRY", "Central Wallet registry v1 product set is not the accepted migration source");
  }
  const migratedProducts = [...input.products.map(product => structuredClone(product)), canonicalQuantRegistration()]
    .sort((left, right) => left.productId.localeCompare(right.productId));
  return parseCentralRegistryDocument({
    registryVersion: CENTRAL_REGISTRY_DOCUMENT_VERSION,
    chainId: YNX_NATIVE_CHAIN_ID,
    products: migratedProducts,
    retiredClients: [],
  });
}

export function parseCentralProductRegistration(input) {
  const sourceVersion = input?.schemaVersion;
  if (sourceVersion === 3) exactFields(input, PRODUCT_FIELDS_V3, "Central Wallet product registration v3");
  else if (sourceVersion === 4) exactFields(input, PRODUCT_FIELDS_V4, "Central Wallet product registration v4");
  else exactFields(input, PRODUCT_FIELDS_V5, "Central Wallet product registration");
  if (![3, 4, CENTRAL_PRODUCT_SCHEMA_VERSION].includes(sourceVersion)) throw new WalletAuthError("INVALID_REGISTRY", "Central Wallet product schema is unsupported");
  if (typeof input.productId !== "string" || !/^[a-z][a-z0-9-]{1,31}$/.test(input.productId)) throw new WalletAuthError("INVALID_REGISTRY", "productId is invalid");
  if (typeof input.displayName !== "string" || input.displayName.trim() !== input.displayName || input.displayName.length < 2 || input.displayName.length > 64) throw new WalletAuthError("INVALID_REGISTRY", "displayName is invalid");
  if (!REVIEW_STATES.has(input.reviewState) || typeof input.enabled !== "boolean" || input.enabled !== (input.reviewState === "approved")) throw new WalletAuthError("INVALID_REGISTRY", "Only approved registrations may be enabled");
  if (!Number.isInteger(input.sessionDurationSeconds) || input.sessionDurationSeconds < 60 || input.sessionDurationSeconds > 300) throw new WalletAuthError("INVALID_REGISTRY", "Session duration must be between 60 and 300 seconds");
  exactFields(input.revocationPolicy, REVOCATION_FIELDS, "Central Wallet revocation policy");
  if (REVOCATION_FIELDS.some(field => input.revocationPolicy[field] !== true)) throw new WalletAuthError("INVALID_REGISTRY", "Every central Wallet revocation control is mandatory");
  const webOrigins = sourceVersion === 3 ? Object.freeze([]) : canonicalWebOrigins(input.webOrigins);
  const protocol = parseCentralRegistryEntry({
    schemaVersion: 3,
    productClientId: input.productClientId,
    requestingProduct: input.requestingProduct,
    bundleId: input.bundleId,
    callbacks: input.callbacks,
    scopes: input.scopes,
    maxScopes: input.maxScopes,
    productDeviceAlgorithms: input.productDeviceAlgorithms,
    origins: webOrigins,
  });
  const { origins: _origins, ...protocolFields } = protocol;
  const clientLifecycle = sourceVersion < CENTRAL_PRODUCT_SCHEMA_VERSION
    ? CLIENT_LIFECYCLE_ACTIVE
    : parseClientLifecycle(input.clientLifecycle, { callbacks: protocol.callbacks });
  if ((clientLifecycle.status === "retired") !== (input.reviewState === "retired")) throw new WalletAuthError("INVALID_REGISTRY", "Retired Wallet lifecycle and review state must agree");
  return Object.freeze({
    productId: input.productId,
    displayName: input.displayName,
    reviewState: input.reviewState,
    enabled: input.enabled,
    ...protocolFields,
    schemaVersion: CENTRAL_PRODUCT_SCHEMA_VERSION,
    webOrigins,
    clientLifecycle,
    sessionDurationSeconds: input.sessionDurationSeconds,
    revocationPolicy: Object.freeze({ session: true, approval: true, device: true, accountAllDevices: true }),
  });
}

export function centralProtocolEntry(registration, options = {}) {
  const product = parseCentralProductRegistration(registration);
  if (options.allowRetired !== true) assertClientLifecycleActive(product);
  if (options.requireEnabled !== false && !product.enabled) throw new WalletAuthError("REGISTRY_DISABLED", `Central Wallet product ${product.productId} is ${product.reviewState}`);
  return Object.freeze({
    schemaVersion: 3,
    productClientId: product.productClientId,
    requestingProduct: product.requestingProduct,
    bundleId: product.bundleId,
    callbacks: product.callbacks,
    origins: product.webOrigins,
    scopes: product.scopes,
    maxScopes: product.maxScopes,
    productDeviceAlgorithms: product.productDeviceAlgorithms,
  });
}

export function centralRegistrationByProduct(document, productId, options = {}) {
  const registry = parseCentralRegistryDocument(document);
  const product = registry.products.find(item => item.productId === productId);
  if (!product) throw new WalletAuthError("UNKNOWN_PRODUCT", "Central Wallet product is not registered");
  if (options.requireEnabled !== false && !product.enabled) throw new WalletAuthError("REGISTRY_DISABLED", `Central Wallet product ${product.productId} is ${product.reviewState}`);
  return product;
}

// Enabled registrations receive normal browser CORS access. Retired clients
// may retain only their explicitly reviewed origins so the Gateway can return
// a typed CLIENT_RETIRED response; the lifecycle policy still rejects every
// private operation. A v3 registry never infers an origin.
export function centralRegisteredWebOrigins(document) {
  const registry = parseCentralRegistryDocument(document);
  return Object.freeze([...new Set(registry.products
    .filter(product => product.enabled || product.clientLifecycle.status === "retired")
    .flatMap(product => product.webOrigins))].sort());
}

function parseRegistryProducts(input) {
  const products = input.map(parseCentralProductRegistration);
  assertUnique(products, "productId");
  assertUnique(products, "productClientId");
  assertUnique(products, "bundleId");
  const callbacks = products.flatMap(product => product.callbacks);
  if (new Set(callbacks).size !== callbacks.length) throw new WalletAuthError("INVALID_REGISTRY", "Central Wallet callbacks must be globally unique");
  if ([...products].sort((left, right) => left.productId.localeCompare(right.productId)).map(item => item.productId).join("\n") !== products.map(item => item.productId).join("\n")) {
    throw new WalletAuthError("INVALID_REGISTRY", "Central Wallet products must be sorted by productId");
  }
  return Object.freeze(products);
}

function parseRegistryRetirements(input, products) {
  if (!Array.isArray(input) || input.length > 1000) throw new WalletAuthError("INVALID_REGISTRY", "Central Wallet retiredClients has an invalid item count");
  const retiredClients = input.map(parseClientRetirementRecord);
  assertUnique(retiredClients, "clientId");
  assertUnique(retiredClients, "productClientId");
  if ([...retiredClients].sort((left, right) => left.clientId.localeCompare(right.clientId)).map(item => item.clientId).join("\n") !== retiredClients.map(item => item.clientId).join("\n")) {
    throw new WalletAuthError("INVALID_REGISTRY", "Central Wallet retiredClients must be sorted by clientId");
  }
  const activeProducts = products.filter(product => product.clientLifecycle.status === "active");
  for (const retired of retiredClients) {
    if (!products.some(product => product.productId === retired.productId)) throw new WalletAuthError("INVALID_REGISTRY", "Retired Wallet client product is not registered");
    if (activeProducts.some(product => product.productClientId === retired.productClientId)) throw new WalletAuthError("INVALID_REGISTRY", "Retired and active Wallet clients must not share productClientId");
    if (activeProducts.some(product => product.callbacks.some(callback => retired.disabledCallbacks.includes(callback)))) throw new WalletAuthError("INVALID_REGISTRY", "Retired callbacks must not remain registered by an active Wallet client");
  }
  return Object.freeze(retiredClients);
}

function canonicalQuantRegistration() {
  return {
    // v1 migration is deliberately staged through the historical v3 shape;
    // parseCentralProductRegistration then upgrades it to v4 with no browser
    // origin inferred from a package or deep-link callback.
    schemaVersion: 3,
    productId: "quant",
    displayName: "YNX Quant",
    reviewState: "pending-review",
    enabled: false,
    productClientId: "ynx-quant-v1",
    requestingProduct: "quant",
    bundleId: "com.ynxweb4.quant",
    callbacks: ["ynxquant://wallet-auth/callback"],
    scopes: ["quant:account", "quant:mandate:create", "quant:mandate:execute", "quant:mandate:revoke"],
    maxScopes: 4,
    productDeviceAlgorithms: ["p256-sha256"],
    sessionDurationSeconds: 180,
    revocationPolicy: { session: true, approval: true, device: true, accountAllDevices: true },
  };
}

function assertUnique(products, field) {
  const values = products.map(product => product[field]);
  if (new Set(values).size !== values.length) throw new WalletAuthError("INVALID_REGISTRY", `Central Wallet ${field} values must be unique`);
}

function canonicalWebOrigins(value) {
  return Object.freeze(stringList(value, "webOrigins", 0, 8, (origin) => {
    if (typeof origin !== "string" || origin.length > 255 || origin.trim() !== origin) {
      throw new WalletAuthError("INVALID_REGISTRY", "web origin is invalid");
    }
    let parsed;
    try { parsed = new URL(origin); } catch { throw new WalletAuthError("INVALID_REGISTRY", "web origin is invalid"); }
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash || parsed.toString() !== `${origin}/`) {
      throw new WalletAuthError("INVALID_REGISTRY", "web origin must be a canonical HTTPS origin");
    }
    return origin;
  }));
}

function stringList(value, label, minimum, maximum, normalize) {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) {
    throw new WalletAuthError("INVALID_REGISTRY", `${label} has an invalid item count`);
  }
  const values = value.map(normalize);
  if (new Set(values).size !== values.length || [...values].sort().join("\n") !== values.join("\n")) {
    throw new WalletAuthError("INVALID_REGISTRY", `${label} must be unique and sorted`);
  }
  return values;
}
