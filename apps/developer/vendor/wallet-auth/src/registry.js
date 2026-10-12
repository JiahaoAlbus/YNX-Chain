import { exactFields, WalletAuthError } from "./canonical.js";
import { YNX_NATIVE_CHAIN_ID } from "./protocol.js";
import { parseCentralRegistryEntry } from "./integration.js";

const DOCUMENT_FIELDS = ["registryVersion", "chainId", "products"];
const PRODUCT_FIELDS = [
  "schemaVersion", "productId", "displayName", "reviewState", "enabled",
  "productClientId", "requestingProduct", "bundleId", "callbacks", "scopes",
  "maxScopes", "productDeviceAlgorithms", "sessionDurationSeconds", "revocationPolicy",
];
const REVOCATION_FIELDS = ["session", "approval", "device", "accountAllDevices"];
const REVIEW_STATES = new Set(["approved", "pending-review", "disabled"]);
const REGISTRY_V1_PRODUCT_IDS = Object.freeze([
  "ai", "browser", "calendar", "card", "cloud", "creator-studio", "developer", "dex", "docs", "exchange",
  "explorer", "finance", "mail", "merchant-console", "monitor", "music", "pay", "resource-market", "search",
  "seller-console", "shop", "social", "trust-center", "video", "wallet",
]);

export const CENTRAL_REGISTRY_DOCUMENT_VERSION = 2;
export const CENTRAL_REGISTRY_PRODUCT_COUNT = 26;
export const CENTRAL_PRODUCT_SCHEMA_VERSION = 3;

export function parseCentralRegistryDocument(input) {
  exactFields(input, DOCUMENT_FIELDS, "Central Wallet registry document");
  if (input.registryVersion !== CENTRAL_REGISTRY_DOCUMENT_VERSION || input.chainId !== YNX_NATIVE_CHAIN_ID || !Array.isArray(input.products) || input.products.length !== CENTRAL_REGISTRY_PRODUCT_COUNT) {
    throw new WalletAuthError("INVALID_REGISTRY", `Central Wallet registry v${CENTRAL_REGISTRY_DOCUMENT_VERSION} must contain exactly ${CENTRAL_REGISTRY_PRODUCT_COUNT} products for ${YNX_NATIVE_CHAIN_ID}`);
  }
  const products = parseRegistryProducts(input.products);
  return Object.freeze({
    registryVersion: CENTRAL_REGISTRY_DOCUMENT_VERSION,
    chainId: YNX_NATIVE_CHAIN_ID,
    products,
  });
}

export function migrateCentralRegistryDocumentV1(input) {
  exactFields(input, DOCUMENT_FIELDS, "Central Wallet registry document v1");
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
  });
}

export function parseCentralProductRegistration(input) {
  exactFields(input, PRODUCT_FIELDS, "Central Wallet product registration");
  if (input.schemaVersion !== CENTRAL_PRODUCT_SCHEMA_VERSION) throw new WalletAuthError("INVALID_REGISTRY", "Central Wallet product schema is unsupported");
  if (typeof input.productId !== "string" || !/^[a-z][a-z0-9-]{1,31}$/.test(input.productId)) throw new WalletAuthError("INVALID_REGISTRY", "productId is invalid");
  if (typeof input.displayName !== "string" || input.displayName.trim() !== input.displayName || input.displayName.length < 2 || input.displayName.length > 64) throw new WalletAuthError("INVALID_REGISTRY", "displayName is invalid");
  if (!REVIEW_STATES.has(input.reviewState) || typeof input.enabled !== "boolean" || input.enabled !== (input.reviewState === "approved")) throw new WalletAuthError("INVALID_REGISTRY", "Only approved registrations may be enabled");
  if (!Number.isInteger(input.sessionDurationSeconds) || input.sessionDurationSeconds < 60 || input.sessionDurationSeconds > 300) throw new WalletAuthError("INVALID_REGISTRY", "Session duration must be between 60 and 300 seconds");
  exactFields(input.revocationPolicy, REVOCATION_FIELDS, "Central Wallet revocation policy");
  if (REVOCATION_FIELDS.some(field => input.revocationPolicy[field] !== true)) throw new WalletAuthError("INVALID_REGISTRY", "Every central Wallet revocation control is mandatory");
  const protocol = parseCentralRegistryEntry({
    schemaVersion: 2,
    productClientId: input.productClientId,
    requestingProduct: input.requestingProduct,
    bundleId: input.bundleId,
    callbacks: input.callbacks,
    scopes: input.scopes,
    maxScopes: input.maxScopes,
    productDeviceAlgorithms: input.productDeviceAlgorithms,
  });
  return Object.freeze({
    productId: input.productId,
    displayName: input.displayName,
    reviewState: input.reviewState,
    enabled: input.enabled,
    ...protocol,
    schemaVersion: CENTRAL_PRODUCT_SCHEMA_VERSION,
    sessionDurationSeconds: input.sessionDurationSeconds,
    revocationPolicy: Object.freeze({ session: true, approval: true, device: true, accountAllDevices: true }),
  });
}

export function centralProtocolEntry(registration, options = {}) {
  const product = parseCentralProductRegistration(registration);
  if (options.requireEnabled !== false && !product.enabled) throw new WalletAuthError("REGISTRY_DISABLED", `Central Wallet product ${product.productId} is ${product.reviewState}`);
  return Object.freeze({
    schemaVersion: 2,
    productClientId: product.productClientId,
    requestingProduct: product.requestingProduct,
    bundleId: product.bundleId,
    callbacks: product.callbacks,
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

function canonicalQuantRegistration() {
  return {
    schemaVersion: CENTRAL_PRODUCT_SCHEMA_VERSION,
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
