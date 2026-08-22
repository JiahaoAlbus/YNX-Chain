import { exactFields, WalletAuthError } from "./canonical.js";

export const PRODUCT_SESSION_REGISTRY_VERSION = 3;
export const PRODUCT_SESSION_PLATFORMS = Object.freeze(["android", "ios", "macos", "web", "windows"]);

const DOCUMENT_FIELDS = ["schemaVersion", "chainId", "wallet", "products"];
const WALLET_FIELDS = ["authorizeCallback", "downloadUrl", "metaMaskDownloadUrl"];
const WALLET_V1_FIELDS = ["authorizeCallback", "downloadUrl"];
const PRODUCT_FIELDS = [
  "productId", "clientId", "displayName", "applicationId", "webOrigin", "nativeCallback",
  "legacyCallbacks", "scopes", "evmCompatible", "sessionDurationSeconds", "retiredClients",
];
const EXPLICIT_WEB_PRODUCT_FIELDS = [...PRODUCT_FIELDS, "platforms", "webApplicationId", "webCallback"];
const PRODUCT_V2_FIELDS = PRODUCT_FIELDS.filter((field) => field !== "retiredClients");
const EXPLICIT_WEB_PRODUCT_V2_FIELDS = EXPLICIT_WEB_PRODUCT_FIELDS.filter((field) => field !== "retiredClients");
const RETIRED_CLIENT_FIELDS = ["platform", "applicationId", "callback", "retiredAt", "lastSupportedVersion", "replacementUrl"];
const FORBIDDEN_CALLBACK_SCHEMES = new Set(["data:", "file:", "http:", "javascript:"]);

export function parseProductSessionRegistry(input) {
  exactFields(input, DOCUMENT_FIELDS, "Product Session router registry");
  if (input.schemaVersion !== PRODUCT_SESSION_REGISTRY_VERSION || input.chainId !== "ynx_6423-1") {
    fail("INVALID_ROUTER_REGISTRY", "Product Session router registry version or chain is unsupported");
  }
  exactFields(input.wallet, WALLET_FIELDS, "Product Session Wallet registration");
  const authorizeCallback = callback(input.wallet.authorizeCallback, "wallet authorize callback", { allowHttps: false });
  const authorize = new URL(authorizeCallback);
  if (authorize.protocol !== "ynxwallet:" || authorize.hostname !== "authorize" || authorize.pathname !== "") {
    fail("INVALID_ROUTER_REGISTRY", "Wallet authorize callback must be ynxwallet://authorize");
  }
  const downloadUrl = httpsURL(input.wallet.downloadUrl, "Wallet download URL", false);
  const metaMaskDownloadUrl = httpsURL(input.wallet.metaMaskDownloadUrl, "MetaMask download URL", false);
  if (downloadUrl !== "https://www.ynxweb4.com/dapp/download" || metaMaskDownloadUrl !== "https://metamask.io/download") {
    fail("INVALID_ROUTER_REGISTRY", "Wallet download routes must match the approved official allowlist");
  }
  if (!Array.isArray(input.products) || input.products.length < 1 || input.products.length > 64) {
    fail("INVALID_ROUTER_REGISTRY", "Product Session registry product count is invalid");
  }
  const products = input.products.map(parseProduct);
  uniqueSorted(products.map((item) => item.productId), "productId");
  unique(products.map((item) => item.clientId), "clientId");
  unique(products.map((item) => item.applicationId), "applicationId");
  unique(products.map((item) => item.webApplicationId), "web applicationId");
  unique(products.map((item) => item.webOrigin), "webOrigin");
  unique(products.map((item) => item.webCallback), "web callback");
  unique(products.map((item) => new URL(item.nativeCallback).protocol), "native callback scheme");
  const legacy = products.flatMap((item) => item.legacyCallbacks.map((value) => `${value}\n${item.productId}`));
  const legacyNames = legacy.map((value) => value.split("\n", 1)[0]);
  unique(legacyNames, "legacy callback");
  return Object.freeze({
    schemaVersion: PRODUCT_SESSION_REGISTRY_VERSION,
    chainId: input.chainId,
    wallet: Object.freeze({ authorizeCallback, downloadUrl, metaMaskDownloadUrl }),
    products: Object.freeze(products),
  });
}

