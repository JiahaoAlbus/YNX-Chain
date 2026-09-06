export const WALLET_WEB_COMPANION_PRODUCT_ID = "wallet-web-companion";
export const WALLET_WEB_COMPANION_CLIENT_ID = "ynx-wallet-web-companion-v1";
export const WALLET_WEB_COMPANION_ORIGIN = "https://www.ynxweb4.com";
export const WALLET_WEB_COMPANION_CALLBACK = `${WALLET_WEB_COMPANION_ORIGIN}/dapp/wallet/wallet-auth/callback`;
export const WALLET_WEB_COMPANION_SCOPES = Object.freeze([
  "account:read", "chain:network:add", "chain:network:switch", "wallet:session:request",
]);

function authFailure(code, message) { throw Object.assign(new Error(message), {code}); }
function same(left, right) { return JSON.stringify(left) === JSON.stringify(right); }

/** Consume the immutable Core/Auth companion handoff. This does not create a parallel protocol. */
export function deriveWalletWebCompanionBinding(contract, authority = {}) {
  const registry = contract?.registry;
  const runtime = contract?.runtimeIntegration;
  if (contract?.schemaVersion !== 1 || contract?.authority !== "Core/Auth" || !registry || !runtime) {
    authFailure("INVALID_CORE_AUTHORITY", "Core Wallet Web companion authority is invalid.");
  }
  if (
    registry.productId !== WALLET_WEB_COMPANION_PRODUCT_ID ||
    registry.productClientId !== WALLET_WEB_COMPANION_CLIENT_ID ||
    registry.requestingProduct !== WALLET_WEB_COMPANION_PRODUCT_ID ||
    registry.bundleId !== "web.ynx.wallet.companion" ||
    registry.enabled !== true || registry.reviewState !== "approved" ||
    !same(registry.callbacks, [WALLET_WEB_COMPANION_CALLBACK]) ||
    !same(registry.scopes, WALLET_WEB_COMPANION_SCOPES) ||
    registry.sessionDurationSeconds !== 180 ||
    runtime.client !== "RecoverableProductSessionClient" ||
    runtime.gatewayAdapter !== "ProductSessionGatewayFetchAdapter" ||
    runtime.webApplicationId !== "web.ynx.wallet.companion" ||
    runtime.webCallback !== WALLET_WEB_COMPANION_CALLBACK
  ) authFailure("CORE_AUTHORITY_MISMATCH", "Core Wallet Web companion binding does not match the frozen contract.");
  return Object.freeze({
    productId: registry.productId,
    productClientId: registry.productClientId,
    requestingProduct: registry.requestingProduct,
    bundleId: registry.bundleId,
    enabled: true,
    reviewState: "approved",
    scopes: WALLET_WEB_COMPANION_SCOPES,
    webOrigin: WALLET_WEB_COMPANION_ORIGIN,
    webCallbacks: Object.freeze([WALLET_WEB_COMPANION_CALLBACK]),
    callback: WALLET_WEB_COMPANION_CALLBACK,
    sessionDurationSeconds: 180,
    coreCommit: authority.coreCommit ?? null,
    coreContractBlob: authority.coreContractBlob ?? null,
    centralCallerCommit: authority.centralCallerCommit ?? null,
    centralCallerBlob: authority.centralCallerBlob ?? null,
    publicGatewayRegistryReady: authority.publicGatewayRegistryReady === true,
    trustedRuntimeAvailable: authority.trustedRuntimeAvailable === true,
  });
}

// Compatibility surface for existing extension policy callers; only the companion identity is accepted.
export function deriveCoreWalletAuthBinding(registry) {
  if (registry?.registryVersion !== 2 || !Array.isArray(registry.products)) authFailure("INVALID_CORE_REGISTRY", "Core Wallet/Auth registry is invalid.");
  const product = registry.products.find((item) => item?.productClientId === WALLET_WEB_COMPANION_CLIENT_ID);
  if (!product) authFailure("UNKNOWN_PRODUCT", "Wallet Web companion is absent from the Core registry.");
  return Object.freeze({
    productClientId: product.productClientId,
    requestingProduct: product.requestingProduct,
    bundleId: product.bundleId,
    enabled: product.enabled === true,
    reviewState: product.reviewState,
    scopes: Object.freeze([...(product.scopes || [])]),
    webCallbacks: Object.freeze((product.callbacks || []).filter((value) => {
      try { return new URL(value).protocol === "https:"; } catch { return false; }
    })),
  });
}

export function requireCanonicalAuthorizationContext(binding, context) {
  if (!binding?.enabled || binding.reviewState !== "approved" || !same(binding.webCallbacks, [WALLET_WEB_COMPANION_CALLBACK])) authFailure("CANONICAL_AUTH_UNAVAILABLE", "Canonical Wallet authorization is unavailable for this Web companion.");
  if (binding.publicGatewayRegistryReady === false || binding.trustedRuntimeAvailable === false) authFailure("CANONICAL_AUTH_UNAVAILABLE", "The public Gateway registry or trusted Core runtime is unavailable.");
  if (!context) authFailure("CANONICAL_AUTH_REQUIRED", "A verified canonical Wallet authorization context is required.");
  authFailure("CANONICAL_AUTH_UNVERIFIED", "The Web companion cannot verify this canonical Wallet authorization context.");
}
