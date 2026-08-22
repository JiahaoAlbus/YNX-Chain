import { readFileSync } from "node:fs";
import { WalletAuthError, centralProtocolEntry, parseCentralRegistryDocument, parseWalletDeepLink } from "@ynx-chain/wallet-auth";

export const CALLBACK_PROTOCOL_SOURCE = Object.freeze({
  protocolCommit: "a9dea929c42d0f59162be5872be9ae41ad2875d4",
  nativeSourceCommit: "0617709e5715d3fde2b0974e6ed76886e0fd623f",
  bundleIdentifier: "com.ynxweb4.wallet.macos",
  scheme: "ynxwallet",
  associatedDomainsAuthorized: false
});
export const CANONICAL_AUTH_BRIDGE_UNAVAILABLE = "CANONICAL_AUTH_BRIDGE_UNAVAILABLE";
export const CANONICAL_AUTHORIZATION_APPROVED = "CANONICAL_AUTHORIZATION_APPROVED";

const registryDocument = parseCentralRegistryDocument(JSON.parse(readFileSync(
  new URL("../central-registry.json", import.meta.resolve("@ynx-chain/wallet-auth")), "utf8"
)));
const frozenRegistry = Object.freeze(Object.fromEntries(registryDocument.products
  .filter(product => product.enabled)
  .map(product => [product.productClientId, centralProtocolEntry(product)])));

function reject(code) {
  return Object.freeze({ acceptedForReview: false, code, callbackEmitted: false, authorityGranted: false });
}

export function evaluateWalletCallback(rawValue, { now = new Date() } = {}) {
  try {
    const { request } = parseWalletDeepLink(rawValue, "ios", { now, registry: frozenRegistry });
    const product = registryDocument.products.find(item => item.productClientId === request.productClientId);
    return Object.freeze({
      acceptedForReview: true,
      code: CANONICAL_AUTH_BRIDGE_UNAVAILABLE,
      callbackEmitted: false,
      authorityGranted: false,
      request,
      displayName: product?.displayName ?? request.requestingProduct
    });
  } catch (error) {
    return reject(error instanceof WalletAuthError ? error.code : "INVALID_AUTHORIZATION_REQUEST");
  }
}