export function migrateProductSessionRegistryV1(input) {
  exactFields(input, DOCUMENT_FIELDS, "Product Session router registry v1");
  if (input.schemaVersion !== 1 || input.chainId !== "ynx_6423-1") fail("INVALID_ROUTER_REGISTRY", "Product Session router registry v1 is unsupported");
  exactFields(input.wallet, WALLET_V1_FIELDS, "Product Session Wallet registration v1");
  return migrateProductSessionRegistryV2({
    ...input,
    schemaVersion: 2,
    wallet: { ...input.wallet, metaMaskDownloadUrl: "https://metamask.io/download" },
  });
}

export function migrateProductSessionRegistryV2(input) {
  exactFields(input, DOCUMENT_FIELDS, "Product Session router registry v2");
  if (input.schemaVersion !== 2 || input.chainId !== "ynx_6423-1") fail("INVALID_ROUTER_REGISTRY", "Product Session router registry v2 is unsupported");
  exactFields(input.wallet, WALLET_FIELDS, "Product Session Wallet registration v2");
  if (!Array.isArray(input.products)) fail("INVALID_ROUTER_REGISTRY", "Product Session router registry v2 products are invalid");
  const products = input.products.map((product) => {
    const explicitWeb = Object.hasOwn(product, "platforms") || Object.hasOwn(product, "webApplicationId") || Object.hasOwn(product, "webCallback");
    exactFields(product, explicitWeb ? EXPLICIT_WEB_PRODUCT_V2_FIELDS : PRODUCT_V2_FIELDS, "Product Session product registration v2");
    return { ...product, retiredClients: legacyRetirements(product) };
  });
  return parseProductSessionRegistry({ ...input, schemaVersion: PRODUCT_SESSION_REGISTRY_VERSION, products });
}

export function productPlatformBinding(registryInput, productId, platform) {
  const registry = parseProductSessionRegistry(registryInput);
  if (!PRODUCT_SESSION_PLATFORMS.includes(platform)) fail("INVALID_PLATFORM", "Product Session platform is unsupported");
  const product = registry.products.find((item) => item.productId === productId);
  if (!product) fail("UNKNOWN_PRODUCT", "Product is not registered for Product Sessions");
  if (!product.platforms.includes(platform)) fail("INVALID_PLATFORM", "Product is not registered for Product Sessions on this platform");
  if (product.retiredClients.some((item) => item.platform === platform)) {
    fail("CLIENT_RETIRED", "The exact product client and callback are retired; use the registered replacement");
  }
  const web = platform === "web";
  return Object.freeze({
    chainId: registry.chainId,
    productId: product.productId,
    clientId: product.clientId,
    displayName: product.displayName,
    platform,
    applicationId: web ? product.webApplicationId : product.applicationId,
    bundleId: ["ios", "macos"].includes(platform) ? product.applicationId : null,
    packageId: ["android", "windows"].includes(platform) ? product.applicationId : null,
    origin: web ? product.webOrigin : `app://${platform}/${product.applicationId}`,
    callback: web ? product.webCallback : product.nativeCallback,
    scopes: product.scopes,
    evmCompatible: product.evmCompatible,
    sessionDurationSeconds: product.sessionDurationSeconds,
    walletAuthorizeCallback: registry.wallet.authorizeCallback,
    walletDownloadUrl: registry.wallet.downloadUrl,
    metaMaskDownloadUrl: registry.wallet.metaMaskDownloadUrl,
  });
}

