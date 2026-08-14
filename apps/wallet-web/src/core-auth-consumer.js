export const WALLET_PRODUCT_CLIENT_ID = "ynx-wallet-v1";

function authFailure(code, message) { throw Object.assign(new Error(message), {code}); }

export function deriveCoreWalletAuthBinding(registry) {
  if (registry?.registryVersion !== 2 || registry?.chainId !== "ynx_6423-1" || !Array.isArray(registry.products)) authFailure("INVALID_CORE_REGISTRY", "Core Wallet/Auth registry is invalid.");
  const product=registry.products.find((item)=>item?.productClientId===WALLET_PRODUCT_CLIENT_ID);
  if (!product) authFailure("UNKNOWN_PRODUCT", "Wallet product is absent from the Core registry.");
  const webCallbacks=Array.isArray(product.callbacks)?product.callbacks.filter((callback)=>{try{return new URL(callback).protocol==="https:"}catch{return false}}):[];
  return Object.freeze({registryVersion:registry.registryVersion,chainId:registry.chainId,productClientId:product.productClientId,requestingProduct:product.requestingProduct,bundleId:product.bundleId,enabled:product.enabled===true,reviewState:product.reviewState,scopes:Object.freeze([...(product.scopes||[])]),webCallbacks:Object.freeze(webCallbacks)});
}

export function requireCanonicalAuthorizationContext(binding, context) {
  if (!binding?.enabled || binding.reviewState!=="approved" || binding.webCallbacks?.length<1) authFailure("CANONICAL_AUTH_UNAVAILABLE", "Canonical Wallet authorization is unavailable for this Web companion.");
  if (!context) authFailure("CANONICAL_AUTH_REQUIRED", "A verified canonical Wallet authorization context is required.");
  authFailure("CANONICAL_AUTH_UNVERIFIED", "The Web companion cannot verify this canonical Wallet authorization context.");
}