export function productPlatformStatus(registryInput, productId, platform) {
  const registry = parseProductSessionRegistry(registryInput);
  if (!PRODUCT_SESSION_PLATFORMS.includes(platform)) fail("INVALID_PLATFORM", "Product Session platform is unsupported");
  const product = registry.products.find((item) => item.productId === productId);
  if (!product) fail("UNKNOWN_PRODUCT", "Product is not registered for Product Sessions");
  if (!product.platforms.includes(platform)) fail("INVALID_PLATFORM", "Product is not registered for Product Sessions on this platform");
  const retired = product.retiredClients.find((item) => item.platform === platform);
  if (retired) {
    return Object.freeze({
      status: "retired",
      code: "CLIENT_RETIRED",
      productId: product.productId,
      clientId: product.clientId,
      displayName: product.displayName,
      platform,
      applicationId: retired.applicationId,
      callback: retired.callback,
      retiredAt: retired.retiredAt,
      lastSupportedVersion: retired.lastSupportedVersion,
      replacementUrl: retired.replacementUrl,
      actions: Object.freeze(["open-replacement", "return-to-product"]),
      authority: "none",
      productSession: false,
    });
  }
  return Object.freeze({
    status: "active",
    productId: product.productId,
    clientId: product.clientId,
    displayName: product.displayName,
    platform,
    actions: Object.freeze([]),
  });
}

export function migrateLegacyCallback(registryInput, legacyValue, context) {
  const registry = parseProductSessionRegistry(registryInput);
  exactFields(context, ["productId", "platform"], "Legacy callback migration context");
  if (typeof legacyValue !== "string" || legacyValue.length < 3 || legacyValue.length > 512 || legacyValue.trim() !== legacyValue) {
    fail("UNKNOWN_LEGACY_SCHEME", "Legacy callback is not registered");
  }
  const product = registry.products.find((item) => item.productId === context.productId);
  if (!product || !product.legacyCallbacks.includes(legacyValue)) {
    fail("UNKNOWN_LEGACY_SCHEME", "Legacy callback is not registered for this product");
  }
  const target = productPlatformBinding(registry, context.productId, context.platform);
  if (context.platform === "web" && legacyValue !== target.callback) {
    fail("CALLBACK_MISMATCH", "A native legacy callback cannot be migrated into a Web origin");
  }
  return Object.freeze({
    migrated: legacyValue !== target.callback,
    legacyValue,
    callback: target.callback,
    productId: target.productId,
    clientId: target.clientId,
    platform: target.platform,
  });
}

function parseProduct(input) {
  const explicitWeb = Object.hasOwn(input, "platforms") || Object.hasOwn(input, "webApplicationId") || Object.hasOwn(input, "webCallback");
  exactFields(input, explicitWeb ? EXPLICIT_WEB_PRODUCT_FIELDS : PRODUCT_FIELDS, "Product Session product registration");
  const productId = pattern(input.productId, "productId", /^[a-z][a-z0-9-]{1,31}$/);
  const clientId = pattern(input.clientId, "clientId", /^[a-z][a-z0-9._-]{2,63}$/);
  const displayName = text(input.displayName, "displayName", 2, 64);
  const applicationId = pattern(input.applicationId, "applicationId", /^[A-Za-z][A-Za-z0-9.-]{2,127}$/);
  const webOrigin = httpsURL(input.webOrigin, "webOrigin", true);
  const platforms = explicitWeb
    ? stringList(input.platforms, "platforms", 1, PRODUCT_SESSION_PLATFORMS.length, (value) => {
      const platform = text(value, "platform", 3, 16);
      if (!PRODUCT_SESSION_PLATFORMS.includes(platform)) fail("INVALID_ROUTER_REGISTRY", "Product Session platform is unsupported");
      return platform;
    })
    : [...PRODUCT_SESSION_PLATFORMS];
  const webApplicationId = explicitWeb ? pattern(input.webApplicationId, "webApplicationId", /^[A-Za-z][A-Za-z0-9.-]{2,131}$/) : `${applicationId}.web`;
  const webCallback = explicitWeb ? callback(input.webCallback, "webCallback", { allowHttps: true }) : `${webOrigin}/wallet-auth/callback`;
  const parsedWebCallback = new URL(webCallback);
  if (parsedWebCallback.protocol !== "https:" || parsedWebCallback.origin !== webOrigin || parsedWebCallback.search) {
    fail("INVALID_ROUTER_REGISTRY", "Web callback must be an exact HTTPS path on the registered Web origin");
  }
  const nativeCallback = callback(input.nativeCallback, "nativeCallback", { allowHttps: false });
  const native = new URL(nativeCallback);
  if (native.search || native.hash || native.username || native.password || !native.hostname) {
    fail("INVALID_ROUTER_REGISTRY", "Native callback must contain an exact host/path without query or fragment");
  }
  const legacyCallbacks = stringList(input.legacyCallbacks, "legacyCallbacks", 1, 8, (value) => text(value, "legacy callback", 3, 512));
  if (!legacyCallbacks.includes(nativeCallback)) fail("INVALID_ROUTER_REGISTRY", "Legacy callback list must include the canonical native callback");
  const scopes = stringList(input.scopes, "scopes", 1, 8, (value) => pattern(value, "scope", /^[a-z][a-z0-9._:-]{1,63}$/));
  if (scopes.some((scope) => scope.includes("*"))) fail("INVALID_ROUTER_REGISTRY", "Wildcard Product Session scope is forbidden");
  if (typeof input.evmCompatible !== "boolean") fail("INVALID_ROUTER_REGISTRY", "evmCompatible must be boolean");
  if (!Number.isInteger(input.sessionDurationSeconds) || input.sessionDurationSeconds < 60 || input.sessionDurationSeconds > 300) {
    fail("INVALID_ROUTER_REGISTRY", "Product Session duration must be between 60 and 300 seconds");
  }
  const retiredClients = retiredClientList(input.retiredClients, { applicationId, nativeCallback, platforms, webApplicationId, webCallback, webOrigin });
  return Object.freeze({
    productId, clientId, displayName, applicationId, webOrigin, nativeCallback, platforms: Object.freeze(platforms), webApplicationId, webCallback,
    legacyCallbacks: Object.freeze(legacyCallbacks), scopes: Object.freeze(scopes),
    evmCompatible: input.evmCompatible, sessionDurationSeconds: input.sessionDurationSeconds, retiredClients,
  });
}

function retiredClientList(input, product) {
  if (!Array.isArray(input) || input.length > PRODUCT_SESSION_PLATFORMS.length) fail("INVALID_ROUTER_REGISTRY", "retiredClients must be a bounded array");
  const result = input.map((item) => {
    exactFields(item, RETIRED_CLIENT_FIELDS, "retired Product Session client");
    const platform = text(item.platform, "retired client platform", 3, 16);
    if (!PRODUCT_SESSION_PLATFORMS.includes(platform) || !product.platforms.includes(platform)) fail("INVALID_ROUTER_REGISTRY", "retired client platform is not registered for the product");
    const web = platform === "web";
    const expectedApplicationId = web ? product.webApplicationId : product.applicationId;
    const expectedCallback = web ? product.webCallback : product.nativeCallback;
    if (item.applicationId !== expectedApplicationId || item.callback !== expectedCallback) fail("INVALID_ROUTER_REGISTRY", "retired client application or callback does not match the registered platform binding");
    const retiredAt = canonicalTime(item.retiredAt, "retiredAt");
    const lastSupportedVersion = pattern(item.lastSupportedVersion, "lastSupportedVersion", /^[0-9A-Za-z][0-9A-Za-z.+-]{0,63}$/);
    const replacementUrl = httpsURL(item.replacementUrl, "retired client replacementUrl", false);
    if (new URL(replacementUrl).origin !== product.webOrigin) fail("INVALID_ROUTER_REGISTRY", "retired client replacementUrl must remain on the registered product Web origin");
    return Object.freeze({ platform, applicationId: expectedApplicationId, callback: expectedCallback, retiredAt, lastSupportedVersion, replacementUrl });
  });
  uniqueSorted(result.map((item) => item.platform), "retired client platform");
  return Object.freeze(result);
}

function legacyRetirements(product) {
  if (product.productId !== "shop") return [];
  if (product.clientId !== "ynx-shop-v1" || product.applicationId !== "com.ynxweb4.shop" || product.nativeCallback !== "ynxshop://wallet-auth/callback") {
    fail("INVALID_ROUTER_REGISTRY", "legacy Shop client tuple cannot be retired safely");
  }
  return [{
    platform: "android",
    applicationId: "com.ynxweb4.shop",
    callback: "ynxshop://wallet-auth/callback",
    retiredAt: "2026-08-20T00:00:00.000Z",
    lastSupportedVersion: "0.3.0-testnet-preview",
    replacementUrl: "https://shop.ynxweb4.com/shop",
  }];
}

function callback(value, label, options) {
  const normalized = text(value, label, 3, 512);
  let parsed;
  try { parsed = new URL(normalized); } catch { fail("INVALID_ROUTER_REGISTRY", `${label} is not a URL with ://`); }
  if (parsed.toString() !== normalized || parsed.username || parsed.password || parsed.hash || FORBIDDEN_CALLBACK_SCHEMES.has(parsed.protocol)) {
    fail("INVALID_ROUTER_REGISTRY", `${label} is not canonical or uses a forbidden scheme`);
  }
  if (parsed.protocol === "https:" && !options.allowHttps) fail("INVALID_ROUTER_REGISTRY", `${label} must use its registered application scheme`);
  if (parsed.protocol !== "https:" && !/^[a-z][a-z0-9+.-]*:$/.test(parsed.protocol)) fail("INVALID_ROUTER_REGISTRY", `${label} scheme is invalid`);
  return normalized;
}

function httpsURL(value, label, originOnly) {
  const normalized = text(value, label, 8, 512);
  let parsed;
  try { parsed = new URL(normalized); } catch { fail("INVALID_ROUTER_REGISTRY", `${label} is invalid`); }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.hash || parsed.port || !parsed.hostname || (originOnly && (parsed.pathname !== "/" || parsed.search))) {
    fail("INVALID_ROUTER_REGISTRY", `${label} must be a canonical HTTPS ${originOnly ? "origin" : "URL"}`);
  }
  return originOnly ? parsed.origin : parsed.toString().replace(/\/$/, "");
}
function canonicalTime(value, label) { const result = text(value, label, 20, 30); const parsed = new Date(result); if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== result) fail("INVALID_ROUTER_REGISTRY", `${label} must be canonical UTC`); return result; }

function stringList(value, label, minimum, maximum, normalize) {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) fail("INVALID_ROUTER_REGISTRY", `${label} item count is invalid`);
  const result = value.map(normalize);
  uniqueSorted(result, label);
  return result;
}
function uniqueSorted(values, label) {
  unique(values, label);
  if ([...values].sort().join("\n") !== values.join("\n")) fail("INVALID_ROUTER_REGISTRY", `${label} must be sorted`);
}
function unique(values, label) { if (new Set(values).size !== values.length) fail("INVALID_ROUTER_REGISTRY", `${label} must be globally unique`); }
function pattern(value, label, regex) { const result = text(value, label, 1, 512); if (!regex.test(result)) fail("INVALID_ROUTER_REGISTRY", `${label} is invalid`); return result; }
function text(value, label, minimum, maximum) { if (typeof value !== "string" || value.length < minimum || value.length > maximum || value.trim() !== value) fail("INVALID_ROUTER_REGISTRY", `${label} is invalid`); return value; }
function fail(code, message) { throw new WalletAuthError(code, message); }
